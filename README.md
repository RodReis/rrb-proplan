# RRB ProPlan

Painel de gestão visual do ciclo de vida dos projetos da fábrica de software. Resolve o problema de **retomar projetos esquecidos**: seleciona um repositório do GitHub, ingere apenas a documentação (`docs/`, `README.md`, `CLAUDE.md`, `.claude/`) e monta um workspace com visões que respondem "o que é este projeto, onde parou e o que falta".

## Visões do workspace

| Aba | Pergunta que responde | Fonte de dados |
|---|---|---|
| Visão Geral | O que é? Onde parou? O que falta? | IA (artefato versionado por SHA) |
| Kanban | Backlog / a fazer / em andamento / feito / descartado | **GitHub Issues** (coluna = label `proplan:*`); projeção legível em `.proplan/STATUS.md` |
| Grafo | Como os documentos se relacionam? | Links extraídos dos MDs + arestas semânticas inferidas (marcadas) |
| Arquitetura | Como o sistema é desenhado? | `docs/ARCHITECTURE.md`; fallback: inferência versionada |
| Skills & Agentes | O que o Claude Code usa neste projeto? | Parse determinístico de `CLAUDE.md` + `.claude/` |
| Testes & Ciclos | Foi testado? Como? | `docs/TESTING.md`; fallback: parse de `.github/workflows` |
| Design | Qual o design do sistema? | `docs/DESIGN.md`; fallback: inferência versionada |
| Deploy | Está em produção? Em quais plataformas? | `docs/DEPLOY.md` (convenção) |

## Princípios

1. **Sem código-fonte**: só documentação. Ingestão via GitHub Contents API — nunca clone completo.
2. **Convenção antes de inferência**: se o documento padronizado existe, ele é a verdade. IA é bootstrap (gera a primeira versão para projetos legados, o dono revisa e commita) e fallback.
3. **Inferência nunca em tempo real**: todo resultado de IA é artefato persistido, chaveado pelo SHA da árvore `docs/` — regenerado só quando os docs mudam.
4. **O GitHub é a fonte de verdade**: os **docs** vivem no repositório; o **estado do trabalho** vive nas **Issues** (ADR-011). Mover um card troca a label da issue; o ProPlan gera e commita `.proplan/STATUS.md` como projeção legível e versionada desse estado. O banco é cache/índice, nunca dono do dado.
5. **`docs/` é humano, `.proplan/` é gerado**: nada que o ProPlan produz sozinho entra em `docs/` — senão o alerta de documentação defasada mediria os próprios commits do ProPlan e morreria em silêncio.

## Stack

Monolito modular **NestJS** (módulos DDD extraíveis) · **React** (react-flow para grafo, dnd-kit para Kanban) · **PostgreSQL (Supabase)** · **Redis + BullMQ** (jobs de sync/ingestão/IA) · **GitHub App** via `fetch` (Octokit é ESM-only e conflita com o build CJS do Nest) · **Anthropic API** (bootstrap e inferência).

## Autenticação — GitHub App

O ProPlan autentica por **GitHub App** (ADR-015 / SPEC-008), não OAuth App. São **dois tokens**: o **user-to-server** (login OAuth do App) faz **toda leitura**, respeitando a visibilidade do usuário; o **installation token** (server-to-server) faz **toda escrita**, com identidade `proplan[bot]`. O catálogo lista só os repos onde o App está instalado.

### Criar o GitHub App (uma vez, ambiente local)

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **GitHub App name**: livre (ex.: `rrb-proplan-local`). O *slug* gerado (minúsculas com hífens) vai em `GITHUB_APP_SLUG`.
3. **Homepage URL**: `http://localhost:5180`.
4. **Callback URL**: `http://localhost:3311/auth/github/callback`. Marque **Request user authorization (OAuth) during installation** e **Expire user authorization tokens** (habilita o refresh token).
4b. **Setup URL (optional)**: `http://localhost:5180` (marque **Redirect on update**). Sem ela, o GitHub deixa o usuário parado na tela dele após instalar, em vez de devolvê-lo ao ProPlan.
5. **Webhook**: **desmarque Active** (ADR-009 — ambiente 100% local, sem túnel).
6. **Permissions → Repository**: `Contents` **Read & write**, `Issues` **Read & write**, `Metadata` **Read-only**, `Actions` **Read-only**. Nada além.
7. **Where can this GitHub App be installed?**: *Only on this account*.
8. Criar. Na página do App:
   - anote **App ID** → `GITHUB_APP_ID`;
   - anote **Client ID** (`Iv23…`) → `GITHUB_APP_CLIENT_ID`;
   - **Generate a new client secret** → `GITHUB_APP_CLIENT_SECRET`;
   - **Generate a private key** (baixa um `.pem`) → converta para base64 numa linha e ponha em `GITHUB_APP_PRIVATE_KEY`:
     - Linux/macOS: `base64 -w0 chave.pem`
     - PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("chave.pem"))`
9. **Install App** → escolha a conta (`RodReis`) e os repositórios. Instale também em `RodReis-Team` se quiser os repos da organização — cada conta é uma instalação separada.
10. Preencha o `.env` (ver `.env.example`), suba a API e o front, e faça login. O catálogo passa a listar os repos por instalação, agrupados por conta.

> Migração do OAuth App anterior: a `migration` da Fatia 4.5 troca as colunas de token do usuário. Só há o PI no banco — **refaça o login** uma vez após migrar; os projetos gerenciados são preservados (re-marque o repo no catálogo para vincular a instalação).

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Decisões (ADRs)](docs/DECISIONS.md)
- [Convenção dos projetos-alvo](docs/CONVENTION.md)
- [Design / UI](docs/DESIGN.md)
- [Status / Roadmap](docs/STATUS.md)
