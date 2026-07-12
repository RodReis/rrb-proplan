---
proplan: v1
updated: 2026-07-12
---
# Ordem de Desenvolvimento — RRB ProPlan

**Dono deste arquivo: Claude Code.** Atualize o estado de cada item ao trabalhar e commite junto da entrega. O `docs/STATUS.md` (kanban de fatias) deve refletir este arquivo — atualize os dois.

**Estados**: `a-fazer` → `em-andamento` → `feito` (entregue pelo Code, critérios da spec cumpridos) → `finalizado` (aceito pelo PI).

**Regras de execução**:
1. Siga a ordem. Não inicie um item com o anterior `em-andamento` (exceção: itens marcados `[paralelo]`).
2. Antes de codificar: ler `CLAUDE.md` → `docs/ARCHITECTURE.md` → `docs/DECISIONS.md` → spec da fatia em `docs/specs/`.
3. Fatia sem spec `aprovada-pi` → **não codificar**; avisar o PI.
4. Ao concluir item: marcar estado, atualizar `STATUS.md` se a fatia mudou de coluna, commitar código + docs juntos.
5. Dúvida técnica na spec → apontar ao PI; nunca resolver assumindo.

---

## Fatia 1 — Fundação (SPEC-001) — `feito`

Implementada via Cowork (exceção histórica; a partir daqui, só Claude Code). Aguardando aceite do PI (validação runtime local: OAuth App + `.env` + migrate + subir).

- [x] Monorepo, docker-compose, identity (OAuth), catalog, web shell — `feito`
- [ ] Aceite do PI → mover para `finalizado` e STATUS.md → Feito

## Fatia 2 — Ingestion (SPEC-002, `aprovada-pi`) — `finalizado`

Entregue pelo Claude Code e **aceito pelo PI em 2026-07-12** (validação runtime com OAuth App real).

1. `feito` — Prisma: models `Document`, `SyncRun` (+ enum `SyncStatus`) + campos `docsScopeHash`/`lastSyncAt` em `Project`; migration `fatia_2_ingestion` aplicada.
2. `feito` — BullMQ: conexão Redis (`BullModule.forRoot` no `app.module`, parse de `REDIS_URL`), fila `sync`, worker (`SyncWorker`) no processo da API; job com 3 tentativas e backoff exponencial; idempotência por hash no `SyncService`.
3. `feito` — `ingestion/infrastructure/github-git.client`: Trees (recursive, `TreeTruncatedError` se `truncated`) e Blobs (base64, cap 512 KB → `null`/skip); timeout 10s, backoff em 403/429 via `x-ratelimit-reset`.
4. `feito` — `ingestion/domain` + `application/sync.service`: `computeScopeHash`, `diffScope`, `parseFrontmatter`, `isInScope`, no-op auditado. **18 testes unitários passando** (hash/diff/frontmatter/scope-filter).
5. `feito` — `ingestion/presentation`: `POST /projects/:id/sync` (202), `GET .../sync-runs/latest`, `GET .../documents`, `GET .../documents/content?path=`.
6. `feito` — Gatilho: `catalog.addProject` chama `IngestionService.enqueueSync` só na primeira marcação (interface pública).
7. `feito` — Web: `Workspace` (clicar projeto na sidebar abre), header (nome, link GitHub, botão Sincronizar), barra de abas do DESIGN.md com Documentos ativa e demais desabilitadas (tooltip "Fatia N").
8. `feito` — Web: `DocumentsTab` — lista + viewer (`react-markdown` + `remark-gfm`, estilo `.prose-doc`), skeleton, badge `convenção`, estados vazio/erro/sincronizando (polling do sync-run 1,5s).
9. `feito` — Critérios de aceite conferidos abaixo; DEVELOPMENT.md + STATUS.md atualizados; entrega commitada.

### Aceite runtime (2026-07-12)

Validado ao vivo com OAuth App real (login GitHub, catálogo com 22 repos):
- ✅ Marcar repo gerenciado → ingestão automática (run apareceu sem ação; 15 added/1 updated ao sincronizar o rrb-proplan com docs reais).
- ✅ Sincronizar sem mudança → `noop` 0/0/0/0 (idempotência por hash; cobre também "dois cliques sem download duplo").
- ✅ `README.md` e `docs/DESIGN.md` renderizam legíveis no viewer, com tabelas; badge `convenção` correto (docs `proplan: v1` marcados, README/CLAUDE/ARCHITECTURE não).
- ✅ Escopo recursivo `docs/**` (incl. `docs/specs/`), sem duplicação (16 docs = 16 paths).
- ⚠️ Critérios de borda **2 (repo vazio), 4 (>512 KB), 7 (falha de rede)** aceitos pelo PI com base na cobertura de código/testes unitários, sem teste manual dedicado.

