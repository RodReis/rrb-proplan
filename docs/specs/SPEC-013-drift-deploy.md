---
proplan: v1
spec: SPEC-013
fatia: 13
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-14 (v2.1, embarca SEM probe; probe = Fatia 13.6/ADR-018)
updated: 2026-07-14
---
# SPEC-013 — Drift de deploy: confronto de fontes, sem coroar verdade

> **Histórico.** v1 assumia o sinal do GitHub como verdade — refutado ao vivo (o `rrb-escola` mostra Vercel em toda fonte GitHub-side, mas roda em Netlify+Railway). v2 acrescentava um **probe HTTP** de URL declarada. **v2.1 (2026-07-14): o PI recusou a superfície de probe HTTP (ADR-018 negado).** Esta versão obtém o sinal fresco **sem chamada externa** — a plataforma é lida do **domínio da URL declarada, como texto puro**. ADR-003 permanece intacto; nenhum ADR novo é necessário.

## A refutação que fundou a spec (verificado, não suposto)

`rrb-escola`, verificado em 2026-07-14 (GitHub App instalado + probe HTTP público **de investigação**):

| fonte permitida ao ProPlan | o que diz sobre `rrb-escola` | natureza |
|---|---|---|
| doc de deploy (`docs/DEPLOY_PENDENTE_PROD.md`) | só fala Supabase — **silencia sobre host do app** | inútil para plataforma |
| config no repo (`vercel.json`, cron nativo Vercel) | Vercel | declaração de intenção, **não prova de execução** |
| GitHub Deployments API | 33× `vercel[bot]`, `*.vercel.app`, sem `netlify[bot]`/`railway[bot]` | registro de eventos GitHub-side |
| realidade (produção) | **Netlify** (`escola-erp.netlify.app`) + **Railway** (`...up.railway.app`) | deploy feito **fora do GitHub** |

Todas as fontes GitHub-side apontam Vercel. A produção real (Netlify+Railway) foi feita por CLI/dashboard, **invisível à Deployments API**. A v1 cravaria `confere`/Vercel com confiança cheia num sistema que não roda em Vercel.

**Lição de projeto:** o repositório é fonte de verdade sobre *o que alguém escreveu ou configurou um dia*, nunca sobre *o que está no ar agora*.

## O achado que dispensa o probe (base da v2.1)

A URL que o dono declara como produção **revela a plataforma no próprio domínio**, por **parse de string** — sem HTTP, sem credencial, sem superfície externa:

- `*.netlify.app` → Netlify · `*.up.railway.app` → Railway · `*.vercel.app` → Vercel · `*.onrender.com` → Render · `*.fly.dev` → Fly.io · `*.pages.dev` → Cloudflare Pages · `*.herokuapp.com` → Heroku · …

Assim, a URL declarada é uma **quarta fonte fresca** (asserção humana datada, ADR-013) processada como texto. O `rrb-escola` é pego: config+GitHub dizem Vercel, a URL declarada `escola-erp.netlify.app` diz Netlify → **discordam** — sem o ProPlan chamar nada.

**Limite honesto:** domínio próprio (`gestao.epgtrindade.com.br`) **não** revela plataforma por texto. Nesse caso a plataforma fica `desconhecida (domínio próprio)` e a URL **não entra no confronto de plataforma** (o dono pode, opcionalmente, declarar a plataforma junto — ver Contratos). Resolver domínio próprio automaticamente exigiria o probe HTTP **recusado pelo PI** — fica fora.

## Objetivo

Parar de dar **crédito institucional** a documentação de deploy que pode estar desatualizada — **sem afirmar qual plataforma é a verdadeira** (o ProPlan não pode saber isso). Entregar um **confronto datado de fontes**: quando discordam, mostrar cada uma com origem e data; quando só há fonte GitHub-side (que pode estar velha), **admitir que não há fonte fresca e pedir a URL de produção**, em vez de cravar confiança.

## Princípio inegociável

O produto **nunca diz "roda em X"**. Diz *"a fonte Y, em Z, aponta X"*. Não rotula fonte como "congelada" ou "resíduo" (isso seria coroar uma verdade pela porta dos fundos). Afirma só o **fato estrutural** de cada fonte + sua **data**; o humano conclui a idade.

## As quatro fontes (nenhuma é verdade)

