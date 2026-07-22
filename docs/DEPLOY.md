# DEPLOY.md — RRB ProPlan em produção

> **Runbook operacional.** Como o ProPlan roda fora do `docker-compose` local:
> onde cada peça mora, quais variáveis existem, como sobe e como se recupera.
> A implementação que torna isto possível está na **SPEC-027**
> (`docs/specs/SPEC-027-deploy-railway.md`). Este arquivo é a memória de operação;
> a spec é o contrato do que o Code entrega.

> **Decisão de escopo (PI, 2026-07-21):** este documento **encerra** a regra
> *"ambiente 100% local até o fim do MVP, sem deploy em nuvem"* do `CLAUDE.md`.
> A partir daqui existe produção. A mudança é registrada como ADR na entrega da
> SPEC-027 (ver §9) — não é decisão do runbook, é decisão do PI que o runbook cita.

---

## 1. Topologia

Um provedor de compute (**Railway**), um provedor de DNS (**Hostinger**). Nada de
Supabase nesta fase (ver §8).

```
                    Hostinger (só DNS)
   proplan.rrbtrading.com.br ──CNAME──► serviço web (Railway)
   api.proplan.rrbtrading.com.br ──CNAME──► serviço api (Railway)

   ┌─────────────────────── Railway (projeto único) ───────────────────────┐
   │                                                                        │
   │   web (Vite build, estático)  ──HTTPS──►  api (NestJS)                 │
   │                                             │                          │
   │                              rede privada    ├──► Postgres (Railway)    │
   │                                             └──► Redis (Railway/BullMQ) │
   └────────────────────────────────────────────────────────────────────────┘
```

| Peça | Onde | Papel |
|---|---|---|
| **web** | Railway (serviço) | SPA React/Vite servida como build estático, fallback SPA → `index.html`. Domínio custom `proplan.rrbtrading.com.br`. |
| **api** | Railway (serviço) | Monolito NestJS (HTTP + workers BullMQ in-process). Domínio custom `api.proplan.rrbtrading.com.br`. |
| **Postgres** | Railway (plugin/serviço) | Banco de produção. Substitui o Postgres do `docker-compose`. |
| **Redis** | Railway (plugin/serviço) | Fila BullMQ (sync, insight, board workers). Supabase **não** tem Redis — por isso fica no Railway. |
| **DNS** | Hostinger | Só resolve os dois subdomínios para o Railway. Sem hospedagem de arquivo na Hostinger. |

**Por que tudo no Railway:** web e api ficam sob o mesmo domínio registrável
(`rrbtrading.com.br`), logo são *same-site* — o cookie de sessão viaja com
`SameSite=Lax` sem gambiarra de `SameSite=None`. Postgres e Redis na rede privada
do Railway = latência baixa e **zero egress entre provedores**. Como a conta é
**Railway Pro**, o Postgres não adiciona assinatura: paga-se só o consumo
(storage ~US$0,25/GB-mês + CPU/RAM sob uso), boa parte coberta pelo crédito já
incluso no Pro.

---

## 2. Serviços no Railway

Projeto: `https://railway.com/project/e598fd0c-45bb-4f0f-ac32-e419ba695f8e`

Três/quatro serviços no mesmo projeto (compartilham a rede privada):

1. **Postgres** — plugin do Railway. Expõe as *reference variables*
   (`${{Postgres.DATABASE_URL}}`, host/porta/usuário privados).
2. **Redis** — plugin do Railway. Expõe `${{Redis.REDIS_URL}}`.
3. **api** — root do repo apontando para `apps/api` (monorepo pnpm). Build via
   Dockerfile de produção (a criar na SPEC-027). Healthcheck em `/health`.
4. **web** — root apontando para `apps/web`. Build do Vite; serve estático.

> **Monorepo:** cada serviço define seu *root directory* (`apps/api`, `apps/web`)
> e o Railway builda só aquela pasta. O `pnpm-workspace.yaml` continua sendo a
> fonte das dependências.

---

## 3. Variáveis de ambiente (produção)

Base em `.env.example`. **Nenhum secret entra no repo** — todos vivem nas
*Variables* do serviço no Railway.

### 3.1 Serviço `api`

