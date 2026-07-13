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

## Fatia 4 — Grafo de links explícitos (SPEC-004, `aprovada-pi`) — `finalizado`

Entregue pelo Claude Code e **aceito pelo PI em 2026-07-12** (validação runtime com rrb-adv e rrb-proplan).

1. `feito` — Prisma: model `DocLink` (+ enum `DocLinkKind`); migration `fatia_4_grafo`.
2. `feito` — `ingestion/domain`: `extractLinks` (markdown relativos + wikilinks, ignora externos/âncoras puras) e `resolveLink` (resolução relativa à pasta do source, normaliza `./`/`..`, wikilink case-insensitive por basename, âncora como metadado). 14 testes.
3. `feito` — `LinkService.rebuildLinks` recompute-all em transação, integrado ao `SyncService` (success e noop).
4. `feito` — `GET /projects/:id/graph` (nodes por tipo + edges com `broken`).
5. `feito` — Web: aba Grafo react-flow + d3-force (forceCollide anti-sobreposição), nós por tipo, fantasma vermelho para quebrados, hover destaca vizinhos, clique abre viewer lateral, minimapa, re-centralizar.
6. `feito` — Validado; critérios abaixo.

### Aceite runtime (2026-07-12)

- ✅ rrb-adv: 119 docs (incl. subpastas `legal/design/specs`), 105 arestas resolvidas + 4 quebradas; rrb-proplan: 8 + 3.
- ✅ Wikilink e link relativo resolvem; quebrados viram nó fantasma vermelho; externos ignorados.
- ✅ Clique abre o doc no painel lateral; hover destaca vizinhos e esmaece o resto.
- ✅ Repo 100+ docs navegável; estabilidade validada via browser (CDP): 0 nós escondidos sob 40 hovers + clique + painel.

**Bugs corrigidos no aceite:** (1) **byte NUL** (0x00) num doc do rrb-adv quebrava o sync inteiro (Postgres text rejeita NUL) — `getBlob` sanitiza; destravou 16→119 docs. (2) **grafo sumia/piscava** no hover/clique — ReactFlow v11 controlado sem `onNodesChange` perdia as medições dos nós ao recriar o array; migrado para `useNodesState` + estilos com referência constante + `key` no canvas. (3) scroll do painel vazava zoom pro grafo — `overscroll-contain`.

## Fatia 4.5 — Migração para GitHub App (SPEC-008, `aprovada-pi`) — `finalizado`

**Pré-requisito da Fatia 5. Não pular.** Existe agora porque a Fatia 5 já obrigaria a reconsentir (escopo de escrita em Issues) — trocar o mecanismo de auth **junto** custa quase nada; depois custa reconsentir e migrar tokens de novo (ADR-015, supersede a auth do ADR-007).

Dois tokens: **user-to-server** para **toda leitura**; **installation token** para **toda escrita**, com identidade `proplan[bot]`. Leitura com installation token é **proibida** (o ProPlan enxergaria o que o usuário logado não enxerga).

Entregue pelo Claude Code em 3 checkpoints e **aceito pelo PI em 2026-07-13** (validação runtime com o GitHub App real `RRB ProPlan`).

1. `feito` (config do dono) — Guia de criação do GitHub App no README (permissões mínimas: `Contents` rw, `Issues` rw, `Metadata` r, `Actions` r; webhooks **desligados** — ADR-009; chave privada em base64). Envs novos em `.env.example` (`GITHUB_APP_ID/CLIENT_ID/CLIENT_SECRET/SLUG/PRIVATE_KEY`); OAuth App removido.
2. `feito` — `identity`: `GithubAuth.userToken` (OAuth do App + **refresh transparente**, margem de 5min) e `.installationToken` (JWT RS256 `iat -60s`/`exp 9min` → access_token, **cacheado em Redis por instalação, TTL 55min**). `GithubAppJwt`, `InstallationTokenService`, `GithubOauthClient` (exchange/refresh), `GithubInstallationsClient`. 16 testes.
3. `feito` — Prisma: `User` troca `encryptedGithubToken` por `encryptedUserToken`/`encryptedRefreshToken`/`tokenExpiresAt` (nullable — PI reloga); `Project` ganha `installationId`/`installationStatus`. Migration `fatia_4_5_github_app` aplicada, projetos preservados.
4. `feito` — Call sites migrados: `sync` e `catalog.listInstallations` → `userToken` (leitura); `bootstrap.commitStatus` → `installationToken(projectId)` (escrita, prova do autor bot). **Teste de arquitetura** (varredura estática): `installationToken` só em caminhos de escrita da allowlist.
5. `feito` — `catalog`: lista repos **por instalação** (`/user/installations` + `/user/installations/{id}/repositories`), **agrupado por conta**; endpoints `GET /catalog/installations` e `GET /catalog/install-url`. Reconciliação pura (`reconcileInstallations`): repo sumiu de toda instalação → `installationStatus = missing`. Front: grupos por conta, empty state "Instalar no GitHub", "Instalar em mais repositórios", "sem repositórios acessíveis nesta conta", badge `sem instalação` na sidebar.
6. `feito` — Critérios da SPEC-008 cobertos por 78 testes + builds limpos; teste que prova a fatia validado no aceite runtime abaixo.