**Bug de UX corrigido no aceite:** faltava voltar do workspace ao catálogo — adicionado botão "← Catálogo" no header.

**Nota de ambiente:** portas de host remapeadas — Postgres `5433`, Redis `6380`, API `3311` (era 3000; colisão com stacks locais). Auth via **OAuth App** (não GitHub App — Client ID `Ov23…`, não `Iv23…`). `.env.example` e CLAUDE.md atualizados.

## Fatia 3 — Insight: resumo, bootstrap, config de IA e alerta de defasagem (SPEC-003, `aprovada-pi`) — `finalizado`

Entregue pelo Claude Code e **aceito pelo PI em 2026-07-12** (validação runtime com chamadas reais de IA e write-back no GitHub). Escopo ampliado com o ADR-010.

1. `feito` — Prisma: models `Settings` (enum `LlmProvider`, `docsStalenessThresholdDays` default 90) e `Insight` (enum `InsightKind`); campos `lastDocsCommitAt`/`lastCodeCommitAt`/`commitMetaSyncedAt` em `Project`; migration `fatia_3_insight`; envs `LLM_MODEL_*`.
2. `feito` — **Defasagem (ADR-010), back**: `GithubGitClient.getLastCommitDate(path?)`; `SyncService.updateCommitMeta` grava as duas datas no fim de todo run (inclusive `noop`), tolerante a falha; `GET /projects/:id/freshness` no `catalog` (`stale` calculado na leitura via `computeFreshness`, nunca persistido). 7 testes de limiar.
3. `feito` — `insight/domain`: `LlmClient`, `parseSummary` (JSON estrito), `selectContext` (cap de tokens por prioridade); `insight/infrastructure`: `AnthropicClient`, `OpenAiCompatClient` (OpenAI/OpenRouter via baseURL), `LlmClientFactory`. Testes de parsing/budget.
4. `feito` — Configurações: `GET/PUT /settings` (módulo `settings` novo) + tela (engrenagem no rail), provedores sem chave desabilitados, campo de limiar (padrão 90, `0` desliga).
5. `feito` — Job `insight` (BullMQ) via listener de `DocsSynced` (`@OnEvent`): resumo persistido com provider/model/tokens; idempotente por `docsTreeSha`; cap de tokens com truncamento por prioridade.
6. `feito` — Write-back: `GithubWritebackClient` (Contents API, SHA base, `WritebackConflictError` 409/422); `BootstrapService.commitStatus` re-sincroniza e faz 1 retry em conflito. Nasce em `insight/infrastructure`.
7. `feito` — Bootstrap STATUS.md: `proposeStatus` (prompt no formato CONVENTION.md) + endpoints proposta/commit.
8. `feito` — Web: aba Visão Geral — `FreshnessBar` no topo (neutra ou âmbar com ⚠️, sempre com as duas datas) + 3 blocos, badge IA, Regenerar com `confirm`, estados gerando/erro/vazio.
9. `feito` — Web: `BootstrapDialog` (CTA → editor com preview markdown → aprovar e commitar → re-sync).
10. `feito` — 42 testes verdes, builds API+web limpos, rotas mapeadas; DEVELOPMENT.md + STATUS.md atualizados. Aceite runtime pendente.

### Aceite runtime (2026-07-12)

Validado ao vivo com chamadas reais de IA (Anthropic `claude-sonnet-5`):
- ✅ Configurações: 3 provedores, Anthropic ativo, limiar 90 — tela renderiza e persiste.
- ✅ Visão Geral: resumo gerado (1285 in / 318 out tokens), 3 blocos coerentes, badge "inferido por IA · anthropic", faixa de frescor ("Docs: — · Código: há 2 meses" no landpage sem `docs/`).
- ✅ Bootstrap end-to-end: proposta IA → editor → commit `docs/STATUS.md` no `RodReis/landpage` via Contents API → re-sync automático trouxe o arquivo (landpage passou a ter README + docs/STATUS.md).
- ✅ Evento `DocsSynced` re-enfileira resumo após o commit (jobId corrigido).
- ⚠️ Bordas aceitas pelo PI por cobertura de código/testes, sem teste manual: faixa âmbar (docs velhos), troca de provedor em `insights.provider`, falha do provedor, conflito de SHA no write-back.

