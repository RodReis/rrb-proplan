---
proplan: v1
spec: SPEC-017
fatia: 6.2
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada 2026-07-14 (3 decisões do PI incorporadas)
updated: 2026-07-14
---
# SPEC-017 — Formato de Deploy: um eixo × três eixos (o furo do `CONVENTION.md`)

> Sequência da família Deploy (SPEC-012 = renderizar o doc; SPEC-013 = drift). Esta fecha o **modelo**: a tabela canônica de Deploy tem **um eixo (ambiente)**, e a realidade dos repos reais tem **três (ambiente × componente × infra de apoio)**.

## O furo (evidência dupla, verificada)

O formato canônico hoje: `| Ambiente | Status | Plataforma | URL |` — **um eixo: ambiente** (produção, homolog). Foi escrito assumindo deploy monolítico. Duas evidências independentes de que não cabe:

1. **`rrb-escola`** — front no **Netlify** e API no **Railway**, no **mesmo** ambiente (produção). Para caber no formato atual, seria preciso escrever `produção (API)` / `produção (web)` na coluna *Ambiente* — **componente enfiado à força no campo de ambiente, o modelo mentindo sobre a estrutura**.
2. **`rrb-organize`** — **2× Redis** rodando no Railway (`redis-volume`, `redis-volume-bgPY`, provável órfão pago) e **não há onde escrevê-los**: a tabela tem campo para *plataforma*, nenhum para **infra de apoio**. O dono não esqueceu o Redis — **não existia campo**.

O próprio exemplo do `CONVENTION.md` esconde o problema colando dois provedores num `+`: `Vercel + Supabase` numa célula só — app e banco fundidos onde deviam ser linhas distintas. **É falha de modelo, não de zelo:** melhorar disciplina de documentação não pega isto.

## Por que agora — é dependência viva da SPEC-013

A SPEC-013 (entregue) tem um CTA *"corrija a doc"* quando detecta drift de deploy. Hoje esse CTA aponta para um formato que **não comporta** front-Netlify + API-Railway (o caso `rrb-escola`). Sem esta correção, o produto detecta o problema e manda o humano consertar num formato que não deixa consertar. Esta fatia torna a 13 honesta de ponta a ponta.

## Objetivo

Dar à tabela canônica de Deploy os **três eixos reais** — ambiente × componente × infra de apoio — **sem quebrar** os `docs/DEPLOY.md` existentes no formato de 4 colunas e **sem transformar o formato em exigência** (ADR-014: o formato é convite, nunca requisito; SPEC-012).

## Escopo

1. **Novo formato canônico** (proposta — ver Perguntas abertas 1): promover **Componente** a coluna de primeira classe. A infra de apoio (Redis, banco) vira **linha de componente**, não um eixo à parte:
   ```markdown
   ## Ambientes
   | Ambiente | Componente | Status | Plataforma | URL |
   |---|---|---|---|---|
   | produção | web  | ativo | Netlify | https://escola-erp.netlify.app |
   | produção | API  | ativo | Railway | https://escola-api-production-26c1.up.railway.app |
   | produção | banco | ativo | Supabase | — |
   | produção | cache (redis-volume) | ativo | Railway | — |
   ```
   Chave de uma linha: **(ambiente, componente)**. Três eixos colapsam em 2D sem forçar nada: ambiente e componente viram colunas; "infra de apoio" é só um componente com papel de apoio.
2. **`parseDeploy` vira header-aware** (`board/domain/deploy-doc.ts`) — lê os **nomes das colunas** do cabeçalho e mapeia, em vez de posições fixas. Assim **o formato de 4 colunas (sem `Componente`) continua parseando** (compat v1 por ≥1 ciclo — regra da `CONVENTION.md`). `Componente` ausente → componente único implícito (o caso monolítico, inalterado).
3. **`DeployEnv`** ganha `componente?: string` (opcional). `DeployTab.tsx` agrupa por **ambiente**, com os componentes como linhas sob ele.
4. **`CONVENTION.md`** — atualizar a tabela de exemplo de Deploy para o formato de 3 eixos + nota de compat; **incrementar a versão da convenção** (mudança de formato). O exemplo deixa de colar `Vercel + Supabase` numa célula.