### Aceite runtime (2026-07-13)

Validado ao vivo com o GitHub App real (`RRB ProPlan`, App ID 4281045, instalação `146171535` na conta `RodReis`):
- ✅ Login pelo App (OAuth do App): `client_id` do App na URL de autorização, sessão volta com avatar. Bug pego e corrigido: a API lê `apps/api/.env` (não o `.env` da raiz) — os envs do App foram para o arquivo certo.
- ✅ Catálogo por instalação, agrupado por conta (`RodReis · PESSOAL`); repos selecionados no GitHub aparecem após re-fetch.
- ✅ Estado "instalação sem repositórios acessíveis" renderiza o texto correto (reproduzido ao instalar sem marcar repos).
- ✅ Reconciliação: os 3 projetos gerenciados (`landpage`, `rrb-adv`, `rrb-proplan`) ligados à instalação, `installationStatus = active`; badge `sem instalação` apareceu enquanto a lista vinha vazia (antes da permissão/seleção) e sumiu depois.
- ✅ **Installation token** emitido (201) com as permissões mínimas exatas: `contents:write`, `issues:write`, `actions:read`, `metadata:read` — nada além.
- ✅ **O teste que prova a fatia**: write-back via installation token (Contents PUT) gerou commit com **autor `rrb-proplan[bot]`**, não o usuário. Committer `GitHub` (padrão da Contents API). Arquivo de teste criado e removido, ambos por bot.

**Config do App que faltou no guia inicial (corrigida no README):** `Setup URL = http://localhost:5180` — sem ela o GitHub deixa o usuário parado na própria tela após instalar, em vez de devolvê-lo ao ProPlan.

**Nota de segurança:** ambiente 100% local; a chave privada do App fica só no `.env` (fora do git). Rotação não exigida pelo PI neste ambiente.

## Fatia 5 — Kanban sobre GitHub Issues (SPEC-005 reescrita, `aprovada-pi`) — `a-fazer`

Só iniciar com a **Fatia 4.5** `feito` (o board escreve com installation token; sem ela, não há escrita).

O estado do trabalho vive nas **Issues** (ADR-011): coluna = label `proplan:*`, `closed` = Feito, `closed`+`proplan:descartado` = Descartado. A projeção vai para **`.proplan/STATUS.md`** (raiz, fora de `docs/` — senão o board mascara o alerta do ADR-010). O parser round-trip fiel da versão anterior da spec **não existe mais** — some o item mais caro da fatia.

