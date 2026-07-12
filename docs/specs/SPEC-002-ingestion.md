---
proplan: v1
spec: SPEC-002
fatia: 2
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-002 — Ingestion: sincronização de documentação e viewer

## Objetivo

Abrir um projeto gerenciado e ler a documentação dele dentro do ProPlan, sempre atualizável contra o repositório — a matéria-prima de todas as abas futuras.

## Escopo

- **Módulo `ingestion`** (novo, conforme `docs/ARCHITECTURE.md`):
  - Sync sob demanda por projeto: busca a árvore do branch default via **Git Trees API (recursive)**, filtra `docs/**`, `README.md`, `CLAUDE.md`; baixa blobs novos/alterados via **Git Blobs API**.
  - Detecção de mudança por **`docs_scope_hash`** = SHA-256 da lista ordenada de `(path, blob_sha)` do escopo. Hash igual → sync no-op (auditado, sem downloads).
  - Persistência: `documents` (path, blobSha, content, frontmatter jsonb, byteSize) + `sync_runs` (auditoria: status, hash, contagens, erro).
  - Parse de frontmatter YAML (`gray-matter`); documento com `proplan: v1` é marcado `conventional`.
  - **Primeiro uso de BullMQ**: fila `sync`, job idempotente por (`projectId`, `docs_scope_hash`), retry com backoff (3 tentativas), timeout 60s.
- **API** (`board` ainda não existe; endpoints ficam no `ingestion`):
  - `POST /projects/:id/sync` → `202 {syncRunId}` · `GET /projects/:id/sync-runs/latest` → estado do último run · `GET /projects/:id/documents` → lista (sem content) · `GET /projects/:id/documents/content?path=…` → documento completo.
- **Web — workspace mínimo**:
  - Clicar em projeto na sidebar → rota do workspace com header (nome, link GitHub, botão "Sincronizar") e barra de abas do `DESIGN.md` com **"Documentos" ativa** (demais abas visíveis e desabilitadas, com tooltip "Fatia N").
  - Aba Documentos: árvore/lista de arquivos à esquerda, viewer markdown à direita (`react-markdown` + `remark-gfm`), skeleton na carga, badge `convenção` para docs `proplan: v1`.
  - Sync automático disparado ao marcar um repo como gerenciado (primeira ingestão) e botão manual no workspace com estado "sincronizando…" (polling do sync-run; SSE fica pra quando houver webhook).

## Fora de escopo

Webhooks (Fatia 5), extração de links e grafo (Fatia 4), qualquer chamada de IA (Fatia 3), parse de `.claude/` e workflows (Fatia 6), render de Mermaid no viewer (registrar como melhoria; texto do bloco aparece como código), busca full-text.

## Critérios de aceite

- [ ] Marcar um repo como gerenciado dispara a primeira ingestão automaticamente; ao abrir o workspace, os documentos aparecem sem ação manual.
- [ ] Repo sem `docs/`, sem `README.md` e sem `CLAUDE.md` mostra estado vazio com aviso claro (não erro).
- [ ] Editar um MD no GitHub e clicar "Sincronizar" atualiza o conteúdo no viewer; sincronizar sem mudança termina em no-op auditado (visível em `sync_runs`).
- [ ] Arquivo > 512 KB é ignorado com aviso na lista (não derruba o sync).
- [ ] Dois cliques seguidos em "Sincronizar" não geram dois downloads (idempotência por hash).
- [ ] `README.md` deste próprio repo (rrb-proplan) renderiza legível no viewer, incluindo tabelas.
- [ ] Falha de rede/rate limit do GitHub deixa o run como `failed` com mensagem, e a UI oferece "Tentar de novo" — sem crash.

## Contratos

- Prisma novo: `Document { id, projectId, path, blobSha, content, frontmatter Json?, isConventional, byteSize, updatedAt }` (único por `projectId+path`) · `SyncRun { id, projectId, status queued|running|success|noop|failed, docsScopeHash?, added, updated, removed, skipped, error?, startedAt, finishedAt? }` · `Project.docsScopeHash?` e `Project.lastSyncAt?`.
- Módulo `ingestion` expõe `IngestionService.enqueueSync(projectId)` como interface pública (o futuro `insight` consome).
- Documentos removidos do repo são removidos do banco no sync (banco = índice, ADR).

## Notas técnicas

- Trees API recursive tem limite de 100k entradas/7MB — suficiente; se `truncated: true`, falhar o run com mensagem clara (repo fora do perfil do produto).
- Blobs via Git Blobs API (base64) — sem limite de 1MB da Contents API; ainda assim cap de 512 KB por doc de texto.
- Reaproveitar o token OAuth via `AuthService.githubTokenOf` (interface pública do `identity`) — worker BullMQ roda no mesmo processo Nest (sem processo separado nesta fatia).
- Timeout GitHub 10s por request; backoff exponencial em 403/429 respeitando `x-ratelimit-reset`.

## Perguntas abertas

Nenhuma. Resolvidas com o PI em 2026-07-12:

1. **Profundidade do escopo**: `docs/**` completo, incluindo subpastas (ex.: `docs/specs/`). ✔
2. **Branch**: sempre o branch default do repo; sem seletor nesta fatia. ✔
