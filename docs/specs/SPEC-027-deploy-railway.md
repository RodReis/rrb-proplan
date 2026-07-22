---
proplan: v1
spec: SPEC-027
fatia: Deploy em produção (pós-MVP) — Railway (compute+banco+fila) + Hostinger (DNS)
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-21
---
# SPEC-027 — Deploy em produção: Railway + Hostinger DNS

> **Encerra o "local-only".** Esta fatia levanta a regra do `CLAUDE.md`
> *"ambiente 100% local até o fim do MVP; sem deploy em nuvem"* (decisão do PI em
> 2026-07-21). O runbook operacional é o `docs/DEPLOY.md`; esta spec é o contrato
> do que o Code implementa e commita.

## Objetivo

Colocar o ProPlan no ar em `https://proplan.rrbtrading.com.br`, com deploy
automático no push para `main`, banco e fila próprios, e o login GitHub App
funcionando ponta a ponta em HTTPS — sem quebrar o isolamento multi-tenant (RLS).

## Escopo

1. **Dockerfiles de produção** para `apps/api` e `apps/web` (não existem hoje).
   - `api`: build Nest (`nest build`) → runtime `node dist/main.js`. Imagem enxuta
     (multi-stage), Prisma client gerado no build.
   - `web`: build Vite (`tsc -b && vite build`) → servido como **estático** com
     **fallback SPA → `index.html`** (nginx, Caddy ou `serve` — escolha do Code,
     a mais simples que entregue o fallback e HTTPS via Railway).
2. **Endpoint `/health`** na API (não existe) — 200 quando o processo está de pé;
   usado pelo healthcheck do Railway. Checagem de DB/Redis é opcional (se incluir,
   não pode derrubar o health por falha transitória de fila).
3. **API lê a porta do Railway** — aceitar `PORT` (injetada pelo Railway) além de
   `API_PORT`; hoje `main.ts` só lê `API_PORT`.
4. **Cookies seguros em produção** — o cookie de sessão (`proplan_session`) e o
   `STATE_COOKIE` ganham `secure: true` **quando em produção** (gate por env, ex.
   `NODE_ENV==='production'` ou flag explícita). Mantém `sameSite: 'lax'` (web e
   api são subdomínios do mesmo domínio registrável → *same-site*). Não introduzir
   `SameSite=None`.
5. **Migração e role em produção reproduzíveis fora do Docker init:**
   - *Release command* do serviço api roda `prisma migrate deploy` (via
     `DIRECT_URL`), **não** `migrate dev`.
   - Passo de **bootstrap da role `proplan_app`** (não-owner, não-superuser)
     equivalente ao `docker/postgres-init/01-app-role.sql`, executável uma vez
     contra o Postgres do Railway, com **senha vinda de secret** (nunca no repo).
     Documentar o comando no `DEPLOY.md` (já há §5 apontando o passo).
6. **Configuração dos serviços Railway** versionada quando fizer sentido
   (`railway.json`/toml por serviço ou Dockerfile-only) — *root directory* por app
   no monorepo pnpm; api com release command + healthcheck `/health`.