| Variável | Valor de produção | Origem |
|---|---|---|
| `DATABASE_URL` | conexão da role **não-owner** `proplan_app` (runtime, sujeita a RLS) | derivada do Postgres do Railway (ver §5) |
| `DIRECT_URL` | conexão da role **owner** (migrations/DDL) | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | reference variable |
| `FRONTEND_URL` | `https://proplan.rrbtrading.com.br` | fixo |
| `API_URL` | `https://api.proplan.rrbtrading.com.br` | fixo |
| `API_PORT` | porta que o Railway injeta (`$PORT`) — a API deve ler `PORT`/`API_PORT` | Railway |
| `GITHUB_APP_ID` | ID numérico do App | GitHub App |
| `GITHUB_APP_CLIENT_ID` | `Iv23...` | GitHub App |
| `GITHUB_APP_CLIENT_SECRET` | secret do App | GitHub App |
| `GITHUB_APP_SLUG` | slug da URL do App | GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | PEM da chave privada em **base64 (uma linha)** | GitHub App |
| `JWT_SECRET` | `openssl rand -hex 32` | gerado |
| `TOKEN_ENCRYPTION_KEY` | **exatamente 32 bytes hex** (`openssl rand -hex 32`) | gerado |
| `ANTHROPIC_API_KEY` | chave | provedor de IA |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `HERMES_API_KEY` | opcionais (provedor sem chave fica desabilitado — ADR-008) | provedor |
| `LLM_MODEL_ANTHROPIC` etc. | modelos por provedor | fixo |
| `GITHUB_WEBHOOK_SECRET` | secret do webhook (só quando a fatia de webhook existir) | GitHub App |

### 3.2 Serviço `web`

| Variável | Valor | Nota |
|---|---|---|
| `VITE_API_URL` | `https://api.proplan.rrbtrading.com.br` | **baked no build** — muda a URL ⇒ rebuild do web |

> **Atenção ao `VITE_`:** variáveis Vite são resolvidas em *build*, não em runtime.
> Trocar a URL da API exige **novo build** do serviço web, não só editar a variável.

---

## 4. DNS na Hostinger

Domínio: `proplan.rrbtrading.com.br`

