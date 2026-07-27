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

Quatro serviços no mesmo projeto (compartilham a rede privada):

1. **Postgres** — template do Railway. Expõe as *reference variables*
   (`${{Postgres.DATABASE_URL}}`, host/porta/usuário privados).
2. **Redis** — template do Railway. Expõe `${{Redis.REDIS_URL}}`.
3. **`@proplan/api`** — build via `apps/api/Dockerfile`. Healthcheck em `/health`,
   release command com `prisma migrate deploy` (`apps/api/railway.json`).
4. **`@proplan/web`** — build via `apps/web/Dockerfile` (nginx servindo o build
   do Vite, com fallback SPA).

> **Monorepo — atenção ao contexto de build:** o *root directory* dos serviços
> **não** pode ser restrito a `apps/api`/`apps/web`. Os dois Dockerfiles esperam
> o contexto na **raiz** do repositório, porque `pnpm-lock.yaml` e
> `pnpm-workspace.yaml` vivem lá e sem eles o `pnpm install --frozen-lockfile`
> não resolve o workspace. O `dockerfilePath` de cada `railway.json` aponta para
> o arquivo dentro de `apps/*`.

> **O servidor MCP não é um serviço do Railway.** A SPEC-016 o define como
> processo **local (stdio)**: ele não escuta porta HTTP, então um container dele
> sobe sem nada com que conversar e morre no healthcheck. O serviço
> `@proplan/mcp` que a autodetecção do monorepo criou deve ser **removido** do
> projeto (a remoção exige 2FA no dashboard — não é possível por token de API).

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
| `NODE_ENV` | `production` | **obrigatória** — é o gate do `Secure` no cookie de sessão. Sem ela o login não persiste em HTTPS |
| `PORT` | injetada pelo Railway; a API lê `PORT` e cai em `API_PORT`/3311 | Railway (automática) |
| `GITHUB_APP_ID` | ID numérico do App | GitHub App |
| `GITHUB_APP_CLIENT_ID` | `Iv23...` | GitHub App |
| `GITHUB_APP_CLIENT_SECRET` | secret do App | GitHub App |
| `GITHUB_APP_SLUG` | slug da URL do App | GitHub App |
| `GITHUB_APP_PRIVATE_KEY` | PEM da chave privada em **base64 (uma linha)** | GitHub App |
| `GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` — **IdP da identidade** (SPEC-026), não do GitHub | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | secret do OAuth client | Google Cloud Console |
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

### 3.3 `DEV_AUTH_BYPASS` — só desenvolvimento local, **nunca** produção

> ⛔ **Estas duas variáveis não existem no Railway e não devem ser criadas lá.**
> Elas desligam a autenticação inteira.

| Variável | Valor em DEV | Produção |
|---|---|---|
| `DEV_AUTH_BYPASS` | `true` | **ausente** |
| `DEV_AUTH_USER_ID` | uuid de um usuário real do banco local | **ausente** |

**Por que existe** (decisão do PI, 2026-07-27): o consent screen do Google está
em modo *Testing* no Cloud Console, e recusa quem não está na lista de
**Usuários de teste** — a tela diz *"Acesso bloqueado"*. Isso trava o
desenvolvimento local por configuração **externa ao repositório**, que nenhum
deploy nosso conserta. Com o bypass ligado, `localhost:5180` abre já logado.

**Por que é seguro.** A regra (`identity/domain/dev-auth-bypass.ts`) exige as
três condições com **AND**, e a primeira é `NODE_ENV !== 'production'`. O
serviço `api` no Railway tem `NODE_ENV=production` (linha obrigatória da tabela
§3.1), então **produção recusa mesmo que as variáveis vazem para lá** — por
`.env` copiado, restore de config, ou engano no `railway variables`. O pior caso
é um bypass que não funciona, em vez de um que funciona sem ninguém notar.

Provado por teste (`dev-auth-bypass.spec.ts`, `jwt-auth.guard.spec.ts`) **e** na
mão: a mesma API, com `DEV_AUTH_BYPASS=true` no `.env`, subida com
`NODE_ENV=production`, responde **401** em `/auth/me` e não emite o aviso de
boot. Em DEV o guard loga um `WARN` a cada boot dizendo que a autenticação está
desligada — **se esse aviso aparecer num log de produção, é incidente.**

**Para testar o login real do Google no dev**, troque para `DEV_AUTH_BYPASS=false`
e reinicie a API. Reiniciar é obrigatório: a decisão é congelada no boot, e o
`--watch` recompila código mas **não** relê o `.env`.

**A correção de raiz** (que dispensaria o bypass) é adicionar o email em
*APIs & Services → OAuth consent screen → Test users* no Google Cloud Console, ou
publicar o app. O bypass não substitui isso — só destrava o dev enquanto não é
feito.

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
2. Rodar o bootstrap da role, **uma vez por banco**, com a senha de produção
   vinda de secret (nunca commitada). Da raiz do repo, com a conexão **owner**:

   ```bash
   DIRECT_URL="postgres://postgres:<senha-owner>@<host-publico>:<porta>/railway" \
   APP_DB_PASSWORD="<senha-forte-de-proplan_app>" \
   pnpm bootstrap:role
   ```

   O script (`scripts/bootstrap-app-role.mjs`) é **idempotente** — rodar de novo
   troca a senha e re-aplica os grants. Ele termina verificando que a role **não**
   tem `superuser`/`bypassrls` e **falha** se tiver: essa é a guarda contra o RLS
   virar no-op silencioso.

