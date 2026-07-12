---
proplan: v1
spec: SPEC-001
fatia: 1
status: entregue # aguardando aceite do PI (validação runtime local)
updated: 2026-07-12
---
# SPEC-001 — Fundação: monorepo, login GitHub e Catálogo

> Spec retroativa: documenta o que foi implementado na Fatia 1 para servir de baseline. A partir da SPEC-002, spec precede código.

## Objetivo

Sair do zero para um app local onde o PI loga com GitHub e marca quais repositórios o ProPlan gerencia.

## Escopo

- Monorepo npm workspaces: `apps/api` (NestJS) e `apps/web` (React + Vite).
- Login GitHub OAuth (authorization code + state anti-CSRF), sessão JWT em cookie httpOnly, token GitHub criptografado (AES-256-GCM) no banco.
- Catálogo: listar repos do usuário (GitHub API via fetch, paginação por header Link, máx. 1000) e marcar/desmarcar como projeto gerenciado.
- Shell de UI conforme `docs/DESIGN.md`: rail, sidebar com projetos gerenciados, lista de repos com micro-interações.
- docker-compose: postgres, redis, api, web.

## Fora de escopo

Ingestão de docs, abas do workspace, Kanban, grafo, IA, webhooks, multi-tenant.

## Critérios de aceite

- [ ] `npm install` + `docker compose up -d postgres redis` + `prisma migrate dev` + `dev:api`/`dev:web` sobem sem erro em `http://localhost:5180`.
- [ ] Login com GitHub completa e volta pro app com o usuário logado (avatar e login visíveis).
- [ ] Lista de repos aparece ordenada por push recente, com privados marcados.
- [ ] Marcar repo como gerenciado persiste (recarregar página mantém) e ele aparece na sidebar.
- [ ] Desmarcar remove da sidebar e do banco.
- [ ] Logout limpa a sessão.

## Contratos

- `GET /auth/github` → redirect GitHub · `GET /auth/github/callback` → cookie + redirect front · `GET /auth/me` → `{id, login, name, avatarUrl}` · `POST /auth/logout` → 204
- `GET /catalog/repos` → `RepoWithManaged[]` · `GET /catalog/projects` → `Project[]` · `POST /catalog/projects` (body `RepoSummary`) → `Project` · `DELETE /catalog/projects/:id` → 204
- Prisma: `User` (githubId, login, name, avatarUrl, encryptedGithubToken), `Project` (userId, githubRepoId único por usuário, owner, name, description, defaultBranch, isPrivate)

## Notas técnicas

- ADR-007 (OAuth antecipado, Prisma). Octokit descartado nesta fatia: v4+ é ESM-only e conflita com build CJS do Nest — GitHub API via fetch.
- Escopo OAuth `repo read:user`: concede mais que leitura (limitação de OAuth Apps do GitHub); necessário pra Fatia 5 commitar `STATUS.md`. Alternativa GitHub App fica para revisão futura.
- Portas: web 5180 (strictPort), API 3000.

## Perguntas abertas

Nenhuma — pendente apenas aceite do PI (validação runtime local com credenciais OAuth reais).