1. No painel da Hostinger, zona DNS de `rrbtrading.com.br`.
2. Criar **CNAME** `proplan` → alvo do domínio custom do **serviço web** no Railway.
3. Criar **CNAME** `api.proplan` → alvo do domínio custom do **serviço api** no Railway.
4. No Railway, em cada serviço, adicionar o *custom domain* correspondente e
   aguardar o Railway emitir o certificado TLS (Let's Encrypt).
5. Validar HTTPS nos dois hosts antes de configurar o GitHub App (§6).

---

## 5. Banco: migrations, role não-owner e RLS

O modelo de dados depende de **duas roles** (ADR/SPEC-022):

- **owner** — dono do schema, roda DDL. Usada só por `prisma migrate deploy` via `DIRECT_URL`.
- **`proplan_app`** — **não-owner, não-superuser** — usada pelo runtime via
  `DATABASE_URL`. É o que torna o **RLS efetivo**: Postgres *pula* RLS para
  superuser e owner, então rodar a aplicação como owner desligaria o isolamento
  multi-tenant **silenciosamente**.

No dev, a role `proplan_app` nasce do init do Docker
(`docker/postgres-init/01-app-role.sql`). **Esse init NÃO roda no Railway** — o
Postgres do Railway não executa `docker-entrypoint-initdb.d`. Portanto, em
produção a role é criada por um **passo de bootstrap explícito**, uma vez por
banco (detalhado na SPEC-027):

1. Provisionar o Postgres no Railway.
2. Rodar o script de bootstrap (equivalente ao `01-app-role.sql`) com a **senha
   de produção** de `proplan_app` vinda de secret — **nunca** commitada.
3. Montar `DATABASE_URL` com `proplan_app:<senha>@<host privado>`.
4. `prisma migrate deploy` (usando `DIRECT_URL`, role owner) aplica o schema +
   as políticas RLS que já vivem nas migrations da SPEC-022.

> **Migration não chama a rede.** Nada de `fetch` dentro de migration — o deploy
> não pode depender de token/API de pé (mesmo princípio do `accountId` nullable
> da Fatia 8).

---

## 6. GitHub App em produção (ADR-015)

O App é o mesmo; mudam as URLs de `localhost` para produção. Em
**Settings → Developer settings → GitHub Apps → (o App do ProPlan)**:

- **Callback URL:** `https://api.proplan.rrbtrading.com.br/auth/github/callback`
- **Webhook URL:** endpoint de webhook da API **quando a fatia existir**
  (`GITHUB_WEBHOOK_SECRET` está marcado como "fatia futura" no `.env.example`).
- **Permissões e escopos:** inalterados (ADR-015). Leitura via *user-to-server*;
  escrita via *installation token* (`proplan[bot]`).

> O catálogo só lista repositórios onde o App está **instalado** — a instalação é
> ato do dono no github.com e persiste independentemente do deploy.

---

## 7. CI/CD — auto-deploy no push para `main`

Railway conectado ao repositório GitHub. **Todo merge em `main` builda e publica.**

Ordem por serviço:

1. Railway detecta o push, builda a imagem do serviço afetado.
2. **api:** *pre-deploy / release command* roda `prisma migrate deploy`
   (via `DIRECT_URL`) **antes** de trocar o processo. Migração falha ⇒ deploy
   aborta, versão anterior segue no ar.
3. Healthcheck em `/health` decide se a nova versão assume o tráfego.
4. **web:** rebuild do Vite (pega `VITE_API_URL`) e publica o estático.

> **Cuidado com a ordem migração→deploy:** migração que remove/renomeia coluna
> ainda usada pela versão anterior derruba a app durante a janela. Migrations
> destrutivas seguem o padrão *expand → migrate → contract* em PRs separados.

---

## 8. Supabase — reservado, sem função ativa

O projeto Supabase (`https://supabase.com/dashboard/project/eswflurmwpgpbgdqbkph`)
foi provisionado, mas **não tem papel nesta fase**:

- O **banco** é o Postgres do Railway (§5), não o Supabase.
- O **auth** é GitHub App (ADR-015), não Supabase Auth.
- O free tier do Supabase **pausa após 7 dias sem request** — impróprio para uma
  app que fica ociosa; login e sync cairiam até resumir na mão.

Fica **reservado**. Se um dia entrar (ex.: object storage para exports/artefatos),
exige ADR próprio dizendo **que dado** vai para lá. Até então, o runbook não finge
integração que não existe.

> **Pendência de doc:** o `ARCHITECTURE.md` ainda desenha o banco como
> "PostgreSQL / Supabase". A SPEC-027 corrige essa linha para Railway.

---

## 9. Impacto em documentos (o que a entrega da SPEC-027 atualiza)

- **`CLAUDE.md`** — remove/emenda *"ambiente 100% local até o fim do MVP; sem
  deploy em nuvem"*. Passa a citar este DEPLOY.md e a produção Railway.
- **`docs/ARCHITECTURE.md`** — banco "PostgreSQL/Supabase" → "PostgreSQL (Railway)".
- **`docs/DECISIONS.md`** — novo ADR: encerramento do local-only + escolha
  Railway (compute+banco+fila) e Hostinger (DNS); Supabase reservado.
- **`docs/STATUS.md` / `docs/DEVELOPMENT.md`** — a fatia de deploy entra no índice
  e no status (fecha o furo já registrado no MVP2: *"o `DEPLOY.md` precisa ter
  onde escrever"*).

---

## 10. Recuperação rápida

| Sintoma | Primeira verificação |
|---|---|
| Deploy da api falhou | Logs do release command — quase sempre `prisma migrate deploy` (`DIRECT_URL` errada ou migração destrutiva). |
| App sobe mas login não persiste | Cookie `Secure` ausente em HTTPS, ou `FRONTEND_URL`/CORS divergente do host real. |
| Queries multi-tenant "vendo tudo" | Runtime conectou como **owner/superuser** em vez de `proplan_app` — RLS virou no-op. Conferir a `DATABASE_URL`. |
| Sync/insight não processam | Redis fora do ar ou `REDIS_URL` não resolvida (reference variable). |
| 404 ao dar F5 numa rota | Fallback SPA → `index.html` não configurado no serviço web. |
| GitHub OAuth quebra | Callback URL do App ≠ `https://api.proplan.rrbtrading.com.br/auth/github/callback`. |

---

_Última atualização: 2026-07-21 — criado junto da SPEC-027 (aprovada-pi)._