## Fora de escopo (explícito)

- **Tornar a tabela obrigatória.** Continua sendo **convite** (SPEC-012): repo sem tabela renderiza o doc como está; repo com a tabela de 4 colunas segue funcionando. `Componente` é **opcional** — monolito não precisa preencher (ver PA-2).
- **Fallback de IA em Deploy.** Permanece proibido (`CONVENTION.md`). Esta fatia mexe no **formato que o humano preenche**, não em inferência.
- **Ler a plataforma real / probe** — isso é SPEC-013/13.6. Aqui é só **onde o humano escreve** o que ele sabe.
- **Detecção automática de infra de apoio** (o Redis órfão) — exige falar com a plataforma (fora do ADR-003). Esta fatia só dá **o campo** onde o humano registra; não descobre sozinha.
- **Renomear/mover documento do repo** (ADR-014).

## Contratos

- **Domínio** (`board/domain/deploy-doc.ts`): `parseDeploy` reescrito **header-aware**; `DeployEnv` = `{ ambiente, componente?, status, plataforma, url }`. Testes: o fixture antigo de 4 colunas **passa sem alteração** (prova de compat); novo fixture de 5 colunas cobre `rrb-escola` (2 componentes, 1 ambiente) e `rrb-organize` (app + 2× redis).
- **UI** (`DeployTab.tsx`): agrupamento por ambiente → componentes como sub-linhas. Sem componente → uma linha (comportamento atual).
- **`CONVENTION.md`**: tabela de exemplo nova + versão incrementada + nota de compat de um ciclo.
- **Sem Prisma novo** — o parse é derivado do doc no render/sync como hoje; nada persiste a mais.

## Critérios de aceite

- [ ] `docs/DEPLOY.md` **de 4 colunas** (formato atual) **continua parseando e renderizando** igual — compat provada por fixture inalterado.
- [ ] `docs/DEPLOY.md` **de 5 colunas** com `Componente` → painel agrupa por ambiente, componentes como linhas; o caso `rrb-escola` (produção: web/Netlify + API/Railway) aparece **sem enfiar componente no campo ambiente**.
- [ ] Infra de apoio (`rrb-organize`: 2× redis) tem **onde ser escrita** — linhas de componente com papel de apoio; nada de `+` colando provedores.
- [ ] `Componente` **ausente** → componente único implícito; monolito não é forçado a preencher.
- [ ] `CONVENTION.md` atualizado (exemplo de 3 eixos, versão incrementada, nota de compat).
- [ ] O CTA "corrija a doc" da SPEC-013 passa a apontar para um formato que **comporta** o caso multi-componente.
- [ ] Zero IA; formato é convite, não exigência (repo que não adota não é penalizado).

## Notas técnicas

- **Supersede o "parseDeploy não muda" da SPEC-012** — aquela fatia preservou o parser de propósito (não era o escopo dela); esta o reescreve header-aware **de forma retrocompatível**. É evolução consciente, não regressão.
- **ADR-014 — impacto amplo**: mexer no formato canônico afeta **todo repo que adotar a convenção**. Hoje o universo é os `rrb-*`, e o formato é convite — risco baixo e controlado. Mesmo assim, a compat de um ciclo é obrigatória para não quebrar quem já escreveu 4 colunas.
- **Ligação com SPEC-013**: `deploy.prodUrls` da 13 já é **lista** (front + API) — o eixo componente aqui é o mesmo conceito do lado da doc humana. Os dois modelos passam a concordar sobre "um deploy tem componentes".

## Decisões do PI (2026-07-14) — nenhuma pergunta aberta

1. **3º eixo colapsado no `Componente`** — infra de apoio é linha de componente com papel de apoio (`cache (redis-volume)`). Tabela 2D, um parser, chave (ambiente, componente).
2. **`Componente` opcional** — monolito escreve 4 colunas como hoje; a coluna só aparece quando os componentes divergem. Compat v1 preservada; formato segue convite (ADR-014).
3. **Componente é texto livre** num primeiro corte (sem enum de papel). "papel" tipado só viria se a UI precisar distinguir apoio de app — fatia futura, se necessário.
