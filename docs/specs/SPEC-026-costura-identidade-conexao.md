---
proplan: v1
spec: SPEC-026
fatia: pós-MVP1 · Frente Identidade (1/2)
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-20
---
# SPEC-026 — Costura identidade ⊥ conexão (Google como 1º IdP)

> **Pós-MVP1.** Nada a codificar no MVP1. Rege o ADR-021 (atualização 2026-07-20). É a fundação de que a SPEC-025 depende. **Frente própria — não é MVP2** (`docs/specs/MVP2.md`, cuja tese é memória verificável; esta não passa pelo critério de corte daquele documento).
>
> ⚠️ **Isto é REFATORAÇÃO, não greenfield.** O módulo `identity` **já existe e é robusto** (`github-auth.service`, `membership.service`, `installation-token.service`, `github-oauth.client`, `github-installations.client`, `tenant.guard`, `require-role.decorator`, `jwt-auth.guard`). Hoje **a identidade É o GitHub App** — o `userToken` do OAuth do App é a própria sessão. Esta spec **desacopla** a sessão de app da conexão GitHub dentro desse módulo vivo.
>
> ⚠️ **Depende da Fatia 8 (multi-tenant/RBAC, SPEC-022) estar estabilizada.** Ela está **em andamento** (PRs #88/#89) e mexe exatamente neste módulo (`membership.service`, `tenant.guard`). Iniciar a costura antes de a Fatia 8 fechar = conflito garantido. **Não paralelizar.**

## Objetivo

Separar **quem o usuário é** (identidade / sessão do app) de **o que ele conectou** (GitHub hoje; outras fontes depois), para que o ProPlan deixe de ser "só git": a sessão do app sobrevive à perda de qualquer conexão, e novas fontes/IdPs entram como plugue, não como reescrita.

## Modelo

- **Identidade** = a conta no ProPlan, autenticada por um **IdP plugável**. Primeiro IdP: **Google (OAuth)**. O modelo não amarra ao Google.
- **Conexão** = um vínculo plugável pendurado na identidade (ex.: GitHub App, via SPEC-008/ADR-015). **Schema 1:N** (uma identidade → N conexões) desde já; **UI expõe 1 conexão** (GitHub) no começo — barato no schema, evita migração depois.
- **Sessão do app** deriva da identidade, **não** de nenhuma conexão. Perder/desconectar uma conexão **não** encerra a sessão.

## Fluxo de entrada (novo)

1. **Login** por IdP (Google) → cria/abre a sessão do app.
2. **Catálogo** como porta de entrada. Sem conexão GitHub ativa, mostra CTA **conectar GitHub**.
3. **Conectar GitHub** = o **OAuth do App inteiro** (ADR-015) — não é toggle. Concede o token user-to-server (leitura, respeita visibilidade) e vincula a instalação.
4. A partir daí, catálogo/workspace funcionam como hoje.

## Ambiente (decisão do PI, 2026-07-20)

Esta frente **encerra o "100% local"**: Google OAuth exige nuvem — coerente com o pós-MVP1/comercialização já assumidos no ADR-015. O **ambiente de dev ganha um IdP local (conta fake)** para não exigir Google no desenvolvimento; Google é o IdP de produção.

## Escopo

1. **Refatorar o módulo `identity` existente**: extrair a **conta/sessão de app** do que hoje é o login GitHub. Adicionar **IdP plugável** — **Google** (produção) + **IdP fake** (dev). O `github-auth.service` deixa de *ser* a identidade e passa a alimentar uma **conexão**.
2. Entidade **`Connection`** (GitHub como primeiro tipo, relação **1:N**): mover `userToken`/`installationId`/installation-token para cá (hoje no `identity`), desacoplados da conta.
3. Novo fluxo de entrada (login IdP → catálogo → conectar GitHub).
4. **Migração dos usuários atuais**: identidade-GitHub → identidade própria + conexão-GitHub, **automática no primeiro login pós-deploy**.
5. **Integração ADR-015**: leitura continua exigindo o token user-to-server da conexão GitHub; escrita continua com installation token (`proplan[bot]`). A conexão guarda esses tokens; a identidade, não.
6. **Integração ADR-020**: o array de membership de tenant deriva do **`userId` da identidade autenticada** (Google) via `identity` — a mesma porta que o RLS usa. RLS/tenant não podem depender de conexão.

## Fora de escopo

- Desconectar/reconectar conexão → **SPEC-025** (depende desta).
- Segunda fonte de ingestão real (GitLab/Jira/Notion) — esta spec só deixa a **forma** plugável; nenhuma segunda fonte é implementada aqui.
- Features não-GitHub em si — **não há nenhuma planejada** (decisão do PI: deixar a costura pronta e dormente; o layout de features futuras vem quando forem implementadas). A sessão persistente fica construída, mesmo que só renda depois.

## Critérios de aceite

- [ ] Usuário loga por Google (prod) ou IdP fake (dev) e chega ao Catálogo **sem** nenhuma conexão GitHub.
- [ ] Conectar GitHub completa o OAuth do App e vincula a conexão à identidade (schema 1:N).
- [ ] Desconectar a conexão GitHub (SPEC-025) **não** encerra a sessão do app.
- [ ] Usuário pré-existente (identidade-GitHub) é migrado para identidade + conexão **no primeiro login pós-deploy**, sem perder projetos/tenant.
- [ ] O array de membership de tenant (ADR-020) é derivado da identidade, não da conexão — verificável por teste de RLS.
- [ ] Nenhuma leitura de docs ocorre com installation token (ADR-015 intacto).

## Contratos

Assinaturas a detalhar na implementação. Prováveis: fluxo OAuth do IdP (Google/dev) para a sessão; `Connection` com tipo (`github`), tokens e estado (ativa/desconectada); membership de tenant lido de `identity` por `userId`.

## Notas técnicas

- **Raio de impacto (código existente)**: `identity/application/github-auth.service.ts` (deixa de ser identidade), `membership.service.ts` (passa a derivar de conta, não de GitHub), `infrastructure/github-oauth.client.ts` + `installation-token.service.ts` + `github-installations.client.ts` (viram infra da `Connection`), `presentation/jwt-auth.guard.ts` + `tenant.guard.ts` + `require-role.decorator.ts` (sessão agora é de conta). É o coração da auth — mudança cirúrgica e testada.
- **ARCHITECTURE.md** (§Identity, hoje "GitHub App = Identity") precisa ser reescrito para o modelo conta ⊥ conexão e registrar `Connection` — atualização de doc é escopo da entrega.
- **Menu de Configurações** (SPEC-021/SPEC-020) ganha as ações de conta: **Sair da conta** (encerra a sessão — rótulo neutro) é distinto de **Desconectar GitHub** (vermelho, SPEC-025). Coordenar a criação de `/settings` com a SPEC-025 para não duplicar.

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-20: local-only **encerra** nesta frente + **IdP fake no dev** · vínculo **1:N no schema, 1 conexão na UI** · migração **automática no 1º login pós-deploy** · **sem** feature não-GitHub por ora (costura pronta e dormente, layout depois) · rótulos: **Sair da conta** (neutro) × **Desconectar GitHub** (vermelho).