1. ~~`identity`: escopo OAuth de escrita + reconsentimento~~ — **resolvido pela Fatia 4.5**. O board apenas consome `GithubAuth.installationToken(projectId)`.
2. `a-fazer` — `board/infrastructure`: `GithubIssuesClient` (listar com ETag/paginação, criar, patch, labels idempotentes; **filtrar `pull_request` do payload de issues**).
3. `a-fazer` — `board/domain`: mapeamento issue↔card/coluna (5 colunas); **gerador** de `.proplan/STATUS.md` (issues → markdown, arquivo inteiro a cada vez) + **parser de leitura** (só importação de legado e modo degradado).
4. `a-fazer` — Promover write-back de `insight/infrastructure` para compartilhado (segundo consumidor — usado agora só para commitar a projeção).
5. `a-fazer` — Fila BullMQ `board` (serializada por projeto) + `BoardMutation`; mutações → Issues API; projeção com **debounce** (5 cards arrastados = 1 commit).
6. `a-fazer` — Detecção de legado: `sync-job` marca `Project.needsIssueImport` (tem `docs/STATUS.md` sem cabeçalho de projeção **e** nenhuma issue `proplan:*`).
7. `a-fazer` — API: `GET board`, `POST mutations` (202), `GET mutations/:id`, `POST board/import-from-status`, `POST board/bootstrap` + `/apply`. **Substitui** `POST /bootstrap/status/commit` da SPEC-003.
8. `a-fazer` — Modo degradado: repo com `has_issues === false` → board read-only sobre `docs/STATUS.md`, com faixa explicativa.
9. `a-fazer` — Web: aba Kanban com dnd-kit (tilt, placeholder, spring), otimista + borda pulsante, número da issue no card + link, criar inline/editar popover/descartar com confirmação; coluna Descartado colapsada; banner de importação + badge no catálogo.
10. `a-fazer` — **Teste obrigatório**: sequência de mutações no board **não altera** `lastDocsCommitAt` nem apaga o ⚠️ do ADR-010 (é a razão de `.proplan/` existir).
11. `a-fazer` — Critérios da SPEC-005; atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 6 — Resolução de documentos + abas (SPEC-006 **ampliada**, `aprovada-pi`) — `a-fazer`

Só iniciar com a Fatia 5 `feito`.

**O coração da fatia é o `DocumentResolver` (ADR-014), não as abas.** Casar documento por caminho exato funciona só neste repo; os repos reais têm `arquitetura.md`, `adr/0001-*.md`, `docs/qa/`. Escada: convenção → alias → `.proplan/config.yml` → ausente. **O ProPlan nunca renomeia, move ou reescreve doc do usuário** — ele mapeia.

1. `a-fazer` — `board/domain`: `DocumentResolver` + tabela de alias + parse de `.proplan/config.yml`. **Testes unitários primeiro**, com fixture de repo de nomes esquisitos. Teste explícito de alias não-ganancioso (`docs/archive/` **não** é `arch`).
2. `a-fazer` — Ampliar filtro de sync: `.claude/**`, `.github/workflows/*.yml`, `.proplan/config.yml` e diretórios de alias (`adr/`, `decisions/`, `docs/**`); re-sync.
3. `a-fazer` — Parsers determinísticos: `TestingDoc`, `DeployDoc`, `SkillsIndex`, `DecisionsIndex` (arquivo **ou** coleção), workflows YAML. Testes unitários.
4. `a-fazer` — API: `GET /tabs/:tab` (payload + `source: {level, path, confidence}`), `GET /mapping`, `PUT /mapping` (escreve `.proplan/config.yml` via write-back + re-sync).
5. `a-fazer` — Mermaid no viewer (lazy, fallback para código em erro) — vale para Documentos e todas as abas.
6. `a-fazer` — Web: **tela de mapeamento** (confirmar/corrigir/marcar ausente) + abas Arquitetura, **Decisões**, Design, Testes, Deploy (tabela estruturada com badges), Skills & Agentes; linha "reconhecido por nome — corrigir" nas abas de nível 2; empty states com CTA.
7. `a-fazer` — Critérios da SPEC-006 (incluindo o **teste que prova a fatia**: repo com nomes próprios resolve tudo em nível 2); atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 7 — Insight semântico (SPEC-007, `aprovada-pi`) — `a-fazer`

Só iniciar com a Fatia 6 `feito`.

1. `a-fazer` — Prisma: `DocLink.kind inferred` + `reason`, `SuppressedLink`, novos `Insight.kind`; migration.
2. `a-fazer` — Job de arestas semânticas (batch único por sync, JSON estrito + retry, exclui explícitas e suprimidas).
3. `a-fazer` — API supressão de aresta + grafo com inferidas; Web: tracejadas âmbar, tooltip motivo, remover, toggle.
4. `a-fazer` — **Nível 3 da escada (ADR-014)**: classificação semântica — doc cujo nome não bate com alias nenhum, mas cujo conteúdo é claramente a entidade. Preenche o slot que o `DocumentResolver` já deixou pronto na Fatia 6. Resultado é `inferência` (badge âmbar, spans citados), nunca `fato`, e **perde** para `.proplan/config.yml`.
5. `a-fazer` — Fallbacks Arquitetura/Design: job, badge âmbar, Regenerar, "Promover a documento" (editor → commit → re-sync).
6. `a-fazer` — Critérios da SPEC-007; atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 8 — Multi-tenant — `sem-spec`

Condicionada à decisão do PI de produtizar. Não iniciar.