**Bugs corrigidos no aceite:** (1) jobId do BullMQ não pode conter `:` — o job de resumo por evento falhava; trocado para `_`. (2) front quebrava com `res.json()` em corpo vazio (retorno `null` do Nest) — `request()` agora trata corpo vazio como `null`.

> **Nota de ordem**: o item 2 é independente da IA e destrava valor sozinho. Se a Fatia 3 precisar ser fatiada por tempo, entregue 1+2+4(campo de limiar)+8(faixa) primeiro — é a Visão Geral já útil, sem gastar um token.

## Fatia 4 — Grafo de links explícitos (SPEC-004, `aprovada-pi`) — `a-fazer`

Só iniciar com a Fatia 3 `feito`.

1. `a-fazer` — Prisma: model `DocLink`; migration.
2. `a-fazer` — `ingestion/application`: extração de links (markdown relativos + wikilinks), resolução de path relativa ao arquivo fonte, quebrados com `targetDocumentId` nulo, externos ignorados. **Testes unitários de resolução de path e wikilink neste passo.**
3. `a-fazer` — Integrar extração ao job de sync (recriar arestas dos docs alterados).
4. `a-fazer` — `GET /projects/:id/graph`.
5. `a-fazer` — Web: aba Grafo com react-flow + d3-force; nós por tipo, fantasma para quebrados, hover destaca vizinhos, clique abre viewer lateral, minimapa, re-centralizar.
6. `a-fazer` — Validar com o próprio rrb-proplan como repo gerenciado; critérios da SPEC-004; atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 5 — Kanban (SPEC-005, `aprovada-pi`) — `a-fazer`

Só iniciar com a Fatia 4 `feito`.

1. `a-fazer` — `board`: parser/serializador de STATUS.md com round-trip fiel. **Testes unitários de round-trip primeiro** (é o coração da fatia).
2. `a-fazer` — Promover write-back de `insight/infrastructure` para compartilhado (segundo consumidor).
3. `a-fazer` — Fila BullMQ `board` (serializada por projeto) + `BoardMutation` (auditoria); mutações mover/criar/editar/excluir com commits padrão e carimbo `(desde:)`/`(em:)`.
4. `a-fazer` — API: `GET board`, `POST mutations` (202), `GET mutations/:id`; re-sync pós-commit (ADR-009); conflito SHA → re-sync + 1 reaplicação.
5. `a-fazer` — Web: aba Kanban com dnd-kit (tilt, placeholder, spring), otimista + borda pulsante, toasts pela política do DESIGN.md, criar inline/editar popover/excluir com confirmação, CTA bootstrap sem STATUS.md.
6. `a-fazer` — Critérios da SPEC-005 (incluindo conflito simulado); atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 6 — Abas de convenção (SPEC-006, `aprovada-pi`) — `a-fazer`

Só iniciar com a Fatia 5 `feito`.

1. `a-fazer` — Ampliar filtro de sync: `.claude/**` e `.github/workflows/*.yml`; re-sync.
2. `a-fazer` — Mermaid no viewer (lazy, fallback para código em erro) — vale para Documentos e todas as abas.
3. `a-fazer` — Parsers determinísticos: `TestingDoc`, `DeployDoc`, `SkillsIndex`, workflows YAML. Testes unitários.
4. `a-fazer` — `GET /projects/:id/tabs/:tab` com regra de fallback no back.
5. `a-fazer` — Web: abas Arquitetura, Design, Testes, Deploy (tabela estruturada com badges), Skills & Agentes; empty states com CTA.
6. `a-fazer` — Critérios da SPEC-006; atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 7 — Insight semântico (SPEC-007, `aprovada-pi`) — `a-fazer`

Só iniciar com a Fatia 6 `feito`.

1. `a-fazer` — Prisma: `DocLink.kind inferred` + `reason`, `SuppressedLink`, novos `Insight.kind`; migration.
2. `a-fazer` — Job de arestas semânticas (batch único por sync, JSON estrito + retry, exclui explícitas e suprimidas).
3. `a-fazer` — API supressão de aresta + grafo com inferidas; Web: tracejadas âmbar, tooltip motivo, remover, toggle.
4. `a-fazer` — Fallbacks Arquitetura/Design: job, badge âmbar, Regenerar, "Promover a documento" (editor → commit → re-sync).
5. `a-fazer` — Critérios da SPEC-007; atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 8 — Multi-tenant — `sem-spec`

Condicionada à decisão do PI de produtizar. Não iniciar.
