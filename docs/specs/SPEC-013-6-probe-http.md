---
proplan: v1
spec: SPEC-013.6
fatia: 13.6
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-14 (ADR-018 aprovado)
updated: 2026-07-14
depende-de: [SPEC-013 v2.1 (drift — implementar primeiro), ADR-018 (aprovado 2026-07-14)]
---
# SPEC-013.6 — Probe HTTP de URL declarada: o confronto com o mundo

> **Extensão da SPEC-013.** A Fatia 13 confronta 4 fontes de plataforma de deploy, mas nenhuma toca a realidade — todas são registro ou asserção. Esta fatia acrescenta a **única fonte que confronta o mundo**: um GET HTTP à URL que o dono declarou, que confirma o que **está no ar agora** e identifica plataforma de **domínio próprio**. É a peça mais fiel à tese do `LANDSCAPE.md` — e a única que abre superfície de segurança séria, por isso é fatia separada, sob **ADR-018**.

## Pré-condição

- [x] **ADR-018 `aprovado` pelo PI** (2026-07-14). O probe só existe na forma **SSRF-safe** do ADR-018 (7 guardas não-negociáveis, condição de aceite).
- [ ] **SPEC-013 v2.1 implementada primeiro** — esta fatia estende o confronto da 13; começar depois que a 13 landar.

## Objetivo

Dar ao confronto da SPEC-013 uma fonte que reflete a **realidade viva**, não um registro dela: confirmar que a URL declarada como produção **está no ar servindo aquela plataforma agora**, e identificar a plataforma de **domínio próprio** (que o parse-de-string da 13 deixa como `desconhecida`).

## O que esta fatia entrega sobre a 13

- **Domínio próprio identificável**: `gestao.epgtrindade.com.br` → probe lê headers (`x-vercel-id`/`x-nf-request-id`/`server`/`via`/`x-railway-*`) → plataforma. Sem precisar o dono declarar à mão.
- **Liveness + realidade**: a fonte `declaredUrl` da 13 deixa de ser "o domínio parece Netlify" e passa a ser "a URL respondeu, ao vivo, com fingerprint de Netlify, em `<data>`".
- **O `rrb-escola` vira `discordam` mesmo por domínio próprio** — hoje (v2.1) só vira se a URL declarada já for `*.netlify.app`.

## Escopo

1. **`HttpProbe` (infra, `ingestion/infrastructure`)** — fetch endurecido implementando **as 7 guardas do ADR-018**: só https; rejeição de IP não-público pós-DNS; re-checagem por redirect (teto 3); HEAD→GET com corpo ≤64KB; timeout ~5s; sem credencial; só URLs de `deploy.prodUrls`.
2. **`platformFromProbe(headers, finalUrl, bodySlice)` (domínio puro, testável)** — fingerprint determinístico → plataforma ou `null`. **Nunca chuta**: sem fingerprint reconhecido → `null`, não uma plataforma.
3. **Integração ao confronto da 13**: a fonte `declaredUrl` passa a ter **dois modos** — `string` (parse de domínio, sem rede, o da 13) e `probe` (ao vivo, esta fatia). O `deploySignals` registra qual modo produziu a plataforma e a **data do probe**.
4. **Gate de segurança**: URL cujo destino resolve para IP não-público → **não é sondada**, registrada como `bloqueada_por_seguranca` no sinal (transparente, nunca silenciosa).

## Fora de escopo

- **API de plataforma com credencial** (Railway/Netlify/Vercel) — segue fora (ADR-018 autoriza só probe HTTP anônimo público).
- **Descobrir URL** — o dono declara; o probe verifica.
- **Persistir corpo de resposta** — só veredito (plataforma + data), ADR-017.
- **Probe no caminho de render** — roda só no sync-job, ADR-002.

## Contratos

**Reusa** o modelo da SPEC-013 (`deploySignals`, `deployVerdict`). Acrescenta ao item de sinal:
```
{ source: "declaredUrl", mode: "string" | "probe" | "bloqueada_por_seguranca",
  platforms: string[], observedAt: iso, evidenceRef: string }
```
**Domínio puro** (`ingestion/domain/deploy-drift.ts`, ampliado):
```ts
platformFromProbe(headers: Record<string,string>, finalUrl: string, bodySlice: string): string | null
```
**Infra** (`ingestion/infrastructure/http-probe.ts`): `probe(url): {headers, finalUrl, bodySlice} | {blocked: true, reason}` — encapsula as 7 guardas; **testável com servidor-fake** (inclui teste que aponta para IP privado e exige `blocked`).

## Critérios de aceite

- [ ] **ADR-018 aprovado** antes de qualquer código (pré-condição).
- [ ] `rrb-escola` com `gestao.epgtrindade.com.br` declarada (domínio próprio) → probe identifica a plataforma real pelos headers → entra no confronto; se diverge de config/GitHub → `discordam`. **Este é o ganho sobre a 13.**
- [ ] URL cujo host resolve para **IP privado/loopback/link-local** (teste com `169.254.169.254`, `127.0.0.1`, `10.x`) → **`bloqueada_por_seguranca`**, o backend **não** faz a requisição. Teste automatizado obrigatório.
- [ ] **Redirect para IP interno** é bloqueado no salto (teste: URL pública que redireciona para `127.0.0.1`).
- [ ] Só `https`; `http://`/`file://` rejeitados.
- [ ] Fingerprint desconhecido → plataforma `null`, nunca chute.
- [ ] Corpo da resposta **nunca** persistido; só plataforma + data.
- [ ] Probe roda **só no sync-job** (ausente do caminho de render — verificável).
- [ ] Zero credencial enviada (sem header de auth/cookie — verificável no teste de request).

## Notas técnicas

- **SSRF é o risco central** — a suíte de testes de segurança (IP privado, redirect-para-interno, DNS rebinding no redirect, esquema não-https) é **critério de aceite**, não teste opcional.
- **DNS rebinding (decisão técnica do Code)** — pinar o IP validado entre resolução e conexão evita a janela entre resolver o DNS e abrir o socket. Recomendado: `undici` com `connect` custom que valida o IP resolvido; se inviável no build CJS do Nest (Octokit v4 já mordeu esse ESM/CJS — ver `CLAUDE.md`), cair para resolução DNS manual + conexão pinada no IP validado com `Host` header preservado. O Code decide a lib; o requisito de produto é só que a janela de rebinding esteja fechada.
- **Custo por sync**: +1 request por URL declarada. Rate-limit e timeout curto mantêm o sync barato.
- **Fingerprints iniciais**: Vercel (`x-vercel-id`, `server: Vercel`), Netlify (`x-nf-request-id`, `server: Netlify`), Railway (`x-railway-*`, edge headers), Render, Fly (`fly-request-id`), Cloudflare (`cf-ray`, `server: cloudflare`). Lista extensível; desconhecido → `null`.

## Perguntas abertas

Nenhuma bloqueante. O ADR-018 foi **aprovado** (2026-07-14). O único ponto remanescente é **decisão técnica do Code** (não do PI), registrada em Notas técnicas: como pinar o IP validado entre resolução e conexão para fechar DNS rebinding no build CJS do Nest.