7. **Atualização de documentos** (escopo obrigatório da entrega, não "melhoria
   adjacente"): `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (ADR novo),
   `docs/STATUS.md`, `docs/DEVELOPMENT.md`. Ver §"Contratos" e §"Notas técnicas".

## Fora de escopo

- **Supabase** — reservado, sem função ativa nesta fatia (`DEPLOY.md` §8). Nenhum
  código o integra aqui.
- **Postgres no Supabase** — o banco é o Railway (decisão do PI). Não provisionar
  dois bancos.
- **Webhook do GitHub** — `GITHUB_WEBHOOK_SECRET` segue "fatia futura"
  (`.env.example`). Configurar só a **Callback URL** do App; não implementar
  recebimento de webhook.
- **Staging separado** — só produção nesta fatia. Ambiente de preview é fatia
  posterior se o PI quiser.
- **Observabilidade/alertas** (Datadog, Sentry etc.) — fora; fatia própria.
- **Migrations destrutivas** — se alguma for necessária, sai em PR próprio no
  padrão expand→migrate→contract; não faz parte desta entrega.

## Critérios de aceite

- [ ] `https://proplan.rrbtrading.com.br` serve a SPA; F5 e link direto em qualquer
      rota resolvem (fallback SPA → `index.html`), sem 404 de rota do cliente.
- [ ] `https://api.proplan.rrbtrading.com.br/health` responde 200.
- [ ] Push mergeado em `main` dispara build+deploy no Railway; `prisma migrate
      deploy` roda no release **antes** do processo assumir tráfego; migração que
      falha **aborta** o deploy e mantém a versão anterior no ar.
- [ ] Login GitHub App completo em produção: `/auth/github` → callback em
      `https://api.proplan.rrbtrading.com.br/auth/github/callback` → sessão
      persiste (cookie `Secure`, `HttpOnly`, `SameSite=Lax`) → `/auth/me` autentica.
- [ ] Runtime conecta como `proplan_app` (não-owner): um teste/checagem de
      isolamento multi-tenant **prova** que o RLS está ativo em produção (uma query
      sem contexto de tenant não retorna linhas de outro tenant).
- [ ] Workers BullMQ (sync/insight/board) processam em produção usando o Redis do
      Railway (`REDIS_URL` resolvida por reference variable).
- [ ] `CLAUDE.md` não afirma mais "sem deploy em nuvem"; passa a referenciar
      `docs/DEPLOY.md`.
- [ ] `docs/ARCHITECTURE.md` descreve o banco como PostgreSQL no Railway (não
      "Supabase").
- [ ] `docs/DECISIONS.md` tem o ADR desta decisão (encerrar local-only; Railway +
      Hostinger; Supabase reservado).
- [ ] `docs/STATUS.md` e `docs/DEVELOPMENT.md` refletem a fatia entregue.

## Contratos

Endpoints/arquivos que a fatia cria ou altera (assinatura, não implementação):

- `GET /health` → `200` (corpo mínimo, ex. `{ status: 'ok' }`).
- `apps/api/Dockerfile`, `apps/web/Dockerfile` (novos).
- `apps/api/src/main.ts` — leitura de `PORT`/`API_PORT`.
- `apps/api/src/modules/identity/presentation/auth.controller.ts` — flag `secure`
  condicional nos dois `res.cookie`.
- Script/comando de bootstrap da role `proplan_app` para o Postgres do Railway
  (reaproveitando o SQL de `docker/postgres-init/01-app-role.sql`, parametrizando a
  senha por env).
- Config de release/healthcheck do Railway (arquivo por serviço, se versionado).
- Sem novo modelo Prisma. RLS já existe (SPEC-022) — aqui só se garante que **roda**
  em produção.

## Notas técnicas

- **ADR-015** — GitHub App: leitura user-to-server, escrita installation token.
  Só muda a Callback URL para o host de produção; sem mudança de fluxo.
- **SPEC-022 / RLS** — a role `proplan_app` **não-owner/não-superuser** é o que faz
  o RLS valer. Rodar a app como owner desliga o isolamento **silenciosamente**.
  Este é o risco #1 da fatia — o critério de aceite de isolamento existe por isso.
- **Same-site** — web (`proplan.rrbtrading.com.br`) e api
  (`api.proplan.rrbtrading.com.br`) compartilham o domínio registrável
  `rrbtrading.com.br`; `SameSite=Lax` basta e é preferível a `None`. CORS já usa
  `FRONTEND_URL` com `credentials: true` (`main.ts`) — só garantir o valor de prod.
- **Migration não chama a rede** — nada de `fetch` em migration; o deploy não pode
  depender de token/API de pé (mesmo princípio do `accountId` nullable, Fatia 8).
- **`VITE_API_URL` é build-time** — trocar a URL da API exige rebuild do web.
- **ADR-003 intacto** — o ProPlan continua lendo só `docs/` dos repos-alvo; deployar
  o *próprio* ProPlan não fala com Railway/Hostinger em nome de repo nenhum. Esta
  fatia é infra do produto, não feature que inspeciona infra alheia.
- **`docs/` × `.proplan/`** — o `DEPLOY.md` é conteúdo humano em `docs/` (mede
  frescor pelo ADR-010). Nada de artefato do ProPlan aqui.
- **Risco conhecido — ordem migração→deploy**: migração destrutiva derruba a versão
  anterior durante a janela; fora de escopo, mas o release command deve abortar o
  deploy se a migração falhar (não seguir em frente com schema divergente).

## Processo (trio)

- Título de card sugerido: `[SPEC-027][INFRA] Deploy em produção: Railway + Hostinger DNS`.
  (Sem `[MVP<n>]`/`[F<n>]` porque a fatia é pós-MVP e não tem número no índice
  Fatia↔SPEC — o Cowork adiciona a linha no `STATUS.md` ao criar a issue. Só entra
  token que é verdade.)
- Issue criada pelo **Cowork** (Backlog, assignee PI) quando esta spec entrar no
  board. Entrega pelo **Code** com PR `refs #N` (**nunca `closes`** — ADR-011).
- **Segredos são do PI/operação**, não do Code: `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`,
  senha de `proplan_app`, chaves de IA e do GitHub App entram nas *Variables* do
  Railway à mão. O Code entrega o mecanismo que os consome; não os inventa.

## Perguntas abertas

Nenhuma. Decisões do PI em 2026-07-21:

- **Topologia:** tudo no Railway (web+api+redis+postgres); Hostinger só DNS.
- **Banco:** Postgres no Railway (conta Railway Pro → custo marginal, sem pause do
  free-tier Supabase). Supabase **reservado**, sem função ativa.
- **Escopo:** produção real, MVP encerrado → ADR + edição do `CLAUDE.md`.
- **CI/CD:** auto-deploy no push para `main`.

Escolhas **técnicas** deixadas ao Code (não são escopo do PI): servidor estático do
web (nginx/Caddy/serve), formato da config do Railway (Dockerfile-only vs
`railway.json`), e forma exata do bootstrap da role (script psql vs task de release).