3. Montar `DATABASE_URL` com `proplan_app:<senha>@<host privado>:5432/railway` e
   gravá-la nas *Variables* do serviço `api`. **Não** aponte a `DATABASE_URL`
   para o usuário owner — isso desliga o isolamento multi-tenant sem erro visível.
4. `prisma migrate deploy` (usando `DIRECT_URL`, role owner) aplica o schema +
   as políticas RLS que já vivem nas migrations da SPEC-022. Isso roda sozinho a
   cada deploy, como release command — o passo manual é só o da role.

> **Ordem importa:** o passo 2 precisa acontecer **antes** de o serviço `api`
> subir com a `DATABASE_URL` de runtime; caso contrário a role ainda não existe
> e a conexão falha. As migrations podem rodar antes ou depois do bootstrap — os
> grants de `ALTER DEFAULT PRIVILEGES` cobrem as tabelas criadas depois.

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

> **2026-07-26 — a primeira demanda por binário apareceu e NÃO foi para cá.** Os
> anexos do briefing público (SPEC-031) ficam no **Postgres, em `bytea` sob RLS**,
> com teto de 10 MB/arquivo e 25 MB por briefing — **ADR-025**. Ativar o Supabase
> por 25 MB traria um segundo fornecedor ao caminho de dados e o free tier que
> pausa em 7 dias. O ADR-025 define os gatilhos numéricos que reabrem esta
> escolha; até um deles disparar, o Supabase segue reservado e o runbook segue
> sem procedimento de storage.

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
| **Deploy verde mas migration não aplicada** | O `preDeployCommand`/`buildCommand` gravado nas *settings do serviço* **vence o `railway.json` do repo** — se estiver `null` lá, o release command **não roda** e o deploy passa mesmo assim. Conferir em Settings → Deploy do serviço, não só no repo. Aconteceu na própria SPEC-027 (§11). |
| Build da api com centenas de `TS2339: Property 'x' does not exist on type 'PrismaService'` | O build rodou sem `prisma generate` antes — o client nasce sem models. Sinal de que o Railway **não** está usando `apps/api/Dockerfile` (checar `dockerfilePath` e se há `buildCommand` sobrescrevendo). |
| App sobe mas login não persiste | Cookie `Secure` ausente em HTTPS, ou `FRONTEND_URL`/CORS divergente do host real. |
| Queries multi-tenant "vendo tudo" | Runtime conectou como **owner/superuser** em vez de `proplan_app` — RLS virou no-op. Conferir a `DATABASE_URL`. |
| Sync/insight não processam | Redis fora do ar ou `REDIS_URL` não resolvida (reference variable). |
| 404 ao dar F5 numa rota | Fallback SPA → `index.html` não configurado no serviço web. |
| GitHub OAuth quebra | Callback URL do App ≠ `https://api.proplan.rrbtrading.com.br/auth/github/callback`. |

---

## 11. Estado do provisionamento (2026-07-22)

**A API está no ar.** Os quatro serviços com deploy `SUCCESS`:

- ✅ **Postgres** e **Redis** provisionados; `@proplan/mcp` removido (§2).
- ✅ `@proplan/api` buildando pelo `apps/api/Dockerfile` e subindo
  (*"Nest application successfully started"*), conectado como `proplan_app`.
- ✅ `@proplan/web` servindo o build do Vite por nginx.
- ✅ **Banco**: 26 migrations aplicadas, 20 tabelas, **15 com RLS ativo**.
- ✅ **Role verificada em produção**: `proplan_app` com `rolsuper=false` e
  `rolbypassrls=false`, com grant nas 20 tabelas (o `ALTER DEFAULT PRIVILEGES`
  cobriu as criadas depois dela). É a prova do critério de aceite de isolamento.
- ✅ **Release command provado**: o log do deploy mostra `26 migrations found` →
  `No pending migrations to apply.` **antes** do Nest iniciar.

### Armadilha encontrada na primeira subida (custou o banco ficar vazio)

O deploy passou **verde com o banco sem nenhuma tabela**. Causa: o
`preDeployCommand` estava `null` nas *settings do serviço*, e **a config do
serviço vence o `railway.json` do repo** — o release command simplesmente não
rodou, e nada sinalizou isso. O mesmo mecanismo derrubou os builds anteriores
com 285 erros `TS2339`: um `buildCommand` gravado no serviço ignorava o
Dockerfile e o `prisma generate` nunca acontecia.

> **Regra que fica:** ao mexer na configuração de um serviço, conferir o que
> está gravado nas *settings* — não basta o arquivo estar certo no repo. Um
> release command ausente é pior que um que falha: falha aborta o deploy,
> ausência deixa o deploy passar mentindo.

**Pendente — exige o dono:**

1. **Credenciais do GitHub App** nas *Variables* do `api`: `GITHUB_APP_ID`,
   `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` e `GITHUB_APP_PRIVATE_KEY`
   (PEM em base64, uma linha). Sem elas a API sobe, mas o login não completa —
   são lidas em tempo de uso, não no boot.
2. **`ANTHROPIC_API_KEY`** (e demais chaves de IA que quiser habilitar — provedor
   sem chave fica desabilitado, ADR-008).
3. **CNAMEs na Hostinger** + custom domains no Railway (§4).
4. **Callback URL do GitHub App** para o host de produção (§6).
5. **Rotacionar `POSTGRES_PASSWORD`** — a senha do banco foi exposta em texto
   claro durante o setup.

---

_Última atualização: 2026-07-22 — §2, §3, §5, §10 e §11 revisadas na entrega da
SPEC-027, com o que a implementação e a subida real provaram na prática._