1. **Doc de deploy** — plataformas por extração determinística de texto (lista conhecida, word-boundary, case-insensitive). Pode silenciar.
2. **Config no repo** — presença de `vercel.json`, `netlify.toml`, `railway.json`/`.toml`, `Procfile`, `fly.toml`, `render.yaml`, `Dockerfile`, `.github/workflows/*` com deploy. É **declaração de intenção, não prova de execução**.
3. **GitHub Deployments API** — `deployments` + `statuses` (`environment_url`) + `environments`. Registro GitHub-side, datado.
4. **URL de produção declarada pelo dono** — plataforma extraída do **domínio, por parse de string** (sem HTTP). Asserção humana datada (ADR-013). Domínio próprio → `desconhecida`.

## Veredito — confronto, não verdade

`P(fonte)` = plataformas que a fonte aponta (vazio = silenciou/ausente/desconhecida).

| estado | condição | UI |
|---|---|---|
| `concordam` | todas as fontes presentes apontam o mesmo | silencioso |
| `discordam` | duas fontes presentes apontam plataformas diferentes | 🔴 lista **cada fonte com plataforma, natureza e data** — sem dizer qual é a certa |
| `so_github_side` | há sinal de config/GitHub, **mas nenhuma URL declarada** | ⚠️ *"as fontes do GitHub apontam <X>, mas nenhuma é fresca — **declare a URL de produção** para confrontar"* — **não crava X** |
| `omissa` | há deployments no GitHub e **nenhuma doc de deploy** | ⚠️ *"este repo tem deployments registrados no GitHub e nenhuma doc de deploy"* |
| `silencio` | nada aponta nada, sem deployments | silencioso — *"Deploy não documentado"* é a resposta **correta** |

**O caso que a v1 errava, agora correto e sem chamada externa:** `rrb-escola` com `escola-erp.netlify.app` e `...railway.app` declaradas → **`discordam`**: `config: Vercel (declaração, <data>)`, `GitHub: Vercel (deployment, <data>)`, `URL declarada: Netlify + Railway (<data>)`. Nomeia cada fonte, **não coroa nenhuma**.

## A honestidade brutal (o teto real)

**Sem a URL declarada, a fatia NÃO pega o `rrb-escola`** — cai em `so_github_side` (as três fontes GitHub-side concordam em Vercel). A entrega **não é acertar sempre**; é, na falta de fonte fresca, **admitir que não sabe e pedir a URL**, em vez de cravar confiança cheia numa plataforma morta. O produto passa de *"mente com autoridade"* para *"diz o que não sabe e pede o dado que falta"*. Para **domínio próprio**, mesmo com URL declarada, a plataforma fica `desconhecida` — o teto do parse-de-string sem o probe recusado.

## Escopo

1. **Coleta no `sync-job`** das 4 fontes → `deploySignals` + `deployVerdict`. Sem novo ADR, sem superfície externa.
2. **Extração determinística** de plataformas: texto (doc), presença de arquivo (config), **sufixo de domínio** (URL declarada).
3. **UI**: faixa de confronto no topo da aba Deploy (acima do painel da SPEC-012), cada fonte com **natureza + plataforma + data** e o carimbo **"observado em <data>"**. CTA "declare a URL de produção" no estado `so_github_side`. Badge no card do catálogo.

## Fora de escopo (explícito)

- **Probe HTTP / qualquer chamada externa a partir do ProPlan** — **recusado pelo PI em 2026-07-14** (ADR-018 negado). Consequência aceita: **domínio próprio não é identificável** por plataforma; a fatia se limita a URLs com domínio-de-plataforma. Reabrir exigiria o PI rever essa decisão.
- **APIs de plataforma com credencial** (Railway/Netlify/Vercel) — o "outro produto". O ProPlan roda para qualquer repo e não pode assumir provedores conectados.
- **Descobrir a URL** — o dono declara; o produto não adivinha.
- **Inferir COMO se faz deploy / reescrever doc** (ADR-014). CTA leva ao arquivo.
- **Rotular fonte como "congelada/resíduo"** — o produto mostra data e natureza, nunca o adjetivo (Decisão Q4 do PI, 2026-07-14).
- **Nenhuma IA.** Handoff → Fatia 13.5. Infra não documentada (Redis órfão) → fora.

## Contratos

**Prisma** (colunas em `Project`):
```
deployVerdict    String?   // concordam | discordam | so_github_side | omissa | silencio
deploySignals    Json?     // [{ source: "doc"|"repoConfig"|"githubDeployments"|"declaredUrl",
                           //    platforms: string[], observedAt: iso, evidenceRef: string }]
deployObservedAt DateTime?
```

**Declaração do dono** (`.proplan/config.yml` — Decisão Q2/Q3 do PI; é config do ProPlan, não toca `docs/`):
```yaml
deploy:
  prodUrls:                          # LISTA (Q3) — front e API podem ser plataformas diferentes
    - https://escola-erp.netlify.app
    - https://escola-api-production-26c1.up.railway.app
    - url: https://gestao.epgtrindade.com.br   # domínio próprio: plataforma opcional declarada à mão
      platform: netlify                          # (sem isto, fica "desconhecida" — o produto não chuta)
```

**Domínio puro e testável** (`ingestion/domain/deploy-drift.ts`, sem banco nem rede):
```ts
extractDeclaredPlatforms(markdown: string): string[]
platformsFromRepoConfig(rootFileList: string[]): {platform: string, file: string}[]
platformFromDeclaredUrl(url: string): string | null   // parse de sufixo de domínio; null = domínio próprio
reconcile(signals: DeploySignal[]): DeployVerdict      // o coração — onde os testes mordem
```

**API**: sem endpoint novo — campos entram no payload da aba Deploy (aditivo, como a SPEC-012) e do catálogo.

## Critérios de aceite (com o caso real verificado)

- [ ] `rrb-escola` **com `escola-erp.netlify.app` + `...railway.app` declaradas** → **`discordam`**, sem nenhuma chamada externa: UI mostra `config: Vercel · GitHub: Vercel · URL declarada: Netlify + Railway`, cada uma com data, **sem afirmar qual é a verdadeira**.
- [ ] `rrb-escola` **sem URL declarada** → **`so_github_side`**: **não crava Vercel**; mostra CTA "declare a URL de produção". Não mente confiança.
- [ ] URL declarada com **domínio próprio sem `platform` à mão** → plataforma `desconhecida`, **não confrontada**, sem falso positivo.
- [ ] `rrb-adv` (nada) → **silencioso**.
- [ ] Nenhuma frase de UI diz "roda em X" nem rotula fonte como "congelada/resíduo". Toda afirmação traz natureza + "observado em <data>".
- [ ] Repo sem permissão de Deployments no GitHub App → degrada com mensagem explícita.
- [ ] **Zero IA · zero chamada externa · zero credencial de plataforma** (verificável).
- [ ] `reconcile()` + `platformFromDeclaredUrl()` testados: 5 estados; "migramos da Vercel" (menção casual não vira `discordam`); caso `rrb-escola` real (config+GitHub Vercel × URL Netlify+Railway → `discordam`); domínio próprio → `desconhecida`.

## Notas técnicas

- **Custo por sync**: +2 requests GitHub (deployments + environments), +1 por deployment recente (status). **Nenhuma** chamada fora do GitHub.
- **Permissão GitHub App** (ADR-015): `Deployments: read` (concedido nesta instalação em 2026-07-14). Leitura com user-to-server token.
- **`platformFromDeclaredUrl`** usa lista de sufixos conhecidos; sufixo não reconhecido → `null` (domínio próprio), nunca chute.

## Dependência honesta — o furo do `CONVENTION.md`

O `rrb-escola` tem front (Netlify) + API (Railway) **no mesmo ambiente** — por isso `prodUrls` é **lista** (Q3). A tabela canônica de Deploy tem um eixo (ambiente) e não comporta **componente**; precisa de três eixos (ambiente × componente × infra). Não bloqueia esta fatia (o confronto não depende do formato da tabela). Item próprio no `STATUS.md`; ADR-014: mexer no formato é convite, nunca exigência.

## Perguntas abertas

Nenhuma bloqueante. As 4 decisões do PI (2026-07-14) estão incorporadas:
1. **ADR-018 (probe HTTP): negado** → a fatia obtém o sinal fresco por parse-de-string; domínio próprio fica fora (limite aceito).
2. **Declaração da URL**: `.proplan/config.yml → deploy.prodUrls` (ok).
3. **Lista** de URLs (front + API): sim.
4. **Caveat de fonte**: mostrar natureza + data, **nunca** rótulo inferido ("congelada/resíduo").

> **Decisão de desenho que assumi (não bloqueante, aponto para ciência do PI):** domínio próprio sem `platform` declarada à mão → plataforma `desconhecida`, fora do confronto. É a consequência direta do ADR-018 negado; se o PI quiser cobrir domínio próprio, ou reabre o probe, ou aceita declarar a plataforma junto da URL (já suportado no `config.yml`).
