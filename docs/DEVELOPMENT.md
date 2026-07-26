---
proplan: v1
updated: 2026-07-12
---
# Ordem de Desenvolvimento — RRB ProPlan

**Dono deste arquivo: Claude Code.** Atualize o estado de cada item ao trabalhar e commite junto da entrega. O `docs/STATUS.md` (kanban de fatias) deve refletir este arquivo — atualize os dois.

**Camadas — não invadir a do outro** (ADR-011, `card = fatia`, decisão do PI em 2026-07-13):

| camada | responde | granularidade |
|---|---|---|
| **Issues / board** | *qual fatia está em qual coluna* | **uma issue por fatia** |
| **este arquivo** | *onde estou dentro da fatia* | os N passos, com `a-fazer`/`feito` |

Granularidades diferentes ⇒ **nenhum fato mora nos dois lugares**. Não criar issue por sub-item — isso duplicaria o estado que os checkmarks daqui já guardam, e é exatamente o que o ADR-011 existe para impedir.

**Estados**: `a-fazer` → `em-andamento` → `feito` (entregue pelo Code, critérios da spec cumpridos) → `finalizado` (aceito pelo PI).

**Regras de execução**:
1. Siga a ordem. Não inicie um item com o anterior `em-andamento` (exceção: itens marcados `[paralelo]`).
2. Antes de codificar: ler `CLAUDE.md` → `docs/ARCHITECTURE.md` → `docs/DECISIONS.md` → spec da fatia em `docs/specs/`.
3. Fatia sem spec `aprovada-pi` → **não codificar**; avisar o PI.
4. Ao concluir item: marcar estado, atualizar `STATUS.md` se a fatia mudou de coluna, commitar código + docs juntos.
5. Dúvida técnica na spec → apontar ao PI; nunca resolver assumindo.

---

## Fatia 1 — Fundação (SPEC-001) — `finalizado` (aceita pelo PI em 2026-07-17)

Implementada via Cowork (exceção histórica; a partir daqui, só Claude Code). Aceita ao vivo pelo PI (roda em produção local há dias; toda entrega posterior foi construída sobre ela). **Sem card no board** — nasceu antes do Kanban sobre Issues (Fatia 5), então o aceite vive só aqui.

- [x] Monorepo, docker-compose, identity (OAuth), catalog, web shell — `feito`
- [x] Aceite do PI em 2026-07-17

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

## Fatia 5 — Kanban sobre GitHub Issues (SPEC-005 reescrita, `aprovada-pi`) — `finalizado`

Só iniciar com a **Fatia 4.5** `feito` (o board escreve com installation token; sem ela, não há escrita).

O estado do trabalho vive nas **Issues** (ADR-011): **Feito = `open` + `proplan:done`** (entregue, aguardando aceite); **Finalizado = `closed` + `proplan:finalizado`**; Descartado = `closed` + `proplan:descartado`. **A issue só fecha no aceite** — nenhuma automação a fecha. A projeção vai para **`.proplan/STATUS.md`** (raiz, fora de `docs/` — senão o board mascara o alerta do ADR-010). O parser round-trip fiel da versão anterior da spec **não existe mais** — some o item mais caro da fatia.

Entregue pelo Claude Code em 2 checkpoints (back, front) e **aceito pelo PI em 2026-07-13** (validação runtime no `rrb-adv`).

1. ~~`identity`: escopo OAuth de escrita + reconsentimento~~ — **resolvido pela Fatia 4.5**. O board apenas consome `GithubAuth.installationToken(projectId)`.
2. `feito` — `board/infrastructure`: `GithubIssuesClient` (listar com paginação, criar, patch, labels idempotentes 422=ok; **filtra `pull_request`**). 4 testes.
3. `feito` — `board/domain`: `column-mapping` (issue↔coluna, transições, prioridade) + `projection` (gerador `.proplan/STATUS.md` no formato CONVENTION.md + parser de leitura tolerante). 34 testes.
4. `feito` — Write-back promovido de `insight/infrastructure` para `shared/github` (2º consumidor: a projeção do board). `SharedModule`.
5. `feito` — Fila BullMQ `board` serializada (concorrência 1) + `BoardMutation` (status por polling); mutações → Issues API via `MutationApplierService`; projeção com **debounce** (jobId por projeto, leading-edge, 5 cards = 1 commit). A mutação termina em `applied`; a projeção é consequência e não reverte card em falha.
6. `feito` — Detecção de legado: `BoardService` marca `Project.needsIssueImport` no sync de issues (tem `docs/STATUS.md` sem cabeçalho de projeção **e** nenhuma issue `proplan:*`). Sync de issues disparado pelo evento `SyncCompleted` (sempre, sucesso e noop).
7. `feito` — API: `GET board`, `POST mutations` (202), `GET mutations/:id` (`queued|applying|applied|failed`), `POST/GET board/import-from-status`, `POST board/bootstrap` (propõe cards por IA — `InsightService.proposeCards`) + `/apply`. **Substitui** `POST /bootstrap/status/commit` da SPEC-003 (removido; `BootstrapService` deletado).
8. `feito` — Modo degradado: `has_issues === false` → board read-only, faixa explicativa; `installationStatus = missing` → read-only com CTA de reinstalar.
9. `feito` — Web: aba Kanban dnd-kit (card **variação B**: avatar do assignee + faixa de prioridade semântica), otimista + borda pulsante até `applied` (polling), indicador global "salvando no repo…" na janela de debounce; criar inline/editar popover/descartar com `ConfirmDialog`; coluna Descartado colapsada; banner de importação + badge "importar" no catálogo; bootstrap IA (propõe → revisa → cria). Toasts só no resultado.
10. `feito` — **Teste de arquitetura** (`projection-path.arch.spec.ts`): a projeção mora em `.proplan/STATUS.md`, nunca `docs/` — mutações não mascaram o ⚠️ do ADR-010.
11. `feito` — 113 testes verdes (back), tsc + nest build + vite build limpos; app sobe com as 8 rotas do board; front carrega sem erro de bundle. DEVELOPMENT.md + STATUS.md atualizados; entrega commitada.

### Aceite runtime (2026-07-13)

Validado ao vivo no `RodReis/rrb-adv` (16 issues semeadas com as fatias pendentes do roadmap, criadas por bot):
- ✅ Board lê as issues, 5 colunas com contadores corretos (Backlog 12 · A Fazer 4 · resto vazio); card variação B (avatar do assignee + faixa de prioridade semântica + chip + #número).
- ✅ **O teste que prova a fatia**: arrastar #98 de A Fazer → Em Andamento trocou a label no GitHub (`proplan:todo` → `proplan:doing`) com autor **`rrb-proplan[bot]`**, não o usuário. UI otimista + borda pulsante; mutação `applied` em ~1,4s.
- ✅ Projeção `.proplan/STATUS.md` commitada por `rrb-proplan[bot]` (mensagem padrão), 1 commit (debounce).
- ✅ **ADR-010 não mascarado**: o commit da projeção não entra no histórico de `path=docs` — `lastDocsCommitAt` segue apontando para o último commit humano (12/07). É a razão de `.proplan/` existir.
- ✅ Toast de resultado no Sincronizar (top-right, preferência do PI): sucesso com resumo, "já estava atualizado" no noop, erro persistente.

**Melhoria implementada no aceite (estava no DESIGN.md, faltava):** toast do botão Sincronizar com polling do sync-run e resumo do conteúdo.

### Emenda: 6ª coluna Finalizado + dogfooding no próprio repo (2026-07-13)

A SPEC-005 foi **emendada** (6 colunas: Feito × Finalizado) depois da entrega de 5 colunas; a implementação foi alinhada e o `rrb-proplan` passou a gerir o próprio roadmap:
- **Coluna Finalizado** (`closed` + `proplan:finalizado` = aceito pelo PI). ⚠️ **Correção de 2026-07-13**: **Feito = `open` + `proplan:done`** (era `closed` — errado: trabalho não aceito aparecia fechado para o GitHub e para qualquer agente lendo via GitHub MCP; era o "fechamento frágil" que o produto promete detectar). **A issue só fecha no aceite.** `closes #N` fica **proibido** (usar `refs #N`). Migration `board_finalized_column`.
- **Comentário de carimbo**: mover para Finalizado/Descartado posta `proplan: finalizado pelo PI em <data>` na issue (evidência no GitHub). **Validado**: #11 movida para Finalizado → `closed` + `proplan:finalizado` + comentário por `rrb-proplan[bot]`.
- **Importação do roadmap real**: `docs/STATUS.md` do rrb-proplan importado via UI (prévia editável) → issues 1:1 com as fatias (`card = fatia`, ADR-011). Bugs do parser corrigidos no caminho: CRLF (repo Windows importava 0 cards), títulos com markdown/cauda de metadados, prioridade `prio: **alta**`, placeholder `(vazio)`.
- **UI**: colunas fechadas colapsam em faixa fina vertical; títulos em 3 linhas + tooltip; scroll contido (X no board, Y na coluna). Card Finalizado verde com ✓.
- **Limpeza**: as 16 issues de demo criadas no `rrb-adv` foram fechadas (eram seed, não roadmap canônico).
- 118 testes verdes; builds limpos.

## Fatia 6 — Resolução de documentos + abas (SPEC-006 **ampliada**, `aprovada-pi`) — `finalizado`

Entregue pelo Claude Code (design + plano em `docs/superpowers/`, execução subagent-driven) e **aceito pelo PI em 2026-07-13** (validação runtime no `RodReis/rrb-adv`, repo de nomes próprios).

**O coração da fatia é o `DocumentResolver` (ADR-014), não as abas.** Casar documento por caminho exato funciona só neste repo; os repos reais têm `arquitetura.md`, `adr/0001-*.md`, `docs/qa/`. Escada: convenção → alias → `.proplan/config.yml` → ausente. **O ProPlan nunca renomeia, move ou reescreve doc do usuário** — ele mapeia.

1. `feito` — **`ingestion/domain`** (⚠️ **não** `board` — correção do ADR-014 em 2026-07-13): `DocumentResolver` (escada config→convenção→alias→ausente, puro) + `alias-table` não-ganancioso + `parseProplanConfig`; `DocumentResolution` no Prisma (cache derivado, `docsTreeSha`/`resolvedAt` prontos p/ nível 3 da Fatia 7); `ResolutionService.rebuild` persiste no fim de todo sync (success + noop), como `rebuildLinks`. Teste explícito `archive` ≠ `arch`. 27 testes de domínio.
2. `feito` — Filtro de sync ampliado: `.proplan/config.yml`, `.claude/**` fino (só `skills/*/SKILL.md` e `agents/*.md`), `.github/workflows/*.yml`, diretórios/arquivos de alias na raiz (`adr/`, `AGENTS.md`, etc.). `.proplan/STATUS.md` fora (artefato gerado). Casos negativos testados.
3. `feito` — Parsers determinísticos em `board/domain`: `parseDecisions` (arquivo **ou** coleção `adr/*.md`), `parseDeploy` (tabela de ambientes), `parseSkills` (skills+agents via gray-matter), `parseWorkflow` (fallback CI). Testes unitários.
4. `feito` — API (módulo `board`): `GET /projects/:id/tabs/:tab` (payload + `source: {level, source, path, paths, confidence}`), `GET /tabs/mapping` (rows + `proplanConfigInvalid`), `PUT /tabs/mapping` (escreve `.proplan/config.yml` via write-back com installation token + re-sync; retry em conflito). Ownership id+userId em todas. `board` só **lê** `ResolutionService.resolutionOf` — nunca resolve (ADR-001). `mapping.service` na allowlist do teste de arquitetura do ADR-015.
5. `feito` — Mermaid no viewer (lazy import, isolado em chunk próprio; fallback pro código cru em erro de sintaxe) — vale para Documentos e todas as abas.
6. `feito` — Web: **tela de mapeamento** (overlay: confirmar/corrigir/marcar ausente → PUT; banner de config inválida) + abas Arquitetura, **Decisões**, Design, Testes (com fallback CI), Deploy (tabela com badges), Skills & Agentes; trilho `TabFrame` (skeleton/erro/aviso "reconhecido por nome — corrigir"/empty state); atalho "corrigir" das abas nível 2 abre a tela focada.
7. `feito` — **Teste que prova a fatia**: 3 fixtures (`document-resolver.fixtures.spec.ts`) — repo-convenção → nível 1, repo-nomes-próprios → nível 2, repo-vazio → nível 4. Suíte back **163/163**, builds API+web limpos, API sobe com as 3 rotas. Aceite runtime abaixo.

### Aceite runtime (2026-07-13)

Validado automatizável pelo Claude Code:
- ✅ 165 testes back verdes (incl. as 3 fixtures da prova + teste de arquitetura do ADR-015 estendido para `mapping.service` + o caso de `resolutionOf` ausente).
- ✅ `tsc --noEmit` + `nest build` + `vite build` limpos.
- ✅ API sobe com `/projects/:id/tabs/:tab` (GET), `/tabs/mapping` (GET, PUT) mapeadas.
- ✅ Migration `fatia_6_document_resolution` aplicada; coluna `proplan_config_invalid` no banco; 3 projetos gerenciados preservados.

Validado ao vivo pelo PI no **`RodReis/rrb-adv`** (repo de nomes próprios, documentação farta):
- ✅ **Escada do ADR-014 em repo não-convencional**: Decisões (`docs/DECISÕES.md`, com acento) e Skills&Agentes (`CLAUDE.md`) resolvidos por **alias** (nível 2, badge "reconhecido por nome"); Design por **manual** (`.proplan/config.yml` → `docs/design/DESIGN_SYSTEM.md`); Testes e Deploy **ausentes** (nível 4). Alias acento-insensitive comprovado.
- ✅ **Aba Testes com fallback de CI**: sem doc de testes, parseou `.github/workflows/ci.yml` (name/gatilhos/jobs).
- ✅ **Tela de mapeamento end-to-end**: trocar a fonte → toast "Mapeamento salvo — re-sincronizando" → `.proplan/config.yml` commitado no repo (aparece na lista de docs após o re-sync). Escrita por installation token (bot).
- ✅ **Critério de cache (o "#7")**: apagadas as 6 linhas de `document_resolutions` do rrb-adv e reconstruídas a partir de `documents` + `.proplan/config.yml` (sem tocar no GitHub) → **estado idêntico** (hash `3da0577c…` antes e depois). Prova de que a resolução é cache derivado e a decisão do usuário vive só no repo.

**Achados do PI durante o aceite (NÃO são bug da Fatia 6 — viram trabalho próprio, ver abaixo):** a lista de documentos é plana (deveria ser árvore de pastas quando há muitas subpastas); binários (`.pdf`, `.docx`) e `.html` aparecem como lixo/HTML cru no viewer (o pipeline os lê como texto — limite técnico do ADR-003, não violação de path). Árvore tratada como polimento da aba Documentos; binários com preview abrem fatia própria (emenda ao ADR-003).

## Documentos ricos — árvore + preview de binários — `finalizado`

Achado no aceite da Fatia 6. Entregue pelo Claude Code (design + plano em `docs/superpowers/`, execução subagent-driven) e **aceito pelo PI em 2026-07-13** (4 tipos validados ao vivo no `rrb-adv`).

1. `feito` — **Árvore de pastas** (`DocTree`): a lista plana de docs vira árvore, pastas antes de arquivos, expand/collapse (rasas abrem). Resolve o scroll enorme em repos com muitas subpastas.
2. `feito` — `classifyKind` (extensão → `markdown|pdf|image|html|office|binary`, puro) + `Document.kind` (migration `documentos_ricos_kind`, default markdown).
3. `feito` — **Sync classifica**: markdown baixa+persiste (fluxo atual, intacto); binário grava **só metadado** (`content: ''`, `byteSize: 0`, `kind`), **não baixa os bytes**. Sync tão leve quanto antes.
4. `feito` — **Endpoint `GET /documents/raw`**: busca o blob do GitHub sob demanda (user token, respeita visibilidade), stream **efêmero** com Content-Type correto — **nunca persiste bytes**. `.docx`→texto via **mammoth**; `.html`→`iframe sandbox=""` + CSP no response; teto 25 MB → 413. Ownership; só serve path do índice (não é proxy arbitrário). Teste de arquitetura do ADR-015 prova que não usa installation token.
5. `feito` — **Viewer ramifica por kind**: pdf (iframe nativo), image (`<img>` + fundo xadrez), html (sandbox + aviso), office (texto + aviso), binary (estado neutro), markdown (atual, com Mermaid — preservado sem regressão).
6. `feito` — Emenda ao **ADR-003** (binário em `docs/` é documentação, não código; preview sob demanda, nunca persiste bytes) + `CONVENTION.md` + `ARCHITECTURE.md`. 175 testes verdes, builds limpos.

### Aceite runtime (2026-07-13)

Validado ao vivo pelo PI no `rrb-adv`: **os 4 tipos** — `finac.png` (imagem, fundo xadrez), `Requisito.docx` (texto extraído por mammoth), `mockup-builder-agentes-SPEC-025.html` (renderizado em sandbox, "scripts não executados"), `Software jurídico para advocacia.pdf` (viewer nativo, 8 páginas, miniaturas/zoom). Banco confere: 23 binários (3 pdf · 17 image · 2 html · 1 office) com **`content` vazio** (só metadado), 104 markdown com conteúdo.

**Nota de estado durante o aceite**: os docs já sincronizados **antes** desta fatia ficam `kind=markdown` (a migration defaultou markdown) até o primeiro sync pós-fatia reclassificar. No aceite, isso exigiu limpar o `docsScopeHash` (forçar reprocessamento) — porque o sync é idempotente por hash e o hash não muda só porque a lógica mudou.

### Achados de produto (registrados, NÃO corrigidos — decisão do PI)

Dois defeitos **latentes** que esta fatia **expôs** mas não causou — ambos da idempotência do sync (ADR-003/SPEC-002), a decidir em fatia própria:

1. **`docsScopeHash` conta arquivos `skipped`.** Um blob pulado (ex.: PDF >512 KB tratado como texto no passado) entra no hash (está na árvore) mas nunca vira `document`. Como o hash não muda, o sync é sempre `noop` e o arquivo fica invisível — mesmo depois de a lógica que o pulava ser corrigida. No aceite, os 3 PDFs só entraram após limpar o hash à mão. Correção possível: o hash contar só o que realmente foi ingerido, ou uma migration de fatia forçar re-sync.
2. **Doc texto→binário mantém o `content` de texto** até um reprocessamento que o toque por SHA. O ramo binário do sync limpa `content` no upsert, mas só quando o doc entra em `added`/`updated`; docs pré-fatia com mesmo SHA não reprocessam. No aceite, ~2 MB de lixo (imagens lidas como texto) ficaram no banco; limpos à mão. Mesma raiz do #1: mudança de lógica não invalida a idempotência por SHA/hash.

## Fatia 7 — Insight semântico (SPEC-007, `aprovada-pi`) — `feito` (aceito pelo PI em 2026-07-14)

Entregue pelo Claude Code (design + plano em `docs/superpowers/`, execução subagent-driven: implementer + review por task, review final whole-branch). **Onde a convenção não alcança, a IA completa** — sempre rotulada, versionada por hash, com caminho de promoção a documento real. Fronteira ADR-001 respeitada (o `insight` gera, o `ingestion`/`board` persistem via métodos públicos); nenhuma IA no render (ADR-002).

1. `feito` — Prisma: `DocLink.kind inferred` + `reason`, `SuppressedLink`, `Insight.kind` (`edges_marker`, `classify_marker`, `architecture_fallback`, `design_fallback`); migration aplicada.
2. `feito` — Job de arestas semânticas (batch por sync, JSON estrito + 1 retry, exclui explícitas e suprimidas; idempotente por `edges_marker`).
3. `feito` — API supressão de aresta (`DELETE /graph/edges`, ownership antes) + grafo com `kind`/`reason`; Web: tracejadas âmbar, tooltip do motivo, remover (otimista+rollback), toggle, painel acessível por teclado.
4. `feito` — **Nível 3 da escada (ADR-014)**, no **`insight`**: classificação semântica com spans obrigatórios (ADR-012), grava `DocumentResolution` via `writeInferredResolution` (`source: 'inference'`); **nunca sobrescreve** `config`/convenção/alias; **deploy nunca classificado**. Abas: badge âmbar + spans + "corrigir mapeamento". **Raiz corrigida (decisão PI)**: `rebuild` preserva inferidas no noop (`rebuildLinks` só apaga `explicit`; `resolution.rebuild` preserva `inference` só enquanto a entidade continua ausente E o doc ainda existe).
5. `feito` — Fallbacks Arquitetura/Design: job (markdown versionado por hash, só gera se ausente), badge âmbar, **"Promover a documento"** (editor + preview → write-back por `rrb-proplan[bot]` → re-sync). ⚠️ **Sem botão "Regenerar"** — cortado em 2026-07-13 (é chamada de IA sem teto; o cap só chega na Fatia 7.5). Correção de fallback ruim = **promover a documento** ou **corrigir mapeamento**, nunca re-rolar o dado.
6. `feito` — Suíte 223 testes verde, `tsc` e builds (API+web) limpos. **Review final whole-branch** pegou 1 bug cross-task (resolução nível 3 preservava path de doc deletado → aba 500 permanente) — corrigido na raiz (`rebuild` valida a existência do path). Concorrência dos jobs confirmada serial (BullMQ concurrency=1): classify sempre antes de fallback, sem race.
7. `feito` — **Sync SHA-aware** (bug do aceite runtime do landpage: promover `DESIGN.md` → re-sync leu a árvore velha → `noop` → doc não ingerido até sync manual). Raiz na decisão de `noop` da `SyncService`: `enqueueSync` recebe `{path, blobSha}` do write-back, persiste em `SyncRun.expectPath/expectBlobSha`; `listScope` refaz `listTree` com backoff (teto 3) até a árvore refletir o blob, e só então decide. Cobre **todos** os call sites (`promote`, `putMapping`), não só o promote — nenhum dorme. Decisão **blob SHA** (não commit SHA da 1ª redação) **revalidada**: prova mais forte (conteúdo-endereçado, zero falso positivo) e mais barata (sem request extra) — ver ARCHITECTURE.md §Resiliência, com a condição que obrigaria a virar lista de blobs. Entregue no PR #17 (mergeado); render do TabFrame + docs do board no PR #16 (mergeado).

**Aceite runtime (pendente do PI, padrão das Fatias 1-6):** precisa login no GitHub App + olho ao vivo no `rrb-adv`. Roteiro: arestas tracejadas com motivo + remover não ressuscita no re-sync (`SuppressedLink`); mesmo hash → 0 nova chamada de IA; doc de nome não-convencional classificado nível 3 com badge + spans, "corrigir" grava `config.yml`; projeto sem `ARCHITECTURE.md` mostra fallback + badge, promover commita e o badge some após re-sync; **noop não destrói inferência** (fix da raiz). O aceite gasta tokens de IA reais (conta do PI).

**Aceite runtime específico do sync SHA-aware (item 7)** — precisa de projeto sem `docs/DESIGN.md` (nível 4 com fallback; o `landpage` foi onde o bug apareceu):
1. **Promote → ingestão imediata** (o bug original): aba Design → "Promover a documento" → aprovar/commitar. O badge deve sumir e a aba virar `alias`/`convention` **sem** um 2º sync manual. Antes do fix ficava no fallback até clicar Sincronizar.
2. **Log do poll**: no `SyncRun` do promote, se a árvore propagou rápido o `listScope` acerta na 1ª/2ª leitura (sem warn); se demorou, aparece `WARN [SyncService] Trees API ainda não refletiu docs/DESIGN.md … após 3 tentativas` — e o **próximo** sync corrige (sem perda).
3. **putMapping** (2º call site): "corrigir mapeamento" → `.proplan/config.yml` commitado → nova resolução reflete sem sync manual.
4. **Prova no banco** (opcional): `SELECT expect_path, expect_blob_sha, status FROM sync_runs ORDER BY started_at DESC LIMIT 1;` após um promote → `expect_path = 'docs/DESIGN.md'`, `expect_blob_sha` preenchido, status `success` (não `noop`).

O que só o aceite prova (os testes mockam `listTree`): a janela de consistência eventual **real** do GitHub. Se o teto de ~7,5s (3 tentativas: 1s+2s+4,5s) não bastar no p99, o passo 1 vai exigir 2º sync às vezes → sinal de subir o teto (`TREE_PROPAGATION_BACKOFF_MS`).

### Aceite runtime executado (2026-07-13, `RodReis/construtor-erp`)

Validado ao vivo contra a consistência eventual **real** do GitHub (repo só com README; arch/design em nível 4 com fallback). Os três write-backs geraram `SyncRun` com expectativa e resultaram em **`success +1`, nunca `noop`**:

| caso | call site | `expect_path` | `expect_blob_sha` | resultado |
|---|---|---|---|---|
| promote Design | `promote` | `docs/DESIGN.md` | `9e92a5f` | success +1 ✅ |
| promote Arquitetura | `promote` | `docs/ARCHITECTURE.md` | `cac0e88` | success +1 ✅ |
| mapeamento Decisões→ARCHITECTURE | `putMapping` | `.proplan/config.yml` | `681d12e` | success +1 ✅ |

- **Ambos os call sites** (`promote` e `putMapping`) cobertos — o fix não é só do promote.
- Resolução migrou na hora, sem 2º sync manual: arch/design 4/absent → 2/alias; decisions 4/absent → 1/config.
- **Zero warns** de propagação lenta — o teto de ~7,5s cobriu a janela real do GitHub com folga.
- Render do #16 confirmado junto: as abas mostraram badge âmbar + markdown + "Promover".

O bug original (promover → `noop` → doc não ingerido até sync manual) **não reproduz**.

## Fatia 7.6 — Operação assíncrona visível + painel de Atividade (SPEC-010, `aprovada-pi`) — `feito` (aceito pelo PI em 2026-07-14)

**Achado no aceite runtime da Fatia 7**: o usuário promove um documento, clica em commitar e a tela **fica idêntica por 5–10 segundos**. Sem sinal nenhum. O PI aguentou porque *sabia* o que rodava por baixo; outra pessoa clica de novo ou fecha.

**Não é bug do promote.** É a forma de **toda escrita síncrona** do ProPlan — `ação → commit → propagação → sync → recarregar` — em **três fluxos**: **promote**, **bootstrap** e **salvar mapeamento**. E a operação **continua rodando se o usuário sair da aba**, então feedback preso ao botão não basta.

⚠️ **Correção de 2026-07-13 — o Kanban NÃO entra.** A spec dizia "quatro fluxos"; estava errado. O Kanban **não congela**: é otimista (SPEC-005) — o card muda de coluna na hora e pulsa até confirmar. Incluí-lo era **uniformidade por uniformidade** (abstração antes do segundo consumidor — regra da SPEC-003) e criaria **dois registros do mesmo trabalho** (`BoardMutation` + `Operation`) — a segunda fonte que o **ADR-017** proíbe. **`board_mutation` fica exatamente como está.**

1. `feito` — Módulo novo `activity` (dono do `Operation`, ADR-001): Prisma `Operation` (kind, steps Json, status, commitUrl?, syncRunId?) + migration; `ActivityService` (start/advance/attachArtifacts/finish/fail) exportado por interface pública; `GET /operations/:id`. **Estado mora no servidor**; o passo final se conclui sozinho quando o `SyncRun` associado termina (derivação lazy no `get` — não acopla o worker BullMQ). Passos nomeados no `domain/operation-steps` (puro, testado). **Promote migrado** — devolve `{ operationId }`. Os outros 3 fluxos ficam no passo 3.
2. `feito` — `<OperationSteps/>` + `useOperation` (polling 1s — sem SSE/webhook; mesmo padrão do `mutationId`/`sync-run`). **Passos em linguagem de gente**, sem jargão. PromoteDialog mostra os passos e a aba recarrega sozinha ao concluir (badge âmbar some). Aceite ao vivo no `construtor-erp`: passos "Commitando… → Aguardando propagar… → Sincronizando… → Pronto" visíveis, auto-refresh sem clicar Sincronizar.
3. `feito` — Migrados **mapping** (`putMapping`) e **bootstrap** de cards (`createCards`, usado pelo bootstrap por IA e pela importação de legado) para o `Operation`. O bootstrap conclui **síncrono** (cria N issues + `syncIssues`, sem SyncRun de docs — passos "Criando os cards como issues… → Sincronizando o board… → Pronto"). Front: `MappingScreen`, `kanban/BootstrapDialog`, `kanban/ImportBanner` usam `<OperationSteps/>`; nenhum tem feedback próprio. ⚠️ **`board_mutation` NÃO migrou** (decisão do PI, spec corrigida): o Kanban já é otimista (SPEC-005), não tem o sintoma do silêncio, e tem seu próprio estado (`BoardMutation` + `mutationId`) — envolvê-lo criaria a 2ª fonte que o ADR-017 proíbe. Kanban inalterado. Aceite ao vivo do mapping no `construtor-erp`: Operation `mapping` com os 4 passos, `decisions` migrou 4/absent → 1/config sem clicar Sincronizar. **Dívida pré-existente encontrada (fora de escopo, apontar ao PI):** `pages/workspace/BootstrapDialog.tsx` (aba Visão Geral → "Gerar proposta de STATUS.md") chama `api.commitStatus`, cujo endpoint **não existe mais** (removido na SPEC-005) — está quebrado desde antes desta fatia.
4. `feito` — `GET /projects/:id/activity?cursor=&includeSyncs=` + `GET .../activity/running` + `<ActivityPanel/>` (no `Workspace`, fora das abas → **sobrevive à navegação**). **Agora**: polling das operações `running` (mesmo `OperationSteps`). **Histórico**: **projeção de leitura** (`domain/activity-feed`, puro e testado) sobre `Operation`+`Insight`+`BoardMutation`+`SyncRun` — **por projeto**, ordem reversa, cursor por timestamp. `LlmUsage` entra quando a 7.5 existir (degrada sem ela). **Toggle "mostrar syncs"** revela os `SyncRun` (inclusive `noop`); sem ele, só escrita e inferência. **Não** duplica evento (ADR-017). Aceite ao vivo no `construtor-erp`: histórico com insights + "Salvou o mapeamento" (link `.proplan/config.yml`); toggle revela "Sincronizou — 1 novo, 2 removidos", "nada mudou".
5. `feito` — Critérios da SPEC-010 conferidos ao vivo (promote/mapping com passos nomeados + auto-refresh; painel por projeto; feed limpo por padrão; commit com link; sem jargão). 252 testes verdes, builds API+web limpos. Este arquivo + STATUS.md atualizados.
6. `feito` — **2 bugs achados no aceite runtime** (PR #24, `refs #19`, rebaseado sobre a main pós-7.5): (a) **nome de coluna canônico** — `"para todo"` mostrava o enum cru; a tradução não é do board (é da convenção, com N consumidores), subiu para o kernel `shared/convention/columns.ts` (fonte única — board, projeção `.proplan/STATUS.md`, painel e futuro MCP importam de lá; ADR-001 não permite importar `board/domain`, ADR-017 não permite 2ª cópia). (b) **resultado por linha** — do artefato persistido, nunca de nova inferência: `"Classificou N documentos"` (hits do `classify_marker`), `"Inferiu N ligações"` (o `edges_marker` passa a gravar `content.count`; as arestas vão para o ingestion). Insights de texto (resumo/fallbacks/backlog) seguem com título fixo; tokens/custo entram com a 7.5. **272 testes no total** (50 suítes), tsc limpo.

> **Sinergia**: o sync SHA-aware (backlog, prio alta) mata o `sleep(2500)` do promote — o passo "aguardando propagação" deixa de ser tempo cego e vira verificação real.

## Fatia 7.5 — Consumo de IA: tokens, custo e teto (SPEC-009, `aprovada-pi`) — `finalizado` (#25 aceita pelo PI em 2026-07-14)

**Última fatia do MVP1.** Sem dependência de nenhuma outra — toca só `insight` e `settings`. Marcada `[paralelo]`: pode ser puxada para frente a qualquer momento. **Antecipe se a conta de IA assustar durante a Fatia 7**, que é a que mais chama o provedor.

**O erro que ela corrige** (ADR-016): a tabela `insights` de hoje **não é** um registro de gasto. Ela é cache de artefato chaveado por `docs_tree_sha` — logo, não vê chamadas que falharam, não vê o retry de JSON inválido, não vê proposta de bootstrap descartada, e perde o gasto antigo quando o artefato é regenerado. Somar `insights.inputTokens` produz uma conta que **sempre subestima**.

1. `feito` — Prisma: `LlmUsage` (append-only: sem `@updatedAt`, `onDelete: SetNull` — o gasto sobrevive ao projeto) + `ModelPrice` (`@@unique[provider,model,effectiveFrom]`) + `Settings.llmAlertUsdMonthly`/`llmHardCapUsdMonthly` (Decimal 5/20); migration + **`prisma/seed.ts`** (1ª fatia que precisou de seed — `claude-sonnet-5`, `gpt-4o` com cache write 0).
2. `feito` — `LlmResponse` (ADR-008) devolve o **uso bruto normalizado** (`cacheCreationTokens`/`cacheReadTokens`, `providerCostUsd?`); **cada adapter normaliza o seu formato** — Anthropic (`cache_creation`/`cache_read`), OpenAI (`prompt_tokens_details.cached_tokens`→read, write=0), OpenRouter (`usage.cost`→`providerCostUsd`). `LlmUsageRecorder` (`insight/application`) grava a linha; adapters **não** conhecem preço nem banco.
3. `feito` — `domain/cost.ts` (puro): custo em `Decimal` (nunca `Float`), cada componente com a tarifa própria (input≠output≠cacheWrite≠cacheRead), `priceSnapshot` congelado, `costSource` (provider vence a tabela; sem preço → `none`+`priceMissing`). **5 chamadas de IA instrumentadas** (summary/edges/classify/bootstrap via `runParsed`; fallback via `run`) — retry de JSON inválido gera 2 linhas (attempt próprio, `discarded`+`ok`).
5. `feito` — Falha ao gravar o ledger é **logada, não propagada** (o `run`/`record` engolem o erro do banco; o trabalho do usuário segue). Linha gravada **também em erro** (`status: error`, tokens que o provedor devolveu, ou `0` em timeout puro). **10 testes novos** (`cost.spec`, `llm-usage.recorder.spec`); 261 no total, build limpo. **PR 1 da fatia.**
4. `feito` — `UsageService`: `SUM(cost_usd)` do mês **global** (todos os provedores; `priceMissing` fora da soma), `currentMonth` (`{costUsd, alertUsd, capUsd, blocked, missingPriceCount}`) e `canSpend`/`canSpendForUser`. **Gate no enfileiramento**: o listener de `DocsSynced` barra os 4 jobs antes de enfileirar; `regenerate` e `proposeCards` lançam `ForbiddenException` se o teto foi atingido (sem "forçar"). Teto `0` desliga. API: `GET /usage/llm` (relatório + quebras + **taxa de desperdício**), `GET /usage/llm/current-month`, `GET/PUT /settings/model-prices` (nova vigência, nunca reescreve). 8 testes do gate (soma global, teto 0, projeto inexistente → não gasta); 269 no total, build limpo. **PR 2.**
6. `feito` — Web: tela Configurações → aba **Uso de IA** (`UsageTab`). Mês corrente com barra até alerta/teto (verde→âmbar→vermelho por estado, marcador do alerta), faixa de bloqueio com valores quando estoura, **aviso de preço ausente ao lado da barra** (não escondido). Stats Chamadas/Tokens/**Desperdício** (âmbar), quebra por tipo (rótulos em pt-BR) e por resultado (só se houver erro/descarte), tabela de preços por modelo. Campos de **Alerta/Teto** na aba geral (salva `onBlur`). Faixa de alerta na **Visão Geral** (`UsageAlert`, silenciosa dentro do orçamento). Todos os números vêm do `SUM` do banco — sem conta própria na UI. **PR 3.**
7. `feito` — Aceite ao vivo (Chrome DevTools): tela bate com `SUM` do banco ($0.07), desperdício 14.8%, preço-ausente sinalizado; editar o teto para abaixo do gasto → barra vermelha + bloqueio com "($gasto/$teto)". Este arquivo + STATUS.md atualizados; tudo commitado.

## Fatia 7.7 — Invalidação de inferência por `inputHash` (SPEC-011, `aprovada-pi`) — `feito` (aceito pelo PI em 2026-07-14)

Emenda ao ADR-002 — troca **a chave** de invalidação (não o princípio): o artefato de IA passa a ser chaveado pelo **hash do prompt efetivamente enviado ao provedor**, não pelo `docs_tree_sha`. Elimina o desperdício medido: cada entrega do Code (commit de `DEVELOPMENT.md`/`STATUS.md`) disparava os 4 jobs; agora só o `summary` regenera (ele legitimamente muda). Alvo **4 → 1**.

1. `feito` — Prisma/migration `fatia_7_7_input_hash`: **rename** `Insight.docs_tree_sha`→`docs_scope_hash` (`ALTER ... RENAME COLUMN`, preserva os dados — vira metadado histórico), `Insight.inputHash` (nullable, índice `[projectId, kind, inputHash]`), tabela **`InsightRun`** append-only (`generated|reused|failed`) + enum `InsightRunOutcome`. Backfill: `inputHash=NULL` nas 65 linhas antigas → cache-miss no 1º sync (1 regeneração por projeto, depois estabiliza) — **não reconstrói o passado com a lógica de hoje** (ADR-016).
2. `feito` — `insight/domain/input-hash.ts`: `computeInputHash({system,user,provider,model})` puro (SHA-256, campos unidos por `\0` para concatenação injetiva). `LlmClient.model` exposto (resolvido do env) — é o modelo **requisitado**, não o que a resposta relata. 7 testes de determinismo/sensibilidade.
3. `feito` — Gate por `inputHash` nos 4 geradores (`summary`/`edges`/`classify`/`fallback`): monta o prompt → calcula o hash → busca `Insight(projectId, kind, inputHash)`. **Hit** ⇒ não chama o provedor, registra `InsightRun reused`, **não toca `LlmUsage`** (cache-hit não é gasto) e **não reescreve** as arestas/resolução (o rebuild determinístico do sync preserva `DocLink:inferred` e `DocumentResolution:inference` — verificado). **Miss** ⇒ chama, grava o artefato com os dois hashes, `InsightRun generated`. Cache-hit **não** sobrescreve o `docs_scope_hash` (Decisão 2 do PI).
4. `feito` — Painel de Atividade: a fonte do feed para IA passou de `Insight` (o artefato) para **`InsightRun`** (a execução) — sem duplicar o fato "gerou" (ADR-017). Distingue **gerado × reaproveitado** em linguagem de gente ("Gerou o resumo por IA" / "Reaproveitou as ligações — nada mudou / sem custo"). Custo: perdeu-se o "N ligações" que a 7.6 mostrava (o `InsightRun` não guarda contagem) — aceito.
5. `feito` — Botão **Regenerar** com `force`: `POST /projects/:id/insights/:kind/regenerate` (genérico) ignora o `inputHash`, força a IA — único caminho para reaplicar um provedor/modelo novo sobre docs inalterados (ADR-008). Protegido pelo teto (SPEC-009) → `403` com valores. A UI da Visão Geral (summary) já tinha o botão + `ConfirmDialog` de custo + trata o 403; a rota antiga (`insights/summary/regenerate`) segue casando. Botões nos fallbacks Arq/Design ficam no **backlog** (fora dos critérios de aceite da 7.7).
6. `feito` — Teste de determinismo do prompt (mitiga o risco central da spec): roda cada builder real 2× sobre os mesmos docs e exige hash idêntico — um prompt não-determinístico faria o gate nunca acertar, em silêncio. 286 testes no total (+14), builds API+web limpos.

**Achado técnico (resolvido no aceite):** a spec tinha uma **contradição interna** — Escopo item 2 dizia "hit ⇒ atualiza `docsTreeSha` para o corrente"; a Decisão 2 do PI (2026-07-14) dizia o oposto. **O PI confirmou a Decisão 2** (2026-07-14): cache-hit **não** sobrescreve o `docs_scope_hash` — vira metadado histórico. Implementado assim.

### Aceite runtime (2026-07-14) — validado no dogfooding do próprio rrb-proplan

O teste que prova a fatia rodou ao vivo, em dois syncs:
- **Aquecimento** (1º sync pós-migration, `inputHash=NULL` → miss em tudo): 3 `generated` (`summary`+`edges`+`classify`; `fallback` não roda — Arq/Design têm doc real). Backfill como a spec previu.
- **Medição** (2º sync, editando um heading do `DEVELOPMENT.md`): `summary` **reused** (o doc ficou fora do contexto de 12k tokens → prompt idêntico), `classify` **reused**, `edges` **generated** (um heading mudou — o edges consome headings). **`llm_usage` subiu só +1**, não +4. O critério "editar heading → edges regenera" foi provado de brinde.

### Achados do aceite — painel de Atividade (3 melhorias entregues no mesmo PR)

O painel dizia "reaproveitou" mas não deixava crível que reaproveitar custou zero, nem quanto custou quando gerou. Corrigido:

7. `feito` — **Custo por linha de IA**: `LlmUsage.inputHash` (migration aditiva) liga a chamada ao artefato; o feed casa `InsightRun ↔ LlmUsage` por `(projectId, kind, inputHash)`. Cada linha `generated` mostra tokens (entrada/saída); `reused` mostra "Sem chamar a IA (sem custo)". `LlmUsage` segue a única fonte do gasto (ADR-016) — o feed só lê. **Gasto exibido em tokens, não em dinheiro** (decisão do PI: o cifrão no feed assusta; o US$ vive na aba Uso de IA).
8. `feito` — **"leu N documentos"**: `InsightRun.docsRead` (migration aditiva) — nº de docs que entraram no prompt de cada geração, gravado pelos 4 geradores.
9. `feito` — **Bloco "Última rodada de IA"** no topo do painel: N geradas × N reaproveitadas + total de tokens + "economizou N chamadas" + o próximo passo em linguagem de gente (Sincronizar → recarregar → ver na aba). Deriva do feed, sem dado novo.

**Bug corrigido no aceite**: ao renomear o `kind` do feed (`insight`→`insight_run`), o front tinha o tipo e o mapa `GROUP_OF` ainda no valor antigo → `undefined.mark` quebrava o painel. Escapou do build porque back e front têm tipos separados (acoplados por string). 290 testes no total, builds API+web limpos.

## Fatia 6.1 — Aba Deploy: documento primeiro (SPEC-012, `aprovada-pi`) — `finalizado` (mergeado PR #38/merge #39; #38 aceita pelo PI em 2026-07-15)

Emenda de renderização à Fatia 6 (ADR-014). Deploy era a única aba com parser estrutural rígido: `tabs.service` rodava `parseDeploy(md)` e **descartava o documento**. Doc mapeado sem a tabela do `CONVENTION.md` (achado no dogfooding do `rrb-organize`: `docs/runbooks/deploy-railway.md`, prosa) → aba desenhava cabeçalho de tabela vazio. O ProPlan exigindo o próprio formato — violando o ADR-014 na renderização, depois de o mapeamento ter feito a coisa certa.

1. `feito` — `tabs.service` (`case 'deploy'`): payload aditivo `{ environments, markdown, path }`. Novo helper `deployDoc` resolve o markdown de arquivo único (`markdownOf`) **ou coleção** (decisão do PI — concatena os N `paths`, cada doc sob `## <path>`, ordem de `paths` preservada). `parseDeploy` **não muda**.
2. `feito` — `DeployTab.tsx`: 3 estados — painel de ambientes **acima** + doc abaixo (se `environments`) · **só o doc** (`MarkdownView`, o mesmo viewer de Arq/Design — react-markdown + Mermaid lazy da Fatia 6) · vazio "não documentado" + CTA (via `TabFrame`, inalterado).
3. `feito` — **Fallback de IA em Deploy segue proibido** (`CONVENTION.md`): renderizar o que o humano escreveu não é inferir deploy. Doc com tabela mostra a tabela 2× (duplicação aceita pelo PI — esconder conteúdo do dono exigiria um 2º parser de seções e seria dívida de princípio).
4. `feito` — Testes da fatia (`tabs.service.spec`): doc sem tabela → `markdown` não-vazio + `environments: []`; doc com tabela → painel **e** markdown; coleção → concatena na ordem. `parseDeploy` inalterado (15 testes de deploy/tabs passam sem mudança — prova). 298 testes no total, builds limpos.

Risco baixo: mudança aditiva no payload + render, nenhuma escrita no repo, nenhuma IA, nenhum job. Alvo real: `rrb-organize` (deploy `source: config`).

## Fatia 6.2 — Formato de Deploy: 3 eixos (SPEC-017, `aprovada-pi`) — `finalizado` (mergeado PR #54 merge `8beab73`; validado ao vivo; aceito pelo PI em 2026-07-15)

Fecha o furo do `CONVENTION.md`: a tabela canônica de Deploy tinha **um eixo (ambiente)**; a realidade tem **três** (ambiente × componente × infra de apoio). Destrava a honestidade da SPEC-013 — o CTA "corrija a doc" passa a apontar para um formato que comporta front-Netlify + API-Railway. Zero IA; formato segue convite (ADR-014).

1. `feito` — `parseDeploy` (`board/domain/deploy-doc.ts`) reescrito **header-aware**: mapeia colunas pelos nomes do cabeçalho, não por posição. `DeployEnv` ganha `componente?` (opcional). Formato de 4 colunas continua parseando (compat v1); 5 colunas com `Componente` ganha o eixo. Célula/coluna ausente tolerada; ordem de colunas trocada mapeia igual.
2. `feito` — Testes (`deploy-doc.spec`): fixture antigo de 4 colunas **passa sem alteração** (prova de compat); novo de 5 colunas cobre `rrb-escola` (web/Netlify + API/Railway, 1 ambiente) e `rrb-organize` (app + 2× redis, sem `+` colando provedores); ordem trocada; componente vazio → sem componente. 7 testes de deploy.
3. `feito` — `DeployTab.tsx`: agrupa por ambiente com `rowSpan`; coluna `Componente` só aparece quando algum ambiente a usa (monolito = tabela idêntica à anterior). `DeployEnv` no `api.ts` (web) ganha `componente?`.
4. `feito` — `CONVENTION.md`: exemplo de Deploy vira 3 eixos (Netlify+Railway+Supabase+redis, sem `Vercel + Supabase` numa célula), versão da convenção de Deploy **v1 → v2**, nota de compat de um ciclo.

458 testes no total (+5), tsc web+api limpos. Risco baixo e controlado (ADR-014): universo é os `rrb-*`, formato é convite, compat de um ciclo obrigatória.

**Validação runtime (aceite do PI, 2026-07-15):** API real (`node dist/main.js`, endpoint `GET /projects/:id/tabs/deploy`, cookie `proplan_session`), projeto seedado com DEPLOY.md e revertido depois. Capturado do response real: **5-col** → `environments` com `componente` populado (web/API/banco/cache), `produção` com Netlify+Railway como componentes distintos, `cache (redis-volume)` linha própria sem `+`, `—`→`url:null`; **4-col** → sem `componente` (compat provada ao vivo, não só no fixture); **ordem de colunas trocada** → mapeada por nome (header-aware confirmado). Achado: instância órfã na 3311 (secret/código velho) dava 401 num token válido — matar todas antes (ver nota de watchers órfãos).

## Fatia 13 — Drift de deploy: confronto de fontes (SPEC-013 v2.1, `aprovada-pi`) — `finalizado` (mergeado PR #40; #5 aceita pelo PI em 2026-07-15)

Parar de dar crédito institucional a doc de deploy possivelmente defasada — **sem afirmar qual plataforma é a verdadeira**. Confronta 4 fontes (doc · config no repo · GitHub Deployments · URL declarada pelo dono); quando discordam, mostra cada uma com natureza + data; quando só há sinal GitHub-side, admite que não há fonte fresca e **pede a URL**. **Zero IA, zero chamada externa** (a plataforma sai do domínio da URL por parse de string), zero credencial de plataforma. ADR-018/probe negado (→ Fatia 13.6); handoff → 13.5.

1. `feito` — **Domínio puro** `ingestion/domain/deploy-drift.ts`: `extractDeclaredPlatforms` (texto, word-boundary), `platformsFromRepoConfig` (presença de `vercel.json`/`netlify.toml`/`Procfile`/…), `platformFromDeclaredUrl` (sufixo de domínio → plataforma; domínio próprio → null, **nunca chuta**), `reconcile` (os 5 estados: concordam/discordam/so_github_side/omissa/silencio — coroa nenhuma fonte). 26 testes, incl. o caso `rrb-escola` real (config+GitHub Vercel × URL Netlify+Railway → `discordam`) e "migramos da Vercel" não vira falso discordam.
2. `feito` — Prisma: `Project.deployVerdict`/`deploySignals`(Json)/`deployObservedAt`; migration `fatia_13_deploy_drift`.
3. `feito` — `parseProplanConfig`: lê `deploy.prodUrls` (lista — string ou `{url, platform}`; platform à mão cobre domínio próprio). `merge`/`serialize` **preservam** as URLs (salvar mapeamento não pode apagá-las). 12 testes.
4. `feito` — `GithubGitClient`: `listDeploymentUrls` (deployments + status → `environment_url`) e `listRootFiles` (config de deploy fica fora de `docs/`). **`fetchGithubOptional`** degrada em 401/403/404 → sem `Deployments: read` retorna `denied`, sem derrubar o sync. Só metadado (ADR-003), user-to-server token (ADR-015).
5. `feito` — `SyncService.updateDeploySignals`: coleta as 4 fontes → `reconcile` → persiste, nos **dois** caminhos (noop + success), **tolerante a falha** (mesma regra do `updateCommitMeta` — falhar não derruba o sync).
6. `feito` — `tabs.service` (`case 'deploy'`): payload aditivo com `deployVerdict`/`deploySignals`/`deployObservedAt` (lê o cache persistido; **não recomputa no render**, ADR-002).
7. `feito` — Web: `DeployTab` faixa de confronto no topo (`DriftBanner`) — cada fonte com **natureza + plataforma + "observado em <data>"**, CTA "declare a URL" no `so_github_side`, **nunca** "roda em X" nem rótulo "congelado/resíduo". Badge no catálogo (`Home.tsx`): "deploy divergente" (discordam) / "deploy?" (so_github_side/omissa).
8. `feito` — ADR-015: `Deployments: read` adicionado à permissão mínima. `Deployments: read` já concedida na instalação `RodReis` (2026-07-14).

**Validação ao vivo executada pelo Code (2026-07-14)** — migration `fatia_13_deploy_drift` aplicada, sync real (token do usuário no banco):
- `rrb-adv` → **`silencio`** (sinais `[]`) — nenhuma fonte aponta nada; "não documentado" é a resposta correta.
- `rrb-organize` → **`so_github_side`** — doc (`docs/runbooks/deploy-railway.md`) cita Railway, mas nenhuma fonte fresca → **pede a URL, não crava**. Payload da aba idem; DriftBanner âmbar.
- **`discordam`** provado com URL netlify **efêmera** injetada no config do banco (revertida depois): `doc: railway` × `declaredUrl: netlify` → discordam, cada fonte com natureza+data. Prova o parse de domínio real (`netlify.app` → netlify) e o confronto sem coroar fonte — mesmo mecanismo do `rrb-escola`.
- Zero warns/erros no log da coleta (degradação limpa); banco restaurado ao estado real.

**Aceite runtime do PI (pendente):** olho ao vivo, idealmente com o `rrb-escola` gerenciado (não está neste banco) para o caso canônico `discordam` (config+GitHub Vercel × URL Netlify+Railway) e `concordam`/`omissa` com deployments GitHub-side reais.

## Fatia 13.5 — Handoff exportável: o instantâneo que se leva embora (SPEC-018, `aprovada-pi`) — **aceita pelo PI em 2026-07-15** (mergeado PR #52 refs #51; validação runtime OK; #51 fechada + `proplan:finalizado`)

Congela o modelo canônico (Fatia 9) + board (Fatia 5) num pacote de contexto portátil — legível por humano, parseável por agente. Cada bloco carrega valor **ou** recusa + proveniência + confiança + a conta; bloco abaixo do limiar **recusa** ("não sei — ausente/defasado"), nunca some. **Zero IA** (ADR-002), determinístico (mesmo input → bytes idênticos). Compõe e serializa — não recalcula julgamento (ADR-001).

1. `feito` — **Domínio puro** `handoff/domain/handoff.ts`: `assembleHandoff(input)` (projeção de leitura pura sobre `CanonicalModel` + board — ordem de retomada do MVP2 §6, blocos ausentes viram recusa, nunca omitidos) e `renderHandoffMarkdown(h)` (serialização determinística: blocos e campos ordenados por chave estável; cabeçalho de validade; recusa vira seção explícita; sha no rodapé de proveniência, corpo leve — decisão 4 do PI). `IssueRef` = `{ número, url, título, capturadoEm }`, **sem corpo** (ADR-017). 10 testes de fixture.
2. `feito` — **Service** `handoff/application/handoff.service.ts`: busca `CanonicalService.getCanonicalModel` (traz constraints da Fatia 10 já embutido, com `a-revalidar` propagado) + `BoardService.getBoard` (backlog = todos os cards datados; próxima ação = 1º card em `todo`, referência pura) **por interface pública** (ADR-001). Não cria linha em `LlmUsage`.
3. `feito` — **Write-back** `handoff/application/handoff-commit.service.ts`: commita `.proplan/HANDOFF.md` (nunca `docs/`; git versiona, sem tabela Prisma — decisão 2) reusando o `GithubWritebackClient` compartilhado (installation token `proplan[bot]`, ADR-015; `getFileSha`+`putFile`, retry 1x em conflito — mesmíssimo padrão de `projection.service`). Octokit **não** reintroduzido (CLAUDE.md).
4. `feito` — **Controller/módulo**: `GET /projects/:id/handoff` (estrutura + markdown), `POST /projects/:id/handoff/commit`. `HandoffModule` importa Canonical/Board/Shared/Identity; registrado no `app.module`.
5. `feito` — **Testes de arquitetura**: `HANDOFF_PATH === '.proplan/HANDOFF.md'`, nunca `docs/`, commit prefixo `proplan:` (espelha o guarda da projeção do board); `handoff-commit.service` adicionado à allowlist de `installationToken` (escrita autorizada, ADR-015).
6. `feito` — **Web**: aba **Handoff** nova (`tabs.ts`, `CURRENT_SLICE=13`) — `HandoffTab` com preview dos blocos, cabeçalho de validade, confiança + a conta clicável (`<details>` nativo, sem lib de popover), refs de issue linkadas com caveat datado, botões **Baixar HANDOFF.md** (blob local) e **Commitar em .proplan/**. Tipos + `api.handoff`/`api.commitHandoff` em `lib/api.ts`.

**5 decisões do PI incorporadas** (1: entregar já sobre a 9, blocos 10/11 recusam honestamente; 2: download+write-back arquivo único, sem tabela; 3: referência+título datado, corpo/PR/check fora; 4: sha no rodapé; 5: `assembleHandoff` domínio compartilhado que a Fatia 11 herda). 453 testes (+22), tsc web+api limpos.

**Validação runtime (OK, 2026-07-15):** handoff exportado ao vivo de `RodReis/rrb-escola` (repo gerenciado real, caso deploy `discordam`). Bloco "Projeto + objetivo" recusou honesto ("não sei — ausente/defasado · falta: documento de project", confiança 0%), demais blocos com valor + `inferencia` + confiança + a conta. **Baixar HANDOFF.md** OK (blob local). **Commitar em .proplan/** OK — commit `ccc4db2` `proplan: atualiza HANDOFF.md`, autor `rrb-proplan[bot]`, Verified, em `.proplan/HANDOFF.md` (nunca `docs/`), prefixo `proplan:` (ADR-015 + guarda de path confirmados ao vivo). **#51 aceita pelo PI em 2026-07-15** (`closed` + `proplan:finalizado`).

## Fatia 13.6 — Probe HTTP de URL declarada: o confronto com o mundo (SPEC-013.6, `aprovada-pi`) — `finalizado` (mergeado PR #43; review de segurança 0 CRITICAL/HIGH; #42 aceita pelo PI em 2026-07-15)

Estende o confronto da Fatia 13 com a **única fonte que toca a realidade**: GET HTTP à URL declarada, que confirma o que está no ar **agora** e identifica plataforma de **domínio próprio** (que o parse-de-string da 13 deixa `desconhecida`). É o **único ponto com superfície SSRF** — sob **ADR-018** (7 guardas, critério de aceite).

1. `feito` — **Domínio puro** `ingestion/domain/deploy-probe.ts`: `platformFromProbe` (fingerprint de headers → plataforma; `server` por token exato, não substring; desconhecido → `null`, nunca chuta) e `isPublicIp` (guarda 2 do ADR-018 — rejeita RFC1918, loopback, link-local `169.254`/metadata, CGNAT `100.64/10`, ULA v6 `fc00::/7`, IPv4-mapped; **fail-closed**). 26 testes.
2. `feito` — **`HttpProbe`** (infra) — as 7 guardas: só https; resolve DNS e valida IP **antes** de conectar; **DNS rebinding fechado por pin** (`https.request` core com `lookup` custom que devolve só o IP validado — stdlib do Node, **zero dep nova**, evita o problema ESM/CJS do Octokit); redirect re-validado (teto 3), sem downgrade de esquema; HEAD, corpo ≤64KB, timeout 5s; zero credencial (só UA neutro + accept). `resolvePublicIp`/`requestPinned` `protected` para o duplo de teste da cadeia de redirect.
3. `feito` — **Suíte de segurança** (`http-probe.spec.ts`, critério de aceite): http/file/gopher rejeitados; `localhost`/`169.254.169.254`/`10.0.0.1`/`127.0.0.1` → `destino_nao_publico` sem request; **redirect público→interno bloqueado no salto**; downgrade https→http bloqueado; teto de 3 redirects; caminho feliz. 12 testes.
4. `feito` — Integração ao confronto: sinal `declaredUrl` ganha `mode: string | probe | bloqueada_por_seguranca`. `SyncService.probeDeclaredUrl` (um sinal por URL): plataforma à mão → mode string sem probe; probe bloqueado (destino não-público) → `bloqueada_por_seguranca`, transparente; probe com fingerprint → mode probe; **probe falho/sem fingerprint → cai no parse de domínio** (mode string — decisão do PI: probe falho ≠ inseguro). Probe roda em todo sync (decisão do PI). 6 testes de integração.
5. `feito` — UI: `DriftBanner` mostra "confirmada ao vivo" quando `mode probe`; nota transparente `BlockedNote` para URLs não sondadas por segurança (ADR-018, nunca silenciosa), em qualquer estado.

**Decisões do PI (2026-07-14):** (1) URL morta (timeout/DNS, não bloqueio de segurança) → parse de domínio, não some o sinal; domínio próprio sem resposta → desconhecida. (2) Probe em todo sync, junto da coleta de deploy (+1 request por prodUrl).

**Decisão técnica do Code (registrada na spec):** DNS rebinding fechado por **pin de IP** com `https.request` + `lookup` custom (core Node), em vez de `undici` — evita risco ESM/CJS no build do Nest, zero dep nova. **Rate-limit (guarda 5):** teto de 10 prodUrls sondadas por sync, com WARN transparente ao truncar (achado do review de segurança). 376 testes no total, builds limpos.

**Review de segurança executado (subagent security-reviewer):** 6/7 guardas sólidas de primeira; 0 CRITICAL/HIGH. 1 MEDIUM — guarda 5 (rate-limit) faltando — **corrigido** (teto + WARN). Testados manualmente bypasses clássicos (octal/decimal/IPv6 comprimido) → todos fail-closed via `net.isIP`.

**Validação ao vivo executada pelo Code (2026-07-14):**
- **Segurança (o crítico):** probe contra `169.254.169.254` (metadata), `127.0.0.1`, `localhost` → **`destino_nao_publico`, sem request**; `http://` → `esquema_nao_https`. As guardas SSRF bloqueiam alvos internos reais.
- **Fingerprint ao vivo:** GET real a `netlify.com` → **netlify** (server: Netlify), `vercel.com` → **vercel**, `cloudflare.com` → **cloudflare**. Plataforma vinda dos headers de resposta, não de parse de domínio.
- **Integrado no sync:** prodUrl `netlify.com` efêmera declarada no config do `rrb-organize` → sinal `declaredUrl` com **`mode: probe`**, plataforma netlify confirmada ao vivo → confronto `discordam` (doc railway × probe netlify). Config revertido, banco limpo.
- **Bug corrigido no caminho:** o `lookup` custom devolvia `cb(null, ip, family)`, mas o Node chama com `opts.all: true` esperando `cb(null, [{address, family}])` — os probes vivos davam `erro_de_rede`. Corrigido para respeitar os dois formatos; +fallback IPv4-antes-de-IPv6 (host com IPv6 sem rota de saída). Era bug funcional, não de segurança (as guardas nunca falharam).

**Aceite runtime do PI (pendente):** olho ao vivo com URL de domínio próprio declarada (`gestao.epgtrindade.com.br` se `rrb-escola` for gerenciado) → probe identifica a plataforma pelos headers; confirmar a faixa `BlockedNote` na UI com uma URL que aponta para IP interno.

## Fatia 9 — Modelo canônico + proveniência + confiança determinística (SPEC-014, `aprovada-pi`) — `finalizado` (aceito pelo PI em 2026-07-15; PR #45 mergeado)

Fundação do núcleo do MVP2 (9→10→11). O **objeto consultável** que o resto do MVP2 serve: cada campo carrega **sua própria proveniência** + **confiança determinística** (ADR-012). Granularidade é o **campo, não o documento**. **100% determinística, zero IA, zero teto SPEC-009.**

1. `feito` — **Domínio puro** `canonical/domain/`: `computeConfidence` (score = cobertura × stalenessFactor, decaimento exponencial meia-vida 90d alinhado ao ADR-010; contradição/drift = slots peso zero, decisão 2 do PI; determinístico, clamp [0,1]); `belowThreshold` (recusa; limiar 0 desliga); `assembleCanonicalModel` (projeção pura entidades→campos + recusa, padrão activity-feed); `extractCanonicalFields` (fato por entidade, cobertura modulada por nível de resolução 1.0/0.8/0.6/0, proveniência `fato`/`inferencia`, data vem de `lastDocsCommitAt` — **nunca** a data de extração, senão quebraria o rebuild). 28 testes.
2. `feito` — Prisma: `CanonicalField` (reconstruível, padrão DocumentResolution; `@@unique[projectId,entity,field]`) + `Settings.canonicalRefusalThreshold` (padrão 0.4, decisão 4 do PI). Migration `fatia_9_canonical_field` aplicada.
3. `feito` — `SettingsService`: expõe `canonicalRefusalThreshold` (get/put, validação 0..1) + getter público `canonicalThresholdOf`.
4. `feito` — **Módulo `canonical` novo** (decisão do Code — não polui `insight`/IA): `CanonicalService.rebuild` (replace-all determinístico, populado no sync) + `getCanonicalModel` (projeção pura, ADR-002). Controller `GET /projects/:id/canonical` (ownership id+userId). `ResolutionService.allResolutionsOf`/`docShasOf` novos (interface pública, ADR-001 — canonical nunca lê document_resolutions/document direto).
5. `feito` — **Rebuild por evento**: `CanonicalListener` escuta `SYNC_COMPLETED` — ingestion **não conhece** canonical (ADR-001, desacoplamento ADR-004). Determinístico, fora do BullMQ e do teto SPEC-009. Tolerante a falha (não derruba o sync). `SyncService` **intacto**.
6. `feito` — 410 testes no total (+34), `tsc` + `nest build` + `vite build` limpos.

### Aceite runtime executado pelo Code (2026-07-15) — dogfooding no `rrb-organize`

Os 6 critérios da SPEC-014 provados ao vivo (migration aplicada, sync real):
- **Por campo**: `GET /canonical` → 6 entidades, cada uma com `presence`/proveniência `fato`/confiança + a **conta** (`math`). Nunca score uniforme de documento.
- **Determinístico**: 2 syncs seguidos → hash das confianças **idêntico** (`028a54f2…`).
- **Auditável**: o payload traz `{stalenessDays, cobertura, contradicao, drift}` que soma no número.
- **Recusa**: limiar 0.9 → entidades por alias (conf 0.8) recusam "ausente ou defasado"; por convenção (conf 1.0) passam. Limiar 0.4 restaurado.
- **Reconstruível**: apagar as 6 linhas + re-sync → hash **idêntico** (`b154a927…`). Cache derivado, fonte é o repo (ADR-014).
- **Zero IA**: 3× `GET /canonical` → `llm_usage` inalterado (28 linhas). Sem inferência no render (ADR-002).

**Aceite runtime do PI (pendente):** olho na tela (a fatia entrega só a API `GET /canonical`; a UI da Visão Geral consumindo o modelo é fatia de refino/parte da 11). Idealmente ver a recusa e a conta clicável num repo com entidades ausentes (`landpage` só tem README → maioria nível 4).

## Fatia 10 — `docs/CONTEXT.md` + captura de asserção humana (SPEC-015, `aprovada-pi`) — `feito` (aceito pelo PI em 2026-07-15; PRs #47 #48 #49)

O **fosso** (ADR-013): cofre versionado da asserção humana ("o que não mexer"), escrita de volta no repo como conteúdo humano. Preenche o slot `asserção` da Fatia 9. **Zero IA.** As 3 decisões do PI incorporadas (cadência conservadora; validade no sync com cap; modelo próprio `Assertion`).

1. `feito` — **Domínio puro** `context/domain/context-doc.ts`: `parseContextMd` (tolera edição humana — campo ausente degrada com warning, nunca quebra o sync; frontmatter v2), `serializeContextMd` (round-trip **provado por teste**: parse∘serialize = identidade), `revalidationStatus` (commit em path citado depois da data → `a-revalidar`; mesmo dia não rebaixa; sem data → mantém). 12 testes.
2. `feito` — Prisma: `model Assertion` (índice reconstruível de CONTEXT.md — apagar + re-sync reconstrói; `assertedAt` como **string YYYY-MM-DD** igual ao arquivo, sem drift de TZ) + `OperationKind.assertion`. Migration `fatia_10_assertions` aplicada.
3. `feito` — **Módulo `context` novo**: `ContextService.capture` (autor+data+sha preenchidos pelo ProPlan; head SHA via `GithubGitClient.getHeadSha` novo, user token; write-back `docs/CONTEXT.md` com installation token + baseSha retry + re-sync SHA-aware — shape idêntico ao `putMapping`), `revalidate` (renova data+sha, volta `vigente`; asserção removida à mão → 400, o repo é a fonte), `rebuild` (ingestão no sync: parse do Document + validade datada via Commits API `?path=&per_page=1`, só re-checa `vigente`, cap 30 checks/sync, falha de rede tolerada → mantém status do arquivo), `assertionsOf` (interface pública p/ canonical, ADR-001). Controller `GET/POST /projects/:id/assertions` + `POST :aid/revalidate` (202 + operationId, SPEC-010). Allowlist do teste de arquitetura ADR-015 atualizada com justificativa.
4. `feito` — **Projeção `constraints`** (canonical): `assertionsToCanonicalFields` puro (`entity=constraints`, `provenanceClass=assercao`, `provenanceRef={author,date,sha,paths,status}`; confiança determinística: `vigente` 1.0 · `a-revalidar` 0.5 — a marca também move o número). `CanonicalListener` orquestra a ordem `context.rebuild` → `canonical.rebuild` (dois listeners independentes correriam; falha no context não derruba as 6 entidades).
5. `feito` — **UI**: aba **Contexto** nova no workspace (lista com badge `a revalidar` âmbar **sempre visível**, captura com statement+paths+detalhe, botão "Ainda vale — confirmar" nas rebaixadas, `OperationSteps` com polling SPEC-010, recarrega no sync). `CURRENT_SLICE` → 10.
6. `feito` — 434 testes no total (+22), `tsc` + `nest build` + `vite build` limpos; boot da API com `ContextModule` inicializado e rotas mapeadas.

**Aceite runtime do PI (pendente):** capturar uma asserção num repo real → conferir o commit do `proplan[bot]` em `docs/CONTEXT.md`, o card no painel de Atividade, a ingestão no re-sync (badge `vigente`), e depois commitar num path citado + sync → badge `a revalidar` + confirmar. Commit de CONTEXT.md conta como frescor (ADR-010) por construção — vai para `docs/`.

## Correção — botão morto na Visão Geral (`BootstrapDialog`) — `feito` (aceito pelo PI em 2026-07-15)

Bug documentado (achado no aceite da 7.6, comportamento decidido pelo PI em 2026-07-15: **remover**). O CTA "Gerar proposta de STATUS.md" na aba Visão Geral (`pages/workspace/BootstrapDialog.tsx`) chamava `api.proposeStatus`/`api.commitStatus` — **ambos** os endpoints (`POST /bootstrap/status` + `/commit`) foram removidos na SPEC-005 (bootstrap de STATUS.md superado pelas Issues, ADR-011). Pior que "quebra ao commitar": `proposeStatus` estourava **404 já ao abrir** o dialog. Ressuscitar o endpoint reabriria escritor-duplo em `docs/` (mascara ADR-010) — a proposta de roadmap já existe via bootstrap de cards da Fatia 5.

1. `feito` — Removida a cadeia morta inteira (não só o botão): `pages/workspace/BootstrapDialog.tsx` deletado; `OverviewTab` perdeu o CTA `!hasStatusDoc`, o state `bootstrapOpen` e as props `hasStatusDoc`/`onSynced` (só serviam o dialog); `Workspace` perdeu o state `hasStatusDoc` + o `refreshDocsList`/`useEffect` que só o alimentavam; `api.ts` perdeu `proposeStatus`+`commitStatus`. `tsc` + `vite build` limpos. Sem teste (remoção pura de UI, sem lógica). **Validado ao vivo** (`agency-agents-app`): aba Visão Geral sem o CTA morto, resto intacto.

## Fatia 14 — Portfólio da fábrica + Radar de risco (SPEC-019, `aprovada-pi`) — `finalizado` (#6 aceita pelo PI em 2026-07-15)

**A tela inicial diária.** View cross-projeto sobre os repos gerenciados, cada linha com os 4 sinais entregues (staleness, cobertura, deploy, CI) **crus e datados**, ordenados pelo radar. Molde direto da Fatia 13 (coleta no sync, cache no `Project`, projeção pura). **Zero IA** (ADR-002), determinístico, **nenhum score de saúde composto** (ADR-012). Slots peso-zero de 10/11 declarados, não calculados (decisão 3 do PI).

1. `feito` — Prisma: `Project` ganha `ciStatus`/`ciConclusionUrl`/`ciObservedAt` (cache derivado, padrão do `deployVerdict`). Migration `fatia_14_ci_status`. **Nenhuma tabela nova** — portfólio e radar são projeção sobre `Project` + `CanonicalField`.
2. `feito` — Coleta de CI: `GithubGitClient.listLatestWorkflowRun` (Actions API `/actions/runs?per_page=1`, gêmeo do `listDeploymentUrls` — via `fetchGithubOptional`, degrada em `denied` sem `Actions: read`). Domínio puro `ingestion/domain/ci-status.ts`: `ciStatusOf` (sem Actions → `sem-ci`, sem run → `sem-run`, em andamento → `em-andamento`, senão a conclusion) + `ciIsRed` (`failure`/`timed_out`/`cancelled`; ausência de CI = neutro — decisão 2 do PI). `SyncService.updateCiStatus` nos **dois** caminhos (noop + success), tolerante a falha (regra do `updateCommitMeta`).
3. `feito` — Domínio puro `portfolio/domain/portfolio.ts`: `assemblePortfolio` (projeção, conta os vermelhos) + `rankByRisk` (contagem de sinais vermelhos desc, desempate por staleness, então nome — determinístico). **Pesos por sinal**: os 4 entregues pesam 1; os slots de 10/11 pesam **0** — extensível sem reescrita (só subir o peso quando a fatia entregar).
4. `feito` — Módulo `portfolio` novo: `PortfolioService.getPortfolio` (lê `Project` + freshness/threshold via Settings + cobertura via `CanonicalService.coverageRedByProject` — interface pública, ADR-001; canonical nunca lido direto). `GET /portfolio` (só repos gerenciados do usuário; **sem IA** — não cria `LlmUsage`). Cobertura agregada numa query só sobre os N projetos.
5. `feito` — Web: nova entrada **top-level "Portfólio"** no rail (decisão 4 do PI — separada do catálogo, não é a home ainda). `PortfolioView`: linhas densas 6–20, chips de sinal **datados e clicáveis** (staleness/cobertura → Visão Geral · deploy/CI → Deploy), marcador com nº de sinais em alerta. Deep-link via `initialTab` novo no `Workspace`.
6. `feito` — `Actions: read` **já concedido** na instalação `RodReis` (Fatia 4.5 aceite: installation token emitido com `actions:read`); ADR-015 já listava a permissão. Nada a reconsentir.
7. `feito` — 473 testes no total (+15: portfolio 10, ci-status 5), `tsc` API + `nest build` + `tsc`/`vite build` web limpos; API sobe com `GET /portfolio` mapeada.

**Aceite runtime do PI (pendente):** olho ao vivo com os `rrb-*` reais (`rrb-escola` deploy discordante, `rrb-organize` só-github-side) — o portfólio já nasce com casos ricos. Roteiro: linha por repo gerenciado com os 4 sinais datados; ordenação por nº de vermelhos (desempate staleness); chip de CI datado linkando o GitHub Actions; repo sem Actions → `sem CI` neutro (não vermelho); clicar chip abre a aba certa. **Provar que o radar não inventa**: sinal de 10/11 não aparece (peso zero); 2× o mesmo estado → mesma ordem.

## Fatia 11 — MCP Server do ProPlan: contrato de evidência + as 6 tools (SPEC-016, `aprovada-pi`) — `finalizado` (#3 aceita pelo PI em 2026-07-16)

**O diferencial — fecha o núcleo do MVP2 (9→10→11).** O consumidor primário não é o humano, é o agente: o MCP expõe o julgamento (canônico da 9, asserção da 10, board da 5, resolver/handoff da 6/13.5) sob um **contrato de evidência sem exceção** — toda resposta carrega evidência datada + confiança; **sem evidência, a tool recusa** em vez de chutar. **Adaptador fino** (ADR-001): consome interfaces públicas, **não reimplementa julgamento, zero modelo Prisma novo, zero IA** (ADR-002). Metade da spec é o que NÃO faz: **nenhum pass-through do GitHub** (ADR-017) — referencia issue por número+URL, nunca reproduz o corpo.

1. `feito` — **Domínio puro** `mcp/domain/` (TDD, 18 testes): `evidence-contract.ts` (`enforceEvidenceContract` — o invariante central: evidência vazia ⇒ `refusal`, nunca `answer`); `field-evidence.ts` (`fieldToEvidence` — ponte canônico→evidência, **propaga a marca `a-revalidar` sempre**, ADR-013 — é onde o critério §2 ancora); `next-task.ts` (`nextTask` — julgamento puro: exclui card por constraint/decisão-ausente, referência nº+URL, abaixo do limiar → recusa); `blockers.ts` (`findBlockers` — constraint a-revalidar + campo estrutural recusado, reprojeção pura).
2. `feito` — **`McpToolsService`** (application): as 6 tools compondo `CanonicalService`/`BoardService`/`HandoffService`/`ContextService`/`SettingsService` por interface pública. Cada saída passa por `enforceEvidenceContract`. `get_project_state`/`explain_project`/`get_handoff_context` projetam os blocos do handoff (herança decisão 5 do PI); `get_constraints` lê asserções (marca sempre presente); `get_next_task` combina board+constraints+confiança (limiar unificado da Fatia 9, decisão 3); `find_blockers` deriva. Sem auth no MVP (decisão 1): `resolveProject` acha o dono por owner/repo — a porteira por token é Fatia 8.
3. `feito` — **Resources** `proplan://repo/{owner}/{repo}/{view}` (decisão 4, obrigatórios): 7 views (`overview`/`state`/`architecture`/`risks`/`tests`/`deploy`/`constraints`) — projeções read-only sobre o **mesmo** material, **sem `kanban`** (ADR-017). `entityView` filtra o handoff por entidade.
4. `feito` — **Entry ESM isolado** `apps/mcp` (workspace `type: module` novo): `@modelcontextprotocol/sdk` é ESM-only — reintroduzi-lo no build CJS do Nest repetiria o conflito do Octokit (CLAUDE.md). O entry consome os services **in-process** via `createMcpContext` (`NestFactory.createApplicationContext` — sem HTTP, sem porta, sem duplicar acesso a banco, §Empacotamento). **Barrel `apps/api/src/mcp-bootstrap.ts`** é a fronteira que garante **instância única de `@nestjs/*`** (importar `@nestjs/core` no pacote `apps/mcp` carregava uma 2ª cópia e o DI do `EventEmitterModule` quebrava). `declaration: true` no tsconfig da api para o entry consumir os tipos reais.
5. `feito` — **Testes de aceite** (`mcp-tools.service.spec.ts` + `no-passthrough.arch.spec.ts`): contrato invariante por tool (sem evidência → refusal); `a-revalidar` sempre presente em `get_constraints`; `get_next_task` referencia nº+URL sem corpo; abaixo do limiar → refusal; **arch test no-pass-through** (não importa `infrastructure/` de outro módulo, não usa `GithubIssuesClient`, não lê `prisma.issue` — único acesso a prisma é `project.findFirst`). 28 testes no mcp; **501 no total** (+28), tsc api + builds api/mcp/web limpos.

**Decisões do PI (2026-07-14) incorporadas** — 1: sem auth no MVP (MCP local, usuário único; auth → Fatia 8); 2: as 6 tools já sob o mesmo contrato; 3: limiar unificado com a Fatia 9 (`Settings`, padrão 0.4); 4: tools + resources juntos, obrigatórios.

**Decisão técnica do Code (registrada):** empacotamento **in-process + entry ESM isolado** (aprovado pelo PI). O barrel `mcp-bootstrap.ts` resolve o conflito de dupla-instância de `@nestjs/core` entre workspaces pnpm — a raiz do erro `EventSubscribersLoader can't resolve ModuleRef`.

**Verificado ao vivo (Code):** servidor sobe stdio (`createApplicationContext` sem Redis travar); **JSON-RPC real** (`initialize` → `tools/list`) devolve as 6 tools: `get_project_state, get_next_task, get_handoff_context, get_constraints, explain_project, find_blockers`.

### Validação ao vivo executada pelo Code (2026-07-16) — JSON-RPC stdio contra o banco local, repos reais

**As 6 tools + resources exercidas contra dados reais** (o MCP roda com cwd `apps/api` para o ConfigModule achar o `.env` — a API lê `apps/api/.env`, não o da raiz):

| tool | repo | resultado |
|---|---|---|
| `get_project_state` | `rrb-proplan` | **answer** com blocos reais + **evidência datada com sha** (`docs/ARCHITECTURE.md` sha `e43e3ca`, `2026-07-16`); confiança 1 |
| `get_next_task` | `rrb-proplan` (25 issues) | **recomenda #2 por número+URL**, **sem reproduzir o corpo** (ADR-017) |
| `get_handoff_context` | `rrb-adv` | docs mapeados (`.proplan/config.yml`, `docs/DECISÕES.md`, …), cada um `fato` com path |
| `get_constraints` | `rrb-escola` (1 asserção) | asserção real com **`status: vigente` propagado** + autor/data/sha (ADR-013) |
| `get_constraints` | `construtor-erp` (canonical=0) | **refusal honesto** — evidência vazia, com o que falta. Não chuta |
| `explain_project` | `rrb-escola` | mistura **fato × inferência × asserção** corretamente classificada; a restrição aparece com a marca |
| `find_blockers` | `rrb-escola` | **refusal honesto** — asserção é `vigente` (não `a-revalidar`) e nenhum campo estrutural recusado ⇒ sem blocker |
| resource | `proplan://repo/RodReis/rrb-escola/constraints` | template listado; `resources/read` devolve a asserção com `status: vigente` |

**Bug encontrado e corrigido na validação** (PR #64, `refs #3`): `get_next_task` **recusava sempre** — `projectPresenceConfidence` buscava o campo canônico `project.presence`, que **não existe** (o canônico produz `architecture`/`decisions`/`design`/`testing`/`deploy`/`skills`, nunca uma entidade `project`) ⇒ confiança do estado sempre 0 ⇒ `belowThreshold` ⇒ refusal. Os testes unitários passavam porque os **mocks fabricavam** uma entidade `project` que o canônico real não gera — só o confronto com dados reais expôs (a tese do próprio produto: o teste que não toca a realidade mente). Corrigido para **confiança agregada** (maior entre os campos presentes); modelo vazio → 0 (refusal preservado).

**Nota de polimento (não bloqueia):** `get_project_state` emite 2 itens de evidência `{"type":"fato"}` sem path/sha — vêm dos blocos `backlog`/`próxima ação`, cujo `provenanceRef` é `{source:...}` e não tem path. Cosmético; o contrato segue satisfeito (há evidência real suficiente).

**Aceite runtime do PI (pendente):** conectar o MCP no Claude Code (`node apps/mcp/dist/main.js`, stdio) apontado a um `rrb-*` real e exercer as 6 tools + resources ao vivo: `get_constraints` traz a asserção da Fatia 10 com `a-revalidar` impresso; `get_next_task` recomenda nº+URL sem reproduzir corpo, excluindo o que constraint/decisão trava; repo sem asserção → `find_blockers`/`get_constraints` **recusam honestamente** (evidência vazia); revisão contra o ADR-017 (nenhum pass-through de fato do GitHub).

## Infra — Relatório de testes gerado pelo CI (ADR-019 / TESTING.md) — `feito`

**Processo/infra, não fatia de produto** (não é SPEC-0XX). Implementa o ADR-019: evidência de teste gerada por máquina e verificada, nunca narrada. Escopo confirmado com o PI: **encanamento da camada Tela com smoke** (não suíte grande — YAGNI), **pnpm** canônico, **workflow no GitHub Actions**.

1. `feito` — `apps/api/jest.config.js` com dois **projects**: `regras` (`*.spec.ts`, unidade) e `banco` (`*.int-spec.ts` + `test/*.e2e-spec.ts`, hoje vazio — harness pronto). Categoria determinística por sufixo (ADR-019 §3), o gerador não adivinha.
2. `feito` — **Camada Tela do zero**: Vitest + Testing Library (`ConfirmDialog.test.tsx`, 3 testes de comportamento real) + Playwright (`e2e/login.spec.ts`, 1 smoke que carrega o app no browser). Vitest fixado em `^1.6` (compat com Vite 5; vitest 4 exige Vite ≥6). Testes fora do build de produção (`tsconfig` exclude).
3. `feito` — `scripts/gen-test-report.ts` (repo-agnóstico, lê `test-report.config.json`): números vêm do `--json` dos runners + `coverage-summary.json`; monta `reports/TESTS.md` (Estado atual + Histórico append-only, 3 linhas Banco/Regras/Tela por entrega); modo `--check` compara **só os números** (metadados Data/Issue/PR variam por PR — decisão do PI) → exit 1 se forjados. `scripts/test-report.mjs` orquestra os runners.
4. `feito` — `.github/workflows/ci.yml`: roda em todo PR (Postgres de teste pronto para o `banco`), publica a tabela no job summary + comentário fixo do PR, e a **guarda anti-drift** (`test:report:check`) barra o merge se o relatório commitado divergir de uma execução limpa. Cobertura report-only (não barra merge).
5. `feito` — `reports/TESTS.md` fora de `docs/` (não mascara ADR-010) e fora de `.proplan/`; `.raw`/coverage/test-results no `.gitignore`. `package-lock.json` órfão removido (pnpm é o canônico), `packageManager` fixado.

**Verificado ao vivo**: pipeline `pnpm test:report` end-to-end (Regras 473 / Banco 0 / Tela 4); guarda anti-drift provada — número forjado à mão → `--check` exit 1; `--check` passa com metadados de PR diferentes (não falha espúrio em PR futuro). Builds API+web limpos.

**Nota**: o workflow do GitHub Actions só será exercido quando o repo receber um PR pós-merge desta fatia — validação real do CI (summary + sticky comment) é o aceite runtime pendente do PI.

## Fatia 15 — Shell workspace + temas Carbono/Claro (SPEC-020, `aprovada-pi`) — `finalizado` (mergeado PR #67 squash `552a1a8`, `refs #56`; **aceito pelo PI em 2026-07-16**)

**Padrão workspace + re-tokenização.** Substitui o shell antigo (rail + lista permanente de projetos + 12 abas horizontais) por sidebar 270px com combo e grupos verticais, e re-tokeniza o painel inteiro no design system Carbono/Claro. A fatia toca todas as abas — risco transversal declarado na spec; mitigação: tokens primeiro (apelidos dos nomes antigos), shell depois.

1. `feito` — **Tokens**: `src/tokens.css` (fonte única, §4 inteiro nos 2 temas) + `src/stageTint.ts` (tintas do Kanban e prioridade, §4.3 — cor que depende de *dado*, não de estado de CSS). `src/theme.tsx`: `ThemeProvider` (`data-theme` no `<html>` + localStorage), `useToken` para as libs que recebem cor por **prop** e não por CSS (react-flow). Ponte `@theme` → custom properties com **apelidos dos nomes antigos** (`bg`/`surface`/`border`/`text`/`brand`) — as 12 abas migraram sem tocar em classe. Fontes IBM Plex **self-hosted** (`@fontsource/*`, 33 woff2 no bundle; zero CDN — ambiente 100% local). Animações §9 + `prefers-reduced-motion` global.
2. `feito` — **Gaveta de Atividade tokenizada** (decisão do PI em 2026-07-16): era "terminal de log" em carbono fixo — quebra deliberada do shell claro de então. Com o shell inteiro em Carbono, a metáfora perdeu o contraste que a justificava e virava ilha escura no tema Claro. Reapontar os 10 apelidos locais (`--term-…`/`--g-…`) aos tokens tokenizou as ~94 regras sem reescrever cada uso; pontinhos macOS e o título `proplan ~` saíram junto (cor sem significado, contra §1).
3. `feito` — **Grafo re-projetado** (§6): nós deixam de ser blocos sólidos coloridos e viram `--surface` + borda + faixa de tipo 3px (o bloco colorido não dizia nada além de "sou um doc"). Fundo pontilhado gap 48; `Background`/`MiniMap` via `useToken` (recebem cor por prop). Arestas inferidas seguem tracejadas (ADR-002).
4. `feito` — **Rotas** (`react-router-dom`): `/` (catálogo) · `/p/:projectId/:tab` · `/p/:id` → aba padrão · aba desconhecida → redirect. `WorkspaceRoute` resolve a URL e carrega os projetos **uma vez** para a rota e o combo. `ProjectNotFound`: 404 amigável, **sem cor de erro** (desgerenciar não é falha). `Home.tsx` (403 linhas) morreu: virou `Catalog.tsx` + rotas; `openProjectId`/`activeTab` em `useState` morreram com ele. `lib/lastAccess.ts` alimenta a ordem do combo (localStorage, entrada não confiável validada na leitura).
5. `feito` — **Shell**: `shell/Sidebar.tsx` (combo + grupos + rodapé de usuário, onde Configurações migrou do rail), `shell/WorkspaceCombo.tsx` (dropdown ordenado por último acesso, ponto de estado + no máx. 1 badge), `shell/Topbar.tsx` (breadcrumb + toggle de tema + pílula + Mapeamento/Sincronizar — **sem busca global**, decisão do PI), `shell/ActivityPill.tsx` (narra o passo ativo de `activity/running` — **nenhum backend novo**, como a spec previu), `shell/navGroups.ts` (mapa 1:1 de `tabs.ts`; aba órfã cai num grupo final para nunca sumir), `shell/projectAlert.ts` (precedência dos alertas, **4 testes**).

**Bugs encontrados rodando** (nenhum pegável por typecheck/build — o build passava com os três):
- **`*/` dentro de comentário CSS** (`--term-*/--g-*` escrito por mim) fechava o bloco no meio e derrubava o dev server inteiro (`[postcss] Unclosed bracket`). `vite build` passava; só `vite dev` quebrava.
- **`bg-brand text-white` em 13 arquivos** — o par da paleta antiga (brand escuro + branco). Com `brand` = `--accent` (prata), virou branco sobre prata: **todo botão primário do app ilegível, nos 2 temas**. Corrigidos para o par `btnbg`/`btnfg` (§6). **O grep de `#hex` do critério de aceite não pega isto** — o defeito estava em nome de classe, não em cor literal. É o risco transversal que a spec previu, materializado.
- **Login com `bg-text text-white`**: `--text` era quase-preto no tema claro antigo e hoje é claro ⇒ branco sobre branco.

**Verificado ao vivo** (browser real, não só compilador): `data-theme` no `<html>`, tokens computados corretos nos 2 temas (`--bg` `#0c0d0f` ↔ `#f2f2f0`), IBM Plex Sans ativa, tema **sobrevive ao F5** (localStorage), login re-pintado pelos tokens **sem tocar no `Login.tsx`** (prova do re-skin automático do item 8), botão primário com contraste correto nos 2 temas.

**Pendente nesta fatia**: faixa de aba (item 7 da spec), inspeção visual das 12 abas × 2 temas, Kanban re-tokenizado, verificação do shell autenticado (sidebar/combo/F5 em `/p/:id/kanban`).

## Fatia 16 — Telas Login e Catálogo (SPEC-021, `aprovada-pi`) — `finalizado` (mergeado no mesmo PR #67, `refs #57`; **aceito pelo PI em 2026-07-16**)

**Completa a migração visual da 15.** O catálogo deixa de dividir a tela com a lista de projetos e vira a porta de entrada; o login ganha o hero de valor. Entregue **no mesmo PR da 15** (decisão do PI em 2026-07-16 — as fatias são contíguas: a 16 redesenha as duas telas que a 15 deixa apenas re-skinadas pelos tokens).

1. `feito` — **Login 2 colunas** (§1): hero com imagem IA por tema (`hero-grafo*`), Ken Burns, gradiente de leitura, cartões de vidro flutuantes (`Docs × código: sem divergência` · `Aceite: sempre humano`) e o carrossel de 4 mensagens de valor. Coluna de ação: logo, `Entrar com GitHub` (48px), nota de somente-leitura, `TRÊS PRINCÍPIOS`. **Mesmo fluxo OAuth** — muda só a apresentação. O toggle de tema funciona pré-autenticação (localStorage, padrão Carbono).
2. `feito` — **Catálogo página cheia** (§2): header próprio (logo + `CATÁLOGO` + tema + usuário/sair), banner com imagem IA por tema e gradiente lateral, grupos por instalação (conta + chip `PESSOAL`/`ORGANIZAÇÃO` + contagem), **linhas densas** de repo (ponto de estado, nome, chip `privado`, descrição, último push), `Abrir workspace` quando gerenciado, e desgerenciar **com diálogo de confirmação** deixando explícito que só o índice local sai — o repo não é tocado. Estado vazio preservado, re-estilizado. Reusa o `ConfirmDialog` existente; **sem `danger`**: desgerenciar não destrói nada, e vermelho comunicaria destruição (§1).

**Decisões do PI (2026-07-16)** — três conflitos entre protótipo e spec/DESIGN.md, resolvidos:
- **Carrossel do Login**: fiel ao protótipo (auto-rotate 4.5s). É **loop parado**, contra a regra de ouro do §9 ⇒ **exceção registrada no DESIGN.md §9** com escopo estrito (só o Login; para sob `prefers-reduced-motion`; **para de vez** ao clicar num dot — mexer no controle é dizer "eu dirijo agora").
- **Repos como linhas densas** (protótipo), não cards (letra da spec): cabem 12 repos sem rolar.
- **Rodapé do login** mantido com nome + e-mail, como no protótipo.

**Verificado ao vivo** (nos 2 temas, com screenshot): login novo renderiza com hero, cartões de vidro, carrossel e princípios; cada tema carrega **sua** imagem; `Entrar com GitHub` legível nos dois.

**Bug encontrado rodando**: cartões de vidro do hero ilegíveis no tema Claro — `color-mix(--pop 72%)` some sobre a `hero-grafo-claro`, que é quase branca. Corrigido para 92% no claro (o vidro precisa de mais opacidade quando a imagem por baixo é clara).

**Pendente**: o catálogo novo está atrás do OAuth — não verifiquei ao vivo (mesmo limite da 15). Vai no aceite runtime do PI.

## Visão Geral no padrão do protótipo — `sem-spec` (escopo direto do PI, 2026-07-16) — `feito` (mergeado no PR #67)

**Não é fatia da SPEC-020/021** — aquelas dizem, na letra, *"qualquer mudança de comportamento nas abas: só pele"*. Isto muda a aba. O PI decidiu ao vivo (comparando o app com o protótipo lado a lado) redesenhar a Visão Geral **nesta leva**, respondendo as decisões na hora em vez de esperar spec do Cowork. Entra no mesmo PR #67.

1. `feito` — `OverviewSignals`: os 4 sinais datados do topo (`DOCS · CÓDIGO` · `AGUARDANDO SEU ACEITE` · `ÚLTIMA SINCRONIZAÇÃO` · `DRIFT DE DEPLOY`), fiéis ao protótipo. **Sem backend novo**: frescor de `api.freshness`, sync e drift do próprio `Project`, aceite de `api.board` (coluna `done`). **7 testes**, incluindo o invariante que importa: sem dado o cartão diz `—` e nunca finge zero (ADR-014) — "0 entregas" quando o board não carregou seria mentir sobre o aceite, que é a tese do produto.
2. `feito` — `OverviewTab` reescrito: título + `Abrir no GitHub ↗`, faixa do chip de IA com a explicação de precedência (humano > máquina), `O que é` / `Onde parou` lado a lado com ícones, `O que falta` numerado em 2 colunas. A `FreshnessBar` antiga saiu: o sinal `DOCS · CÓDIGO` diz a mesma coisa, e repetir seria ruído.

**Decisões do PI (2026-07-16)**:
- **4 cartões fiéis ao protótipo**, não a faixa densa que ele havia escolhido antes ⇒ **exceção ao "sem hero-metric" registrada no `PRODUCT.md`**, com escopo estrito (só esta faixa; cada sinal é fato datado, nenhum é score composto — ADR-012).
- **Puxar o board** só para contar a fila de aceite: uma request a mais por abertura da aba, paga porque o aceite pendente é o sinal que carrega a tese do produto.

**Pendente**: não verifiquei ao vivo — a aba está atrás do OAuth e o DPAPI do Windows bloqueia importar os cookies do Chrome para o browser headless. Vai no aceite runtime do PI.

3. `feito` — **Documentos no padrão do protótipo**: coluna com header `DOCUMENTOS` + contador de arquivos; leitor com header próprio (nome + caminho · quando + chip de estado + link GitHub). O chip diz **de onde o documento vem** (`convenção` = canônico do CONVENTION.md · `sincronizado` = veio do repo), nunca juízo sobre o conteúdo. O separador redimensionável que já existia **fica** — é funcionalidade real que o protótipo não tem.
4. `feito` — **Bug: YAML renderizado como Markdown** (achado na screenshot do PI). O `ci.yml` virava um muro de headings gigantes porque todo comentário YAML começa com `#`. Causa: `DocKind` responde *duas* perguntas — o que o sync baixa **e** como o leitor renderiza; `yml` é marcado `markdown` para ser ingerido (alimenta a aba Testes), e o leitor obedecia. **Corrigido no leitor** (`renderAs.ts`, decide pela extensão; 7 testes): markdown só quando se sabe que é markdown, nunca por omissão — arquivo sem extensão (LICENSE, Dockerfile) também cai em texto puro. A **causa** (campo com dupla responsabilidade) ficou no `STATUS.md`: separar `renderAs` de `kind` toca ingestão e schema ⇒ fatia própria.
5. `feito` — **Topbar apertada** (achado na mesma screenshot): o botão `Sincronizar` cortava. Faltava `min-w-0` no breadcrumb — sem ele o flex não deixa nada encolher. Ordem de aperto decidida pelo PI: breadcrumb trunca primeiro (a sidebar já diz onde você está), depois a pílula perde o texto e fica só o ponto de estado (com `title` para o hover). **Botão de ação nunca corta**: ação vence contexto.
6. `feito` — **Kanban no padrão do protótipo**. O achado que motivou: **o `stageTint.ts` que criei na Fatia 15 tinha zero consumidores** — escrevi as tintas do §4.3 e nunca liguei no card, que ficou `bg-surface` liso. Efeito visível: Backlog, A Fazer e Em Andamento com cards idênticos, sem o sinal de etapa que o design system especifica. Agora: tinta da etapa no **card** (não na coluna — assim ele segue legível no `DragOverlay`, longe da origem), header da coluna com ponto na cor da etapa + rótulo Mono + contador em pílula tintada, coluna neutra `--colbg`, drop target com borda de acento, coluna vazia com a caixa tracejada do §6, trilho do Descartado re-tokenizado. `Stage` renomeado de `finalizado` para `finalized`: espelha `BoardColumn` da API — um mapa de tradução a menos é um bug a menos.

**Decisão do PI (2026-07-16) — conflito design system × ferramenta**: a skill `impeccable` bane *side-stripe border* (`border-left` > 1px como acento) e o `DESIGN.md` §4.3 **manda** exatamente isso para a prioridade do card. **O DESIGN.md vence**: a cor é semântica, o protótipo a tem, e o design system deste produto é decisão do PI — a skill é conselho genérico.

7. `feito` — **Gaveta de Atividade** (4 defeitos reportados pelo PI ao vivo, cada um com causa própria):
   - **Cobria os botões da topbar**: era `position: absolute` dentro do container que **contém** a topbar. Passou a `fixed` a partir de `top: 60px` (§2) — a gaveta é overlay do conteúdo, nunca das ações. É o que o protótipo faz.
   - **Entrada sem animação**: a classe `.anim-drawerIn` existia no CSS desde a Fatia 15 e **nunca teve consumidor** — o mesmo tipo de gap do `stageTint`. A animação passou para o próprio `.act-panel`, junto com a saída; a classe órfã foi removida.
   - **Sem "volta"**: não havia animação de saída — o React desmontava no mesmo quadro. `useExitAnimation` segura o nó até o `drawerOut` terminar (240 ms, casado com o CSS). **5 testes**, incluindo o caso que quebra fácil: reabrir no meio da saída não pode deixar o timer velho derrubar o nó. Sob `prefers-reduced-motion` a saída é imediata (§11) — quem pediu para não ver movimento não pode ficar esperando por um.
   - **Estilo "de terminal"**: os apelidos `--term-*` sobreviveram à tokenização e o nome mentia sobre o que a gaveta é hoje. Renomeados para `--drw-*` — nome honesto evita o próximo leitor procurar um console que não existe mais.

**Bug de acessibilidade corrigido junto**: **Esc não fechava a gaveta**, contra o §11 (*"fechar modal/gaveta com Esc sempre"*).

8. `feito` — **Grafo legível** (reportado pelo PI ao vivo: *"fundo escuro com cards escuros não está legal, e o branco com fundo branco também não"*). Medido: o nó dava **1.06:1** contra o canvas no Carbono e **1.12:1** no Claro — praticamente a mesma cor; as arestas, **1.39:1**. **Regressão minha da Fatia 15**: troquei os nós de blocos sólidos para `--surface` + borda seguindo a letra do §6, e o §6 não previa canvas. Agora: nó `--card` + **borda `--muted`** (7.17:1 / 5.46:1) + sombra (§5 permite em flutuante); arestas em `--dim` (3.87:1 / 2.97:1 — subordinadas ao nó de propósito); grade em `--border3`; MiniMap com nós em `--muted`. Nó-fantasma segue sem preenchimento **e agora sem sombra**: ele não é documento que existe, e sombra sugeriria corpo (ADR-014). `DESIGN.md` §6 reescrito com as medições.

**O achado maior que o Grafo**: **nenhum token de superfície serve para objeto em canvas.** A escala inteira (`--surface`/`--surface2`/`--card`/`--colbg`) fica entre **1.04 e 1.79:1** contra `--bg` — ela foi desenhada para painéis *empilhados*, onde a borda separa e o preenchimento só diferencia camada. Num canvas não há empilhamento: quem separa é a **borda**, e ela precisa vir da escala de *texto* (`--muted`/`--dim`), não da de superfície. Vale para qualquer canvas futuro (timeline, matriz de prontidão da Fatia 14). Registrado aqui porque o §6 não tem onde dizer isso.

**Bug de contraste corrigido junto**: o placeholder do input de criar card usava `--dimmer` (2.85:1 no Carbono, 2.52:1 no Claro) — placeholder é texto que se lê e exige os mesmos 4.5:1 do corpo. Passou para `--muted` (6.6:1 / 5.65:1). A linha "placeholder" do `--dimmer` na tabela do §4.1 foi corrigida: o token não serve para isso.

### Dívida registrada — peso das imagens de IA (decisão do PI em 2026-07-16: **fatia futura**)

Os assets de `docs/design/assets/` são **2528×1696 PNG, ~4,5 MB cada**. A faixa de aba renderiza num container de ~1000×168 px — ~2,5× maior que o necessário, em PNG onde JPEG serviria. Só a `workspace-vista*` (2 temas) pesa **9 MB** no bundle; com a SPEC-021 (`hero-grafo*` + `catalogo-banner*`) chega a ~18 MB. Invisível em ambiente 100% local (CLAUDE.md), doloroso fora dele.

**Não recomprimir sem o PI**: a SPEC-021 declara os assets **finais e aprovados** ("regenerar depois é troca de arquivo, não retrabalho"). O caminho quando for a hora: ~1600 px + JPEG q82 ⇒ ~600 KB no total, sem mudança visual perceptível no tamanho renderizado. **Gatilho para revisar: qualquer deploy fora de local.**

### Dívida registrada — `PortfolioView` órfão (decisão do PI em 2026-07-16: **fatia futura**)

O **Portfólio da fábrica** (Fatia 14, issue #6 `finalizado`) era aberto pelo **rail de ícones**, que a SPEC-020 remove. A spec não diz onde ele reancora — e realocar tela já aceita é decisão de produto, não do Code. `pages/PortfolioView.tsx` fica **no código, íntegro e sem entrada** até o PI decidir (candidatos: menu do rodapé de usuário, item de grupo da sidebar, ou home). Não deletar: é trabalho aceito.

## Correção — retry de conflito no write-back reusava conteúdo velho — `finalizado` (mergeado PR #68 squash `4e06ca7`, `refs #69`; #69 aceita pelo PI em 2026-07-16)

Bug documentado (code review da Fatia 10, MEDIUM). **Sem spec**: o certo já estava no `ARCHITECTURE.md` → Resiliência — *"409 → re-sync, **reaplicar** mudança, um retry"*. O código **reenviava**.

1. `feito` — **O defeito**: o conteúdo era computado uma vez, **antes** do loop de retry. No 409 só o `baseSha` era re-lido e o merge do snapshot velho ia junto no PUT. Edição feita à mão no GitHub entre o snapshot e o retry era **silenciosamente sobrescrita** — sem erro, sem aviso, sem rastro. Onde doía mais: `docs/CONTEXT.md`, o cofre da asserção humana (ADR-013) — o material que só existe na cabeça do dono.
2. `feito` — **`putFileWithMerge`** (helper compartilhado, 5 testes): o `mutate` roda sobre o conteúdo **vivo** e é reaplicado a cada tentativa. `getFile` novo devolve `{sha, content}` do mesmo GET — a Contents API **já entregava os dois** e o `getFileSha` jogava o conteúdo fora. **Zero request novo.**
3. `feito` — **A doc dizia 3 call sites; são 2.** `mapping.putMapping` e `context.writeContext` fazem ler-mesclar-reescrever. O terceiro citado (`tabs.promote`) **não é o mesmo caso**: o conteúdo vem do humano que revisou — não há merge a reaplicar. Os outros três write-backs (`projection`, `board-import`, `handoff-commit`) **geram** o arquivo inteiro; idem. Re-PUTar é o **correto** para eles, e migrá-los seria inventar um merge que ninguém pediu. Os loops deles ficam.

**O teste pegou um bug no próprio conserto** — vale guardar: a 1ª versão do helper usava o conteúdo do **cache local** com o **sha vivo**, para poupar um GET. O PUT casava (o sha estava certo), **não havia 409**, e o merge saía calculado sobre o conteúdo velho: a edição concorrente morria **sem nem um conflito para avisar** — pior que o bug original. **Conteúdo e sha têm de vir do mesmo GET.** Só apareceu porque o fake rejeita PUT com sha desatualizado, como a Contents API faz; mockar `putFile` para "lançar uma vez" teria provado que o retry acontece, não que ele **reaplica**, que é o ponto.

**Sem verificação ao vivo, e isto é da natureza do bug**: ele é invisível na tela por definição — apaga dados sem deixar rastro. Reproduzir exigiria commitar no GitHub no intervalo exato entre duas chamadas. O teste é a única testemunha possível. 506 testes na API (+5), `nest build` limpo.

## Correção — Kanban só atualizava depois de um F5 — `finalizado` (mergeado PR #71 squash `ed5fc02`, `refs #70`; #70 aceita pelo PI em 2026-07-16)

Bug **reportado ao vivo pelo PI usando o produto**. Sem spec: corrida, não escopo.

1. `feito` — **A corrida**: o front já estava certo (o `handleSync` polla o `SyncRun` e recarrega o board pelo `syncNonce`, que já existia). O **backend quebrava o próprio contrato**: gravava `status: success|noop` — o sinal de *"pode recarregar"* — e **só então** emitia `SYNC_COMPLETED`, **sem `await`**. É esse evento que dispara o `syncIssues`. O front lia o board enquanto as issues ainda iam sincronizar; por isso só o F5 mostrava.
2. `feito` — **O conserto**: `emitAsync(SYNC_COMPLETED)` **antes** do `finish`, nos dois caminhos. **Zero mudança no web** — o mecanismo existia, faltava o backend cumprir o contrato que ele já sinalizava. **O `noop` era o caso do PI**: `noop` diz *"os docs não mudaram"*, e mover um card no GitHub **não toca `docs/`** — era o caminho onde o bug aparecia sempre.
3. `feito` — **A régua, no `ARCHITECTURE.md`**: *espera o que a tela lê ao recarregar; não espera o que roda em job*. O `DOCS_SYNCED` (que dispara IA) continua fire-and-forget — esperar por ele seguraria o sync por minutos (ADR-002). Custo do que passou a esperar: 2 chamadas ao GitHub, contra as muitas que o sync já faz.

**Os testes provados contra o bug**: 3 testes travam a ordem. Reintroduzi o defeito de propósito — **2 falharam**; restaurei — os 3 passam. Um teste que não falha quando o bug volta é decoração. 509 testes na API (+3), cobertura 76.7% → 78.2%.

## Correção — histórico do `TESTS.md` era sobrescrito, não acumulado — `finalizado` (mergeado PR #73 squash `f91dea7`, `refs #72`; #72 aceita pelo PI em 2026-07-16)

Bug **reportado ao vivo pelo PI**. Sem spec: o certo já estava no `TESTING.md` §4 — *"o histórico é append-only (linhas de entregas passadas são imutáveis)"*.

1. `feito` — **Rodar sem issue apagava tudo**: `meta.issue !== '—' ? keepHistory(...) : []`. Sem `refs #N` o histórico virava `[]` — e esse é o caso de **`pnpm test:report` local**, que eu rodo antes de cada PR. **Fui eu que apaguei o registro da SPEC-016**, hoje. Recuperado do commit `5a3fea4` e restaurado. Agora: **sem issue preserva e não acrescenta** (uma linha `| — | — | — |` não é evidência — não diz o que entregou nem por qual PR).
2. `feito` — **O `TESTING.md` se contradizia**: §4 *"linhas passadas são imutáveis"* × §5 *"**upsert** das linhas da issue atual"*. O código seguiu o §5 e o append-only virou só texto. §5 corrigido: reentregar a mesma issue vira **linha nova, datada** — duas execuções são dois fatos.

**Por que sobreviveu desde o primeiro commit do ADR-019** — e este é o achado que vale mais que o bug: **a guarda anti-drift compara só o bloco `Estado atual`**. Nada verifica o histórico. O defeito passou por **CI verde em 3 PRs seguidos**, porque os números do topo estavam certos enquanto o histórico era zerado. **A guarda que existe para impedir evidência forjada não vê a evidência acumulada** — num produto cuja tese é detectar documentação que mente.

**Sem teste automatizado, e isso é honesto**: escrevi um, vi que **não roda** (o jest da API tem `rootDir: apps/api` e `scripts/` fica fora; o ts-jest recusa o import através da fronteira) e **removi** — teste que não executa é pior que nenhum. Verificado na prática: rodei o comando que apagava e a SPEC-016 sobreviveu. Os dois buracos ficaram no `STATUS.md`: estender o `--check` ao histórico (append-only é verificável — é **continência de conjunto**, não igualdade, então não sofre do problema dos metadados que motivou o check a olhar só os números) e decidir onde o teste de script vive (toca a categorização do ADR-019 ⇒ decisão do PI).

## Kanban — card mostra data/hora de criação e de finalização — `finalizado` (mergeado PR #77 squash `3737f53`, `refs #76`; #76 aceita pelo PI em 2026-07-17)

**Pedido do PI ao vivo** (2026-07-16), olhando o board. Sem spec: escopo pequeno e definido pelo PI na hora, sem decisão de produto pendente.

1. `feito` — **A regra (decisão do PI: opção B)**. O pedido original era *"criação só aparece no Backlog"*. **Refinado na conversa**: nenhuma issue do board passou pelo Backlog (#74 nasceu em Em Andamento, #72 está em Finalizado) — o carimbo de criação só ali deixaria mudos justo os cards que mais interessam. Decidido: **cada coluna mostra o fato que importa nela** — `aberta em` (Backlog · A Fazer · Em Andamento · Feito), `finalizado em` (Finalizado), `descartado em` (Descartado). Formato `dd/MM/aaaa 'às' hh:mm`, 24h via `hourCycle: h23` (`hour12: false` sozinho produz `24:xx` à meia-noite). Encerrado sem `closedAt` → cai na criação: o card **nunca fica mudo nem inventa data**.
2. `feito` — **Custo real**: `closedAt` já existia ponta a ponta (Prisma → API → `BoardCard`) — só faltava renderizar. `createdAt` não existia em lugar nenhum: campo + migration `20260716220000_issue_created_at` + `created_at` no `GithubIssuesClient` + tipo na API/web. Entra **só no `create`** do upsert, nunca no `update` — data de nascimento é fato imutável.
3. `feito` — **Backfill honesto**: linhas existentes recebem `updated_at`, **não `now()`**. `now()` cravaria *"nasceu hoje"* numa issue antiga — fato falso, exatamente o que este produto existe para detectar. `updated_at` erra só para frente e é transitório: o cache é reconstruível (ADR-011), o próximo sync sobrescreve com o `created_at` real do GitHub. **Efeito visível no aceite**: os cards do import legado (#9, #8, #4) mostram `13/07/2026 às 00:00` até o próximo sync do board.
4. `feito` — **Um bug meu, pego no caminho**: o teste do formatador **passava por coincidência**. Eu setava `process.env.TZ` num `beforeAll` — mas o ICU resolve o fuso quando o processo sobe, então a env não fazia nada, e minha máquina já é São Paulo. No CI (UTC) os 3 casos de hora quebrariam. Fuso agora vai **por parâmetro**; provado rodando `TZ=UTC` (6/6 nos dois fusos). Mesma família do achado da #74: **teste verde que não prova o que diz provar**.
5. `feito` — API **509/509** · web **41/41** (+6), tsc + builds limpos, guarda anti-drift aprovando, `TESTS.md` regenerado (Tela 35→41, cobertura 4.3%→6.6%). **Validado ao vivo pelo PI** no board real antes do PR.

## Infra — `pnpm dev` sobe a infra antes da API — `feito` (carona no PR #77)

Commit separado (`chore`), não relacionado ao card — declarado no corpo do PR para ele não omitir o que carrega.

1. `feito` — **O sintoma**: a API estourava `P1001` (*"Please make sure your database server is running at `localhost:5433`"*) quando os containers estavam parados. Causa: `Exited (255)` nos dois — parada externa (Docker Desktop reiniciado), não crash. Container parado dá P1001 **idêntico** a banco quebrado; a distinção está no `docker compose ps -a`.
2. `feito` — **O conserto**: `"dev": "pnpm infra:up && pnpm -r --parallel dev"` + `"infra:up": "docker compose up -d --wait postgres redis"`. O `--wait` usa os healthcheck que **já existiam** no `docker-compose.yml` (`pg_isready` / `redis-cli ping`) — sem script de espera, sem dep nova. O `&&` garante que a API só arranca com o banco aceitando conexão.
3. `feito` — **Provado com os containers parados**: `pnpm dev` sobe postgres+redis até `Healthy`, API mapeia as rotas em `3311`, vite em `5180`. **Fora do escopo de propósito**: `dev:api`/`dev:web` avulsos não sobem infra — quem chama o script específico sabe o que quer.

**Achado no caminho** (não é bug desta mudança): quando o P1001 mata a API, o `pnpm -r --parallel` deixa o **web órfão** segurando a `5180`. Com `strictPort` (CLAUDE.md), o vite seguinte falha em vez de trocar de porta e derruba a leva inteira. Se o `dev` falhar com porta em uso, é processo velho — `Get-NetTCPConnection -State Listen -LocalPort 5180,3311` acha o dono.

## Correção — a guarda anti-drift não guardava (nem o histórico, nem a si mesma) — `finalizado` (mergeado PR #75 squash `a072823`, `refs #74`; #74 aceita pelo PI em 2026-07-17)

Fecha os **dois buracos** que a correção anterior (PR #73) deixou registrados no `STATUS.md`. Sem spec: o certo já estava no `TESTING.md` §4 (*append-only*).

1. `feito` — **`--check` prova o histórico** (`droppedHistory`): continência de conjunto — o histórico novo pode ter linhas a mais, nunca a menos. Não compara metadados, então não sofre do problema que fez o check original olhar só os números.
2. `feito` — **A 1ª versão do conserto tinha o defeito que consertava.** Comparei o arquivo com a saída de `render(…, existing)` — construída **a partir do próprio arquivo**. Histórico apagado ⇒ os dois lados vazios ⇒ *"íntegro"*. **Os 8 checks unitários estavam verdes**; só a forja ao vivo pegou. Provavam a função, não a fiação — a mesma lição do PR #73 (teste que não roda), num disfarce novo: teste que roda e não cobre o caminho real. Baseline agora é o **blob do git na base do PR** (`REPORT_BASE_REF`).
3. `feito` — **Nunca `HEAD` como baseline.** No CI de `pull_request` o checkout deixa HEAD no **merge commit**, cujo `TESTS.md` é a versão do próprio PR — auto-testemunho de novo, um nível acima. CI faz `git fetch --depth=1 origin $base_ref` e passa `origin/<base>`.
4. `feito` — **2º bug, achado no caminho: a prova de números falhava ABERTA.** Checkout Windows entrega CRLF, o gerador emite LF → `--check` acusava divergência entre blocos idênticos na tela. Guard que falha sempre é guard que ninguém lê. Normaliza a quebra de linha antes de comparar.
5. `feito` — **Self-check do gerador** (`gen-test-report.selfcheck.ts`, 10 checks, `assert` puro do Node, roda no CI **antes** do `--check`). `assert` e não jest porque `rootDir: apps/api` não alcança `scripts/` — o problema que o PR #73 encontrou. Aqui não removi o teste: dei um runner que executa (`pnpm test:report:selfcheck`). Onde ele mora **em definitivo** segue no `STATUS.md` como decisão do PI (entra na régua Regras/Banco/Tela ou não).
6. `feito` — **Validado ao vivo** (o que os unitários não provaram): forja do bug da SPEC-016 → **exit 1** nomeando as 3 linhas perdidas · append legítimo → exit 0 com as velhas preservadas · intacto → exit 0 · sem git → não derruba.

7. `feito` — **Re-validado em 2026-07-17, pós-rebase.** A branch ficou 4 commits atrás da `main` (a entrega da #76 entrou no meio) e foi rebasada em `62f84ad` — 3 conflitos de doc resolvidos mantendo os dois lados; `package.json` mesclou sozinho (`infra:up` e `test:report:selfcheck` convivem). **Rebase muda o baseline, e o baseline é o coração desta guarda** ⇒ re-executei tudo contra a `main` de hoje: selfcheck **10/10** · forja do bug da SPEC-016 → **exit 1** nomeando as 3 linhas · arquivo intacto → **exit 0**. O **CI verde no head `6159b75`** é o que fecha: é o único lugar onde `REPORT_BASE_REF` e o `git fetch` da base rodam de verdade (local sempre cai no fallback `HEAD`).

**Achado do PR corrigido:** o corpo da issue #74 cita `reports/TESTS copy.md` (untracked, evidência forjada à mão) como pendência. **O arquivo não existe mais** no working tree — verificado em 2026-07-17. Nada a decidir.

## Correção — `--dim` reprova contraste AA nos dois temas — `finalizado` (mergeado PR #79 squash `e7e3f45`, `refs #78`; #78 aceita pelo PI em 2026-07-17)

Bug documentado (medido no polish da Fatia 15/16 em 2026-07-16). Sem spec — o certo já está no `DESIGN.md` §11 e é critério de aceite da SPEC-020 —, mas **toca o design system, então a decisão de corrigir passou pelo PI** (2026-07-17).

1. `feito` — **O defeito**: `--dim` dava 3.32:1 (Carbono) e 2.86:1 (Claro) contra o pior fundo; mínimo AA é 4.5:1. Atingia timestamps, contadores, `@login`, breadcrumb e o rótulo vertical da coluna.
2. `feito` — **Por que não bastava escurecer**: `--dim` tem dois papéis — texto de metadado (4.5:1) **e** não-texto (aresta do Grafo, chevron, ponto de coluna — 3:1, e o §6 quer a aresta subordinada ao nó). Empurrá-lo até AA no Claro o colidiria com `--faint` (ambos `~#696c71`) e engrossaria a aresta: troca de um defeito por outro.
3. `feito` — **A correção (decisão do PI: separar os papéis)**: os 13 usos de **texto** migram `text-dim` → `text-faint` (5.09:1 / 4.54:1, já AA). `--dim` fica **só para não-texto**. **Zero mudança de valor de cor** — só a atribuição. Escala honesta: 2 níveis de texto (`--muted`/`--faint`) + 2 de não-texto (`--dim`/`--dimmer`).
4. `feito` — `DESIGN.md` §4.1 (tabela de papéis + veredito de contraste) atualizado. `tsc` + `vite build` limpos, 39 testes de tela verdes, histórico do `TESTS.md` intacto. **Verificação ao vivo pendente** (atrás do OAuth, como as Fatias 15/16).

## Atividade — gaveta fecha sozinha 4s após abrir pelo sync — `finalizado` (mergeado PR #81 squash `94fd630`, `refs #80`; #80 aceita pelo PI em 2026-07-17)

Pedido do PI ao vivo (2026-07-17). Sem spec: ajuste de UX pequeno, definido na hora (natureza do #76). Muda a SPEC-010 na margem.

1. `feito` — **A regra**: a gaveta já abria no fim do sync (decisão anterior do PI). Agora **fecha sozinha 4s depois**, como um toast. **Só quando abre pelo sync** — abrir pela pílula é intenção de ler e nunca auto-fecha.
2. `feito` — **Duas proteções**: interação (hover/scroll/clique/foco) reinicia a contagem; operação em curso adia enquanto há job de IA (o polling re-emite o sinal a cada 2s < 4s) — nunca fecha no meio de trabalho visível.
3. `feito` — **`useAutoClose.ts`** (hook novo, 5 testes): arma só quando pedido, re-arma no `bumpToken`, e **re-render sem interação NÃO reinicia** — senão o polling do feed (2s) seguraria a gaveta aberta pra sempre; o teste trava isso. `Workspace` arma no sync e desarma na pílula; `ActivityPanel` emite `onActivity` em interação e enquanto `running.length > 0`.
4. `feito` — tsc + vite build limpos, 46 testes de tela verdes (+5). **Verificação ao vivo pendente** (atrás do OAuth): abre no sync → 4s → fecha; hover cancela; job rodando adia; pílula não fecha.

## Fatia 8 — Multi-tenant — `finalizado` (SPEC-022, issue #7 fechada + `proplan:finalizado`; aceita pelo PI em 2026-07-18)

Spec `aprovada-pi` (2026-07-17). Entregue em 6 PRs (`refs #7`, nunca `closes`). Plano completo em `docs/specs/SPEC-022-multi-tenant.md`.

**Aceita com o PR-5 pendente.** O PI fechou a #7 em 2026-07-18 sem a derivação de papel do GitHub e sem o re-liga do reinstall — os dois critérios de aceite da spec seguem abertos. Decisão do PI (2026-07-20): o resto **vira card próprio (#88)**, a #7 não reabre. Enquanto o #88 não entrega, só o tenant pessoal existe e `Membership.role` não deriva de nada.

**Eixo:** RLS + `SET LOCAL app.tenant_id` por request tornam o filtro de tenant invisível e obrigatório na camada de banco — os services deixam de carregar `where:{tenantId}`. Barreira primária = guard que recusa não-membro; RLS = a rede (F1).

**PR-1 — Fundação de banco** (`em-andamento`):
1. `feito` — **role `proplan_app` NÃO-owner/NÃO-superuser** (`docker/postgres-init/01-app-role.sql`). Sem isto, RLS é no-op silencioso: `proplan` é superuser+owner e o Postgres pula RLS para ambos. Provado: `pg_roles` mostra `rolsuper=f` para `proplan_app`; ela conecta e lê `projects` (grants ok). Volume `pgdata` já existente NÃO re-roda o init — aplicar o SQL à mão (feito no dev).
2. `feito` — **duas URLs**: `DATABASE_URL` (app → `proplan_app`, sujeita a RLS) e `DIRECT_URL` (migrations/seed → `proplan` owner). `datasource { url, directUrl }` no schema; `.env` e `docker-compose.yml` atualizados. `prisma validate` ok.
3. `feito` — **harness do jest `banco`** (`test/int/db-harness.ts`): `ownerClient`/`appClient` + `applyMigrations`. Asserções de isolamento usam `appClient` (owner mentiria — pula RLS). Banco de teste separado do dev.

**PR-2 — Schema + migração + RLS** (`em-andamento`):
1. `feito` — **`Tenant` (PK própria + `installationId` re-apontável) e `Membership {userId, tenantId, role}`**; `tenantId` em Project/Settings (NOT NULL após backfill) e LlmUsage (nullable permanente, F4). 13 filhas SEM coluna — herdam por join.
2. `feito` — **migração `fatia_8_multi_tenant`** (SQL à mão via `migrate diff`): backfill idempotente do usuário único → tenant pessoal (id determinístico + `ON CONFLICT` + `WHERE tenant_id IS NULL` ⇒ roda 2× sem duplicar, F3). `SET NOT NULL` nas raízes é o guarda contra backfill incompleto.
3. `feito` — **RLS em profundidade**: `ENABLE`+`FORCE` em 15 tabelas. Raízes casam por `tenant_id`; `llm_usage` trata NULL como tenant ativo; 12 filhas por `project_id IN (SELECT ... FROM projects WHERE tenant_id = current_setting('app.tenant_id', true))`. `missing_ok=true` ⇒ sem contexto = fail-closed.
4. `feito` — **8 int-specs contra Postgres real** (`rls-isolation`, `rls-audit`), conectando como `proplan_app`: fail-closed sem contexto · isolamento A/B nas raízes · herança nas filhas · cobertura de policy (`pg_policies` sobre toda tabela de tenant) · backfill idempotente. **Provado ao vivo** no `proplan_test`. `regras` segue 509/509.

Descoberto e corrigido: o `GRANT ON ALL TABLES` do init (PR-1) roda no initdb com banco vazio (no-op); o harness re-concede pós-migração (`grantAppRole`). Em prod fresh o `ALTER DEFAULT PRIVILEGES` cobre.

**PR-3 — Contexto + guards** (`em-andamento`):
1. `feito` — **`PrismaService.withTenant(tenantId, fn)`**: `$transaction` + `set_config('app.tenant_id', id, true)` (SET LOCAL, morre no commit) + AsyncLocalStorage (`tenant-context.ts`) expõe o client-tx sem reescrever assinatura de service. **Nunca `SET` de sessão** (vazaria no pool).
2. `feito` — **`TenantGuard`** (lê `:tenant`, resolve Membership, 403 se não-membro, popula `req.tenantId`/`req.role`) · **`RoleGuard` + `@RequireRole`** (hierarquia owner>member>viewer) · **`MembershipService.currentMembership()`** exposto pelo identity (ADR-001) · **`TenantContextInterceptor`** abre `withTenant` por request após os guards.
3. `feito` — **arch-spec `tenant-scope`**: varredura estática (molde do `installation-token-usage`) barra qualquer arquivo que sete `app.tenant_id` fora do `withTenant` — o contexto tem um único setter (F2).
4. `feito` — **testes**: unit dos guards (RoleGuard 8, TenantGuard 3) em `regras` (521/521); int-spec `tenant-context` prova que o SET LOCAL **não vaza no pool** (pool=1, `withTenant(A)` → query fora de contexto = 0 linhas). `banco` 10/10. Jest project `banco` agora `maxWorkers:1` (suítes compartilham o Postgres de teste — serial evita colisão de seed/contexto).

**PR-4 — RBAC do board + gate owner** (`em-andamento`):
1. `feito` — **gate owner na finalização** (`board-mutation.service.ts`): `closesIssue(input)` (mover para `finalized`/`discarded` ou `discard_card`) exige `role === 'owner'`, senão 403 — **antes** de tocar o banco/criar o job. É o único ponto síncrono com o papel: depois do enqueue o worker carrega só `{mutationId, projectId}` e não reautentica. Nenhuma automação finaliza. Cobre finalizado **e** descartado (decisão do PI: qualquer fechamento de issue é ato do dono, além da letra da spec que cita só `finalizado`).
2. `feito` — **board controller sob `/t/:tenant`**: `@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)` + `TenantContextInterceptor`. GETs sem exigência (viewer **lê** o board); POSTs de escrita com `@RequireRole('member')` (viewer barrado). `enqueue` recebe `req.role`.
3. `feito` — **11 testes** do gate (`board-mutation.spec.ts`): `closesIssue` por coluna; owner finaliza, member/viewer → 403 sem enfileirar; gate roda antes do banco. `regras` 532/532.

**Pendência consciente**: só o **board** migrou para `/t/:tenant`; os outros 8 controllers (tabs, activity, canonical, freshness, context, handoff, ingestion, insight) seguem em `/projects/:id` até o **PR-6** (roteamento completo + frontend). A app não roda ponta-a-ponta até lá — esperado numa pilha de PRs não-mergeados.

**Teto de IA por tenant → PR próprio (PR-4b)**: `SettingsService` é chaveado por `userId` em ~8 métodos + callers cross-module; migrar `userId→tenantId` não cabe junto do RBAC. Fica isolado. O `aggregate` de `LlmUsage` já escopa por tenant via RLS quando roda sob contexto — a mudança restante é a chave do Settings.

**Emenda E1 (ADR-020) + PR-6 — multi-tenant ponta-a-ponta** (`em-andamento`):
1. `feito` — **Contexto por array de membership** (`app.tenant_ids`, ADR-020): migração `e1_tenant_ids_array` recria as 15 policies com `tenant_id = ANY(NULLIF(current_setting('app.tenant_ids', true), '')::text[])`. Uma policy serve rota escopada (array de 1) e rota global do catálogo (array completo). `NULLIF` trata string vazia (Postgres retorna `''` numa conexão que já viu a var) → fail-closed. `withTenant` passa a receber `string[]`.
2. `feito` — **Rota global do catálogo sob RLS** (resolve o 500 do dogfooding): `CatalogService` monta o array de membership do usuário (`membershipTenantIds`) e lê projetos via `withTenant(array)` — cross-tenant sem bypass. `InstallationGroup` ganha `tenantId` (1:1 com instalação) para o front montar `/t/:tenant`.
3. `feito` — **8 controllers restantes sob `/t/:tenant`** (activity, tabs, canonical, freshness, context, handoff, ingestion, insight): `TenantGuard` + `RoleGuard` + `TenantContextInterceptor`, mesmo padrão do board. `canonical`/`insight` ganharam `IdentityModule`. `usage`/`catalog`/`auth` seguem globais.
4. `feito` — **`me()` estendido** com `tenants:[{id, accountLogin, role}]` (do `Membership`).
5. `feito` — **Frontend `/t/:tenant`**: rotas prefixadas (`App.tsx`), `TenantSync` fixa o tenant ativo da URL (`api.setActiveTenant`), `request()` prefixa `/projects/` → `/t/:tenant/projects/` num ponto (callers intactos), catálogo abre `/t/:tenant/p/:id`, navigates com tenant, **viewer read-only** no board (`readOnly = role==='viewer' || mode!=='active'` desliga DnD/criar/editar). Build web ok.
6. `feito` — **int-spec do catálogo** (array [A,B] vê os dois) + `regras` 532/532, `banco` 11/11. **Corrigido**: `maxWorkers:1` estava no project (jest ignora) → movido pra raiz do config (serial de verdade).

7. `feito` — **Workers sob contexto RLS** (achado do e2e do PI: telas ok, sync com ~122 requests de polling e "tempo esgotado"). Causa raiz: os workers BullMQ (sync, insight, board) rodam **fora de request** — sem `SET LOCAL app.tenant_ids`, o RLS fail-closed cortava toda query; o `runSync` morria no primeiro `findUnique` ("SyncRun não encontrado"), o retry 3x morria igual, e **nem o `status: failed` conseguia gravar** → run preso em `queued` → o front (`pollSyncRun`, 1,2s até 60s) estourava o timeout. Correção: `PrismaService.runInTenantContext(tenantIds, fn)` — contexto **por operação** via client extension (padrão Prisma p/ RLS): cada operação de model vira `$transaction([set_config(LOCAL), query])` — mesma conexão, sem vazar no pool, **cada escrita commita na hora** (o `failed` do catch persiste; `running` visível ao polling). **Não** é o `withTenant` (tx única): uma tx segurada pelo job inteiro estouraria o timeout de tx interativa, seguraria conexão durante rede/IA e engoliria o `failed` no rollback — o sintoma voltaria. O `tenantId` viaja no **job data** (capturado no enqueue autenticado; jamais de input do cliente): `SyncJobData`, `InsightJobData` (via `DocsSyncedEvent`), `BoardJobData` (mutação repassa à projeção agendada). Listeners in-process (board/canonical/insight no fim do sync) herdam pelo AsyncLocalStorage. Guardas fail-fast: enqueue rejeita projeto sem `tenantId` (pré-backfill); `runInTenantContext` rejeita array vazio. Testes: `worker-context.int-spec.ts` (4 — visão dentro/fora do contexto, isolamento A/B, **commit por operação provado por outra conexão no meio do job**) + fiação dos 3 workers (`sync.worker.spec`, `insight.worker.spec`, `board.worker.spec`). `regras` 536/536 · `banco` 17/17 · tsc + nest build limpos.

8. `feito` — **`$transaction([...])` em lote sob contexto** (2º achado do e2e do PI: 1º sync `success`, 2º `noop` falhava com `documentResolution.createMany()` → *Unique constraint failed*). Causa raiz, **mesma família do item 7**: o contexto por operação do `runInTenantContext` cobre cada operação de model via camada de query do client estendido — mas um **`$transaction([deleteMany, createMany])` em array NÃO passa por essa camada**, então rodava no client base sem o `SET LOCAL`. Sob RLS: o `deleteMany` não via as 42 linhas existentes (fail-closed) e o `createMany` colidia no unique `(projectId, entity)`. Batia em `resolution.rebuild` (roda no success **e** no noop — por isso o 2º sync). Correção **no mecanismo, não no call site** (são 6 os `$transaction([...])`): `tenantIdsStorage` (novo ALS paralelo ao client) guarda os ids; o Proxy do `PrismaService` intercepta `$transaction` em lote quando há contexto e **injeta o `set_config` como 1ª operação do array** — uma transação real, mesma conexão, SET LOCAL vivo. Vale para os dois caminhos (worker e request `withTenant`). Teste de regressão em `worker-context.int-spec.ts`: o padrão exato delete+insert rodado **2×** (idempotente) contra Postgres real. `banco` 18/18 (+1) · `regras` 536/536 · nest build limpo. Runs presos em `queued` da sessão pré-fix cancelados no banco + `FLUSHDB` no Redis.

**Verificação ao vivo pendente** (atrás do OAuth, teste do PI): abrir o catálogo (não deve mais dar 500), entrar num projeto (`/t/:tenant/p/:id`), navegar abas, F5 preserva tenant/projeto/aba. **Re-testar o sync** (era o item quebrado): disparar Sincronizar e ver o run sair de `queued` → `running` → `success` sem timeout; jobs antigos presos na fila do Redis de antes da correção falham com erro claro (sem `tenantId`) — limpar com `docker compose restart redis` se poluírem a Atividade. Nota: a 1ª tentativa de um sync pode logar "SyncRun não encontrado" e curar no retry de 2s — o enqueue roda dentro da tx do request e o job pode chegar ao worker antes do commit; se aparecer com frequência, mover o enqueue para pós-commit.

**PR-4b — teto de IA por tenant**: `feito` (mergeado, commit `f93fc82` — Settings/Usage sob contexto, fix do 500).

**PR-5 — papel derivado do GitHub + reinstall re-liga**: **não entregue nesta fatia**. Virou a issue **#88** (`proplan:todo`) por decisão do PI em 2026-07-20, depois de a #7 ter sido aceita sem ele. Cobre os 2 critérios de aceite da SPEC-022 que seguem abertos: papel cai no próximo sync quando o acesso do usuário some do GitHub; reinstall re-aponta `installationId` no `Tenant` existente sem duplicar nem orfanar.

**Card cortado em dois** (decisão do PI em 2026-07-20), porque os dois eixos têm maturidade diferente:

- **Eixo-1 — derivação de papel do GitHub → #88**, entregue (ver seção própria abaixo). Ficou bloqueado por ~1h enquanto eu afirmava faltar decisão do PI: as 4 perguntas **já estavam respondidas** na **emenda E2** da SPEC-022 (aprovada em 2026-07-18), que estava na árvore de trabalho **sem commit** — eu não a via. Commitada em `96234d3`. Lição: **verificar o working tree antes de declarar bloqueio**, não só o que está versionado.
- **Eixo-2 — reinstall re-liga → #89**, entregue (ver seção própria abaixo). Dispensa spec: comportamento já definido na SPEC-022.

## Multi-tenant — derivação de papel a partir do GitHub (eixo-1 do PR-5) — `feito` (mergeado PR #92 squash `49c0c95`, `refs #88`; aguardando aceite do PI)

Spec: **SPEC-022, emenda E2** (`aprovada-pi` em 2026-07-18), que resolve as 4 decisões. Entregue em branch **empilhado sobre o PR #90** (decisão do PI): o #88 toca `listInstallations`, o mesmo método do #89 — partir da `main` daria conflito. Mergeado depois do #90, com rebase (o squash do #90 fez o git descartar sozinho os 4 commits já na `main`).

**Com o #89, o PR-5 inteiro está entregue — a SPEC-022 não tem mais critério de aceite em aberto.**

### Achado no merge: a suíte `banco` nunca rodou verde no CI

Descoberto ao tentar mergear o #90 — e maior que os dois cards. O workflow definia `DATABASE_URL` na **5432** (porta do serviço do runner), mas o harness dos int-specs resolve por `TEST_DIRECT_URL`/`TEST_DATABASE_URL`, com **fallback para a 5433** do dev local. Nomes e portas diferentes ⇒ o `prisma migrate deploy` falhava com `P1001` e **toda** a suíte `banco` caía. Faltava também a role `proplan_app` no runner: no dev ela nasce do `docker-entrypoint-initdb.d`, que o serviço do CI não roda.

O comentário que estava no próprio workflow entrega a idade do problema: *"Categoria Banco ainda vazia; a DB de teste já fica pronta para quando os `*.int-spec.ts` existirem"*. Eles passaram a existir no **PR-2 da Fatia 8** e ninguém atualizou o workflow — o run do `feat/spec-022-pr6-e2e` **também falhou e foi mergeado assim mesmo**.

**A consequência é a que mais incomoda**: o `reports/TESTS.md` — o artefato do ADR-019, que existe justamente para ser evidência *verificada* em vez de narrada — registrava **"Banco 0"**. Não era "zero teste"; eram **18 testes que nunca rodavam**. O número estava correto sobre a execução e falso sobre a realidade, que é a forma mais difícil de detectar.

Corrigido no PR #90: `TEST_*` apontando para a 5432 + step que cria a role (**não-superuser de propósito** — o Postgres pula RLS para superuser e owner, então com a role errada os testes de isolamento passariam *sem provar nada*, SPEC-022 F1). Estado atual do relatório: **Regras 564 · Banco 18 · Tela 46**, todos verdes.

**A régua que fica**: quando uma categoria de teste nasce, o workflow precisa nascer com ela — e um `0` no `TESTS.md` merece a mesma desconfiança que um número errado.

1. `feito` — **`role-derivation.ts`** (`identity/domain`, puro): traduz permissão do GitHub → `owner`/`member`/`viewer`, com a guarda da decisão 4. Mora no `identity` porque papel é autorização; o `catalog` só dispara e não conhece `Membership` (ADR-001).
2. `feito` — **Decisão 1 (admin)**: `GET /orgs/{org}/memberships/{username}`, 1 request por org por recálculo, sempre com **token do usuário** (ADR-015 — e aqui é duplamente necessário: o endpoint responde sobre a relação *daquele* usuário com a org; com installation token a pergunta nem faria sentido). **Ambiguidade resolvida dentro do escopo**: a decisão fala "sem escrita → `viewer`", mas este endpoint só distingue `admin` de `member` — permissão repo-scoped ficou **fora** do corte E2, e é ela que revelaria acesso somente-leitura. Então `viewer` aqui significa **não-membro da org** (perdeu acesso), não "membro sem escrita". Registrado no código.
3. `feito` — **Decisão 2 (throttle)**: recálculo na `listInstallations`, **nunca** no sync de docs. Campo `Membership.roleSyncedAt` + migration `membership_role_synced_at`, janela de 15min. **Persistente, não em memória**: throttle em memória zera a cada reinício da API e, com múltiplas instâncias, cada uma manteria a própria janela — viraria a tempestade de request que a decisão evita.
4. `feito` — **Decisão 3 (tenant pessoal)**: `accountType === 'User'` → dono é `owner` por definição. O short-circuit está **no serviço**, não só no domínio puro — o critério de aceite é *"sem nenhuma chamada a `/orgs/.../memberships`, conferível em rede"*, e um domínio que decide certo depois da chamada não satisfaz isso.
5. `feito` — **Decisão 4 (guarda anti-rebaixamento)**: a derivação nunca rebaixa o **único `owner`** do tenant. Rebaixar um owner **entre vários** é legítimo — a guarda não é trava-tudo. Ela também **não promove**: protege quem já é owner, não inventa um. Falha de rede devolve `null` (tratado como "sem acesso"), e é a guarda que impede uma indisponibilidade transitória do GitHub de deixar o tenant sem owner.
6. `feito` — **Best-effort em toda a cadeia**: o recálculo roda dentro de uma rota de **leitura**; falha do GitHub, do banco ou do próprio serviço é logada e seguida, nunca derruba o catálogo.
7. `feito` — **19 testes** (11 de domínio + 8 do serviço). Os do serviço **contam as chamadas ao GitHub**, não só o papel gravado: um teste que olhasse apenas o `role` passaria mesmo com a tempestade de request. **Provados contra o bug**: removi o throttle → 1 falha; removi o carve-out da conta pessoal → 1 falha; restaurei → 8/8. API **564/564**, `banco` 18/18, tsc + build limpos.

### Verificação ao vivo executada (2026-07-20, `RoleSyncService` real + banco de dev)

Contra o `Membership` real do dogfooding (`RodReis`, tenant `User`, `owner`, `role_synced_at` **nulo**), com o serviço de produção instanciado e um client instrumentado que **conta as chamadas** que teriam ido ao GitHub — porque o critério da E2 é *"conferível em rede/logs"*, e olhar só o papel gravado não distinguiria o caminho certo da tempestade de request:

| cenário | chamadas ao GitHub | papel |
|---|---|---|
| tenant pessoal (`User`), nunca sincronizado | **0** ✅ | `owner` ✅ |
| org, carimbo de 1min atrás (dentro da janela) | **0** ✅ | inalterado ✅ |
| org, carimbo de 20min atrás (fora da janela) | **1** ✅ | `owner` ✅ |
| org, GitHub diz "sem acesso", **único owner** | 1 | `owner` — **não rebaixado** ✅ |

O cenário 4 emitiu o **log da guarda de verdade** (`WARN [RoleSyncService] … seria rebaixado, mas é o único owner do tenant`), não apenas o valor correto no banco — era o que faltava provar da decisão 4.

**Estado restaurado**: `role`/`roleSyncedAt` de volta ao original, 7 projetos e o tenant intactos.

**O que só o PI pode provar** (exige OAuth e uma org real): que o papel bate com a permissão **real** no GitHub — aqui a resposta do endpoint foi injetada. Roteiro: abrir o catálogo com uma org onde você é admin → `role = owner`; remover o próprio acesso admin nessa org → o papel **permanece** `owner` se você for o único (guarda), e cai se houver outro owner.

## Multi-tenant — reinstall re-liga o Tenant (eixo-2 do PR-5) — `feito` (mergeado PR #90 squash `071e614`, `refs #89`; aguardando aceite do PI)

Sem spec: o comportamento correto já está na SPEC-022 §Notas técnicas (*"Reinstall re-liga, não recria"*) e no Escopo 1 — bug documentado pela tabela do `CLAUDE.md`.

1. `feito` — **A decisão que travou a implementação (levada ao PI, opção B escolhida)**: o critério da spec é casar o tenant *"por conta/org"*, mas o `Tenant` só guardava `accountLogin` (**texto mutável**). Casar por login **quebra num rename de conta** — não acha o tenant e cria um duplicado, que é exatamente o dano que este card existe para impedir. Seria repetir, um nível acima, o erro que a PK própria do `Tenant` já corrige: trocar um id instável por um login instável. **Opção B**: coluna `accountId` (id numérico da conta, o único identificador estável que o GitHub expõe aqui) + migration `tenant_account_id`.
2. `feito` — **`accountId` nullable, e o backfill não chama a rede** (sub-decisão minha, dentro do escopo): as linhas existentes nascem sem `accountId` porque uma migration que faz request de rede torna o deploy dependente de token válido e da disponibilidade da API. O primeiro `listInstallations` preenche, casando por login — fallback que roda **no máximo uma vez por tenant**, já que o re-liga grava o `accountId`. Índice único ignora NULLs no Postgres, então as linhas pré-migration convivem.
3. `feito` — **Domínio puro `tenant-reconcile.ts`** (molde do `installation-reconcile.ts`): casa por `accountId`, cai no login só quando ele é nulo, devolve diff mínimo. **Tenant sem instalação visível fica intacto** — ausência aqui é *"não vi agora"* (falta de permissão, token de outro usuário), nunca *"não existe mais"*; desligar por silêncio orfanaria os dados que o módulo protege.
4. `feito` — **Fiação em `CatalogService.relinkTenants`**, antes de montar o mapa `installationId→tenantId` (senão o tenant re-instalado não seria encontrado e o front abriria sem tenant). Escopado aos tenants de membership — nunca varre a tabela. `InstallationAccount.id` novo no client (o GitHub já devolvia; só não persistíamos).
5. `feito` — **8 testes de domínio**, incluindo os dois que provam a escolha da opção B: rename da conta **não** cria tenant novo; e `accountId` vence o login quando um **homônimo** toma o login liberado — casar por login pegaria a conta errada e re-apontaria o tenant para a instalação de um terceiro (vazamento entre tenants). API **544/544**, `banco` 18/18 (rodado 2×), tsc + nest build limpos.

**Achado de ambiente (não é bug do código)**: uma execução da suíte `banco` falhou com *Unique constraint failed* no `worker-context.int-spec`. Não era regressão — o `prisma generate` havia falhado com `EPERM` porque o `pnpm dev` segurava a DLL do query engine, então os testes rodaram contra um client **sem** o `accountId`. Matar os processos do dev e regerar resolveu; verificado contra a árvore limpa (18/18 antes e depois). Mesma família da nota de watchers órfãos já registrada — vale o reflexo: **`EPERM` no generate invalida a rodada de teste seguinte.**

### Verificação ao vivo executada (2026-07-20, banco de dev real)

Contra o `Tenant` real do dogfooding (`00000000-…-e48e206abe39`, instalação `146171535`, `account_id` **nulo** — linha pré-migration, justamente o caso do fallback), com um projeto semeado sob contexto RLS para que a prova não fosse vazia:

- ✅ **Re-liga, não recria**: `installationId` `146171535` → `999888777` **no mesmo `Tenant`** (PK idêntica antes e depois). `tenants` continua com **1 linha** — nenhum duplicado.
- ✅ **Nada orfanou**: os **8 projetos** do tenant (7 reais + 1 seed) e a membership seguem ligados após o re-liga.
- ✅ **Fallback da linha pré-migration**: `account_id` `null` → `80895`, casado por login, exatamente uma vez.
- ✅ **Estado restaurado**: seed removido, `installationId`/`account_id` de volta ao original; 7 projetos reais intactos, conferidos como owner.

### Reinstall REAL executado pelo PI (2026-07-20) — a prova definitiva

O PI desinstalou o App no GitHub (`Danger zone → Uninstall`) e reinstalou pelo CTA **"Instalar no GitHub"** do próprio catálogo. O GitHub emitiu um `installationId` **novo**, e o re-liga rodou no `listInstallations`:

| checagem | antes | depois | veredito |
|---|---|---|---|
| `Tenant.id` | `00000000-…e48e206abe39` | **idêntico** | ✅ re-apontou, não recriou |
| `installation_id` | 146171535 | **147870965** | ✅ o id do GitHub **mudou de fato** |
| linhas em `tenants` | 1 | **1** | ✅ não duplicou |
| projetos / órfãos | 7 / 0 | **7 / 0** | ✅ nada orfanou |
| `account_id` | 80895 | 80895 | ✅ casou por **id**, não pelo fallback de login |

**A premissa do card confirmada empiricamente**: `146171535 → 147870965`. O id de instalação do GitHub realmente não é estável — é o fato que justifica a PK própria do `Tenant` e todo este eixo. **Sem este código, o reinstall teria criado um `Tenant` duplicado** e os 7 projetos ficariam presos ao tenant antigo, apontando para uma instalação morta.

**Observado de quebra**: `role_synced_at` **não** mudou no reinstall (seguiu `19:07:35`) — é o throttle da decisão 2 (#88) agindo em cenário real, sem ter sido forçado.

**Bug de documentação corrigido no caminho**: eu indiquei ao PI a URL pública `github.com/apps/rrb-proplan` para reinstalar, que dá **404** — ela só vale para Apps públicos, e este é privado. O caminho correto é `github.com/settings/apps/<slug>/installations`, ou — melhor — o **CTA do próprio catálogo**, que monta a URL certa via `GET /catalog/install-url` (Fatia 4.5). O estado vazio ("O ProPlan ainda não está instalado em nenhum repositório") foi exercitado ao vivo pela primeira vez e renderizou correto.

**Dois achados da verificação, ambos do RLS funcionando:**
1. **O seed foi barrado** (`42501: new row violates row-level security policy`) ao tentar inserir projeto **fora** de contexto de tenant. É o fail-closed do PR-3 fazendo o trabalho dele — o script passou a semear sob `SET LOCAL`, como a app faz.
2. **Quase li um falso positivo**: o `count()` final acusou **0 projetos** e pareceu perda de dados. Era o mesmo fail-closed — aquele count rodou fora de contexto. Conferido como owner: **7 projetos intactos**. Registrado porque o padrão vai voltar: **contagem fora de contexto sempre devolve zero, e zero parece dano.**

## Fatia 18 (SPEC-024) — Épicos: hierarquia MVP→fatia no board via GitHub sub-issues — `feito` (4 PRs empilhados, aguardando aceite do PI)

Uma fatia, **4 PRs** (`card = fatia`, ADR-011; os passos vivem aqui, não viram issues). Escopo = issue **#97** + `docs/specs/SPEC-024` (que **batem** — a spec é a v2 completa `aprovada-pi`). Layout **swimlane** é decisão da spec (§Decisão de produto), não escolha da implementação. Issues de teste **#95** (épico) / **#96** (filha) validam a fatia.

1. `feito` — **PR-1 (#98): leitura GraphQL de sub-issues.** `GithubIssuesClient.listIssuesWithHierarchy` lê `repository.issues { parent{number} subIssues{totalCount} }` via **GraphQL** (`POST`, header `GraphQL-Features: sub_issues`), derivando `parentNumber` e `hasSubIssues` em cada `GithubIssue`. **Fallback**: erro no GraphQL cai no REST `listIssues` (board plano, degrada em vez de quebrar); 401 é fatal. GraphQL v4 `repository.issues` traz só issues (PRs vivem em `pullRequests`) → dispensa o filtro `pull_request` do REST. Sem Octokit (regra de stack).

2. `feito` — **PR-2 (#99): schema + persistência.** `model Issue` ganha `parentNumber Int?` e `hasSubIssues Boolean` (migração `20260720160000_…`). `syncIssues` grava os dois; no fallback REST vêm ausentes → `null`/`false` (raiz/não-épico), board plano íntegro.

3. `feito` — **PR-3 (#100): épico fora das colunas + `getBoard` agrupado + espelho `STATUS.md`.** `isEpic(hasSubIssues)` — épico é estrutural (tem sub-issues), faixa e não card; `getBoard` o exclui das colunas e o expõe em `epics[]` (só os **abertos** — épico fechado some das colunas abertas); cada card carrega `parentNumber`. A projeção `.proplan/STATUS.md` subagrupa por épico em **H3** dentro de cada coluna (`### Título (#N)`, raiz sob `### Sem épico`) — o parser lê só H2, então o round-trip é preservado.

4. `feito` — **PR-4 (#101): swimlane na UI + contagem `fechadas/total`.** Com épicos, o Kanban rende em **faixas** (`KanbanSwimlane`): cabeçalho do épico + grade de células atravessando as colunas; cada filha na coluna real dentro da faixa do seu épico; faixa **"sem épico"** para órfãs. Sem épicos → board **idêntico ao atual** (nenhuma regressão). Drag **inalterado**: o `dropId` da célula é `epicKey:column` e o `onDragEnd` extrai só a coluna — arrastar muda a coluna, **nunca o pai** (leitura apenas). `getBoard` conta filhas por épico; a faixa mostra `fechadas/total` (sem barra, sem rótulo de coluna no épico).

**Dogfooding ao vivo (issues de teste #95/#96):** a faixa **#95** renderiza com `0/1`, o card **#96** cai em **A Fazer** sob ela, o resto na faixa **"sem épico"**. **Duas regressões pegas pelo PI e corrigidas**: (a) Finalizado/Descartado tinham perdido o colapso na swimlane, e (b) o rótulo da coluna se repetia por faixa — agora o cabeçalho de coluna é **sticky** no topo (toggle sempre visível ao rolar) e a célula colapsada vira slot fino só com o contador. **Um teste que não vê a regressão é decoração**: as duas eram visuais e não tinham cobertura unitária — pegas no olho, no board real.

**Piso**: API board **101/101**, web **50/50** (inclui `orderedSwimlanes` e `columnFromDropId`), `nest`+`vite build` limpos. Projeto **não tem ESLint** — o piso real é `test`+`build`. `refs #97` nos 4 PRs, nunca `closes` (ADR-011). `proplan:done` só pós-merge dos 4; aceite/fechar é do PI.

**Aceita pelo PI em 2026-07-20** (#97 fechada + `proplan:finalizado`). O aceite foi precedido do teste que fecha a prova: o PI finalizou a filha **#96** e a contagem da faixa foi de `0/1` para **`1/1`** — o pipeline inteiro (GraphQL → cache → `getBoard` → swimlane) exercitado com dado real. Issues de teste **#95/#96** descartadas em seguida (`proplan:descartado`, com carimbo).

## Kanban — Finalizado ordena por data de finalização — `feito` (decisão do PI 2026-07-20)

Pedido do PI ao vivo, olhando o board. **Emenda à SPEC-005 linha 109**, que fixava *"prioridade, depois `updated_at` desc"* para **todas** as colunas — a spec vigente contradizia o pedido, então a mudança foi ao PI antes de qualquer linha de código (não é correção de bug: o comportamento anterior estava correto por spec).

1. `feito` — **A regra**: **Finalizado** passa a ordenar por `closedAt` **desc** (mais recente primeiro). Numa coluna fechada a prioridade é ruído — o trabalho acabou; o que importa é *quando foi aceito*. **Só Finalizado** muda (decisão do PI): Descartado e as colunas abertas seguem `prioridade + updated_at`.
2. `feito` — **Ordenação em memória**, não uma segunda query: o `getBoard` já faz um `findMany` único e agrupa por coluna; reordenar só a lista de `finalized` depois do agrupamento é menor que ramificar o `orderBy` do Prisma por coluna.
3. `feito` — **Sem `closedAt` não inventa data**: issue *fechada fora do ProPlan* pode não ter `closed_at`; essas caem para o **fim** da coluna preservando a ordem que veio do banco. Comparação por string ISO-8601 (ordena lexicograficamente, sem `new Date()` por item).
4. `feito` — **3 testes, provados contra o bug**: removi o `sort` de propósito → **2 falharam**; restaurei → **8/8** passam. Cobrem: prioridade ignorada em Finalizado, `closedAt` nulo no fim, e colunas abertas **inalteradas** (o teste que impede a mudança vazar para o board de trabalho). API board **104/104**, `nest build` limpo, `reports/TESTS.md` regenerado (Regras 577→**580**).

**Spec emendada** (2026-07-20, autorização explícita do PI ao Code — `docs/specs/` é do Cowork por padrão): a **SPEC-005 linha 109** passou a registrar a exceção de Finalizado (`closed_at` desc, sem `closed_at` vai para o fim, Descartado inalterado). Código e spec voltaram a bater — a divergência durou o intervalo entre o merge do PR #102 e esta emenda, e está datada aqui porque **divergência anotada é dívida; divergência silenciosa é a mentira que este produto existe para detectar**.

## SPEC-027 — Deploy em produção: Railway + Hostinger DNS — `feito` (aguardando merge e passos do PI)

Fatia pós-MVP, sem número no índice. Issue **#103** em `proplan:doing`. Encerra o *"100% local"* do `CLAUDE.md` → **ADR-022**. Escrita antes de codificar: os 5 achados da spec foram **reconferidos no código** (todos confirmados) e 2 achados novos apareceram na implementação — estão nos passos 4 e 8.

1. `feito` — **`GET /health`** (`apps/api/src/health.controller.ts`). Responde `{status:'ok'}` e **não toca Postgres nem Redis de propósito**: o healthcheck decide se a versão nova assume o tráfego, então uma falha transitória de fila derrubaria um deploy são. Liveness ≠ observabilidade (que é fatia própria).
2. `feito` — **Porta e bind** (`main.ts`). Lê `PORT` (injetada pelo Railway) com fallback para `API_PORT`. Além do que a spec pedia: **bind em `0.0.0.0`** — o default do Node no container escuta só loopback e o proxy do Railway não alcançaria o processo. Sem isso o `/health` responderia 200 localmente e 502 em produção.
3. `feito` — **Cookies seguros** (`auth.controller.ts`). `secure` sob `NODE_ENV==='production'`, `sameSite:'lax'` mantido (web e api são subdomínios do mesmo domínio registrável — `SameSite=None` não entra). As flags viraram uma constante compartilhada porque o **`clearCookie` também precisa delas**: o browser só remove um cookie quando os atributos batem com os do `set` — logout com flags divergentes deixaria a sessão viva. 3 testes.
4. `feito` — **Achado fora da spec: a conexão Redis do BullMQ descartava credenciais.** `app.module.ts` montava `{host, port}` a partir da `REDIS_URL`, jogando fora usuário, senha e o scheme `rediss://` (TLS). No docker-compose local funciona (Redis sem auth); contra um Redis gerenciado o worker **não autenticaria** — e o critério de aceite "workers processam em produção" dependia disso. Parse extraído para `shared/redis-connection.ts`, **6 testes**. Corrigido na raiz: o outro call site (`redis.provider.ts`) já passava a URL inteira ao ioredis e estava correto.
5. `feito` — **Dockerfile da api** (multi-stage, contexto na **raiz** do monorepo — o `pnpm-workspace.yaml` e o lockfile vivem lá). `CI=true` porque sem TTY o pnpm aborta ao recriar `node_modules` no `install --prod`.
6. `feito` — **Dockerfile do web**: build Vite servido por **nginx**, com `try_files … /index.html` (fallback SPA) e cache longo só nos assets com hash. `VITE_API_URL` entra como **build arg** — é resolvida em build, não em runtime; trocar a URL da API exige rebuild.
7. `feito` — **`bootstrap-app-role.mjs`**: cria/atualiza a role não-owner `proplan_app` (o init do Docker que a cria no dev **não roda** no Postgres gerenciado). Idempotente. Termina **verificando** que a role não tem `rolsuper`/`rolbypassrls` e **falha** se tiver — é a guarda contra o risco #1 da fatia: rodar como owner desliga o RLS **sem erro visível**, e o vazamento multi-tenant passaria despercebido.
8. `feito` — **Causa raiz do primeiro deploy quebrado, achada nos logs do Railway** (não estava na spec): o build rodava `nest build` **sem `prisma generate` antes**. Sem o client gerado o `PrismaService` não tem model nenhum → **285 erros `TS2339: Property 'x' does not exist on type 'PrismaService'`**. Não era bug de código: era passo faltando. O `generate` é explícito no Dockerfile (o pnpm ignora scripts de dependências) e roda **duas vezes** — antes do build e de novo após o `install --prod`, que recria `node_modules` e leva o client junto.
9. `feito` — **`prisma` passou de devDependency a dependency**, e `start:prod` de `dist/main.js` para **`dist/src/main.js`**. Os dois foram descobertos executando, não lendo: o release command roda `migrate deploy` na imagem de runtime (onde devDeps não existem), e o `tsconfig` inclui `test/`, então o tsc preserva a estrutura de pastas e o entrypoint não cai na raiz do `dist`.
10. `feito` — **Verificação real, não só unitária.** As duas imagens foram construídas e executadas: container da api na rede do compose → **`/health` respondeu `{"status":"ok"}` HTTP 200** com `PORT=7777`; `./node_modules/.bin/prisma migrate deploy` rodou da imagem de runtime e falhou **só** por P1001 (banco inexistente), provando que o release command acha o schema e **aborta o deploy** quando a migração falha; container do web → `/` **200** e rota profunda `/t/acme/projects/xyz/board` **200** (fallback SPA), com `api.proplan.rrbtrading.com.br` confirmada dentro do bundle.
11. `feito` — **Provisionamento**: **Postgres** e **Redis** criados no projeto Railway (deploy SUCCESS); `@proplan/api` com `DIRECT_URL`/`REDIS_URL` (reference variables), `NODE_ENV`, `FRONTEND_URL`, `API_URL`; `@proplan/web` com `VITE_API_URL`. **Nenhum segredo foi definido pelo Code** — são do PI (spec §Processo).
12. `feito` — **`@proplan/mcp` não vai para o Railway.** A SPEC-016 §75 define o MCP como processo **local (stdio)** e o código confirma (`StdioServerTransport`): não escuta porta HTTP, então nenhum Dockerfile o faria funcionar — o container subiria sem interlocutor e morreria no healthcheck. O serviço nasceu de autodetecção do monorepo. **Remoção exige 2FA no dashboard** — fica para o PI.
13. `feito` — **Piso**: API **608/608** (93 suites), web **50/50**, `pnpm build` limpo. Documentos atualizados junto da entrega: `CLAUDE.md`, `ARCHITECTURE.md` (banco Supabase → Railway), `DECISIONS.md` (**ADR-022**), `STATUS.md`, `DEPLOY.md` (§2, §3, §5 e nova §11 com o estado do provisionamento).

**Fora de escopo, respeitado**: Supabase (reservado, sem código), webhook do GitHub, staging/preview, observabilidade e migrations destrutivas.

**O que trava a produção subir de fato** (só o PI pode, não é possível por token de API): remover o serviço `mcp` · preencher os segredos nas Variables · rodar `pnpm bootstrap:role` e gravar a `DATABASE_URL` de runtime · CNAMEs na Hostinger + custom domains no Railway · Callback URL do GitHub App. Lista operacional em `docs/DEPLOY.md` §11.

### Subida real em produção (2026-07-22, após o merge do PR #104)

O que só apareceu ao subir de verdade — e não estava previsto nos 13 passos:

14. `feito` — **A config gravada no serviço vence o `railway.json` do repo.** Depois do merge, o build da api **continuou falhando com os mesmos 285 erros TS2339**: o serviço tinha `buildCommand: pnpm --filter @proplan/api build` gravado nas settings (herdado da autodetecção), então o Dockerfile era ignorado e o `prisma generate` nunca rodava. Limpar `buildCommand`/`startCommand` e apontar `dockerfilePath` resolveu — o build passou na primeira tentativa seguinte.
15. `feito` — **O mesmo mecanismo, mais grave: deploy verde com o banco vazio.** Ao limpar os comandos acima, o `preDeployCommand` também ficou `null`. Resultado: o deploy deu **SUCCESS**, a API subiu, e o banco tinha **zero tabelas** — o `prisma migrate deploy` nunca rodou e **nada sinalizou**. Aplicadas as 26 migrations à mão, `preDeployCommand` restaurado, e o redeploy seguinte provou o caminho: log mostra `26 migrations found` → `No pending migrations to apply.` **antes** do `Nest application successfully started`. **Um release command ausente é pior que um que falha** — falha aborta o deploy; ausência deixa o deploy passar mentindo. Registrado na tabela de recuperação do `DEPLOY.md` §10.
16. `feito` — **Critério de aceite #5 verificado em produção** (o guarda contra vazamento multi-tenant): banco com **20 tabelas, 26 migrations, 15 com RLS ativo**; `proplan_app` com `rolsuper=false`, `rolbypassrls=false` e grant nas 20 tabelas — o `ALTER DEFAULT PRIVILEGES` cobriu as criadas depois da role. `DATABASE_URL` aponta para `proplan_app`; `DIRECT_URL` (owner) fica só para migrations.
17. `feito` — **Segredos gerados pelo Code**: `JWT_SECRET` e `TOKEN_ENCRYPTION_KEY` (hex 32 bytes) e a senha da `proplan_app`, gravados direto nas Variables do Railway e apagados do disco local. As credenciais do **GitHub App** e as chaves de **IA** seguem com o PI — o Code não as inventa (spec §Processo).

**Estado**: api e web `SUCCESS`, Postgres e Redis Online, `@proplan/mcp` removido. Falta para o produto funcionar ponta a ponta: credenciais do GitHub App, chave de IA, CNAMEs na Hostinger e a Callback URL do App. Lista em `docs/DEPLOY.md` §11.

## Correção — primeiro acesso num banco limpo não criava Tenant, e `addProject` escrevia fora do contexto — `feito` (achado no dogfooding de produção, 2026-07-22)

Dois bugs **da SPEC-022**, não da SPEC-027, que só apareceram no primeiro banco que nasceu vazio. O deploy estava correto — foi ele que os expôs. Não precisam de spec nova: o comportamento certo já está escrito na SPEC-022 (decisões 1 e 3, linhas 30/31/135), e o próprio texto da emenda E2 **já registrava o furo**: *"nada no código cria `Tenant`/`Membership`; ambos vêm do backfill da migration"*.

**Sintoma**: `POST /catalog/projects` → 500. Nos logs, `42501: new row violates row-level security policy for table "projects"`.

1. `feito` — **Bug 1: nenhum código criava `Tenant`/`Membership`.** Eles só nasciam do backfill da migration da Fatia 8, que converteu os dados que **já existiam** no dev. Banco novo não tem o que converter ⇒ usuário loga sem tenant ⇒ `app.tenant_ids` vazio ⇒ o RLS barra **toda** escrita. `relinkTenants` só faz `UPDATE`; `RoleSyncService` só recalcula papel; ninguém criava. **Correção**: `MembershipService.ensureTenants()` (no `identity`, porque `Membership` é autorização — o `catalog` não pode conhecê-lo, ADR-001), chamado no `listInstallations` **depois** do re-liga. Papel na criação segue a decisão 3: conta pessoal (`User`) → `owner` sem consultar o GitHub; org → nasce `member` (piso seguro) e o `RoleSyncService` promove no mesmo request se a pessoa for admin. Nascer `owner` numa org daria privilégio a quem talvez não o tenha.
2. `feito` — **Bug 2: `addProject` escrevia fora do contexto de tenant.** Criava o `Project` **sem `tenantId`** e **fora do `withTenant`**. A policy de `projects` é `tenant_id = ANY(app.tenant_ids)` e — sem `WITH CHECK` próprio — vale também para o INSERT: `NULL = ANY(...)` é falso, INSERT rejeitado **sempre**. Nunca apareceu no dev porque lá os projetos vieram do backfill com `tenant_id` preenchido. **Correção**: resolve o tenant pelo `installationId` (relação 1:1, já no corpo da request — sem mudar o contrato da API nem o front), confere que o usuário tem membership nele, grava `tenantId` e roda o upsert sob `withTenant`.
3. `feito` — **`tenantIds` recarregado após o `ensureTenants`**: o array era lido no início do `listInstallations` e, no primeiro acesso, estaria vazio quando o `applyReconcile` fosse escrever — a correção só valeria a partir da 2ª abertura do catálogo.
4. `feito` — **Fail-closed no membership**: só entra membership de tenant cuja instalação/conta o usuário **enxerga**. Um tenant alheio que vazasse na consulta não pode virar acesso — tem teste.
5. `feito` — **9 testes, provados contra o bug**: troquei o papel para `'owner'` fixo → **2 falharam**; restaurei → 9/9. Cobrem: cria tenant+membership; `User` vira owner; org vira member; idempotência; **reinstall não duplica** (casa por conta, não por instalação — duplicar orfanaria os dados); usuário novo em tenant existente; tenant alheio ignorado; sem instalações não toca o banco; várias instalações → um tenant por conta.
6. `feito` — **Piso**: API **617/617** (94 suites), web 50/50, E2E 52/52, build limpo. `reports/TESTS.md` regenerado (Regras 590→**599**).

**O que já foi feito à mão em produção** (destravar o PI antes do merge): `Tenant` da conta `RodReis` (instalação 147870965) + `Membership` `owner`, inseridos direto no banco. O `ensureTenants` é idempotente — reconhece esse tenant e não duplica.

**Nota de método**: o `42501` é o RLS **funcionando**. O risco #1 da SPEC-027 era o oposto — RLS virar no-op silencioso por a app conectar como owner. Aqui ele barrou a escrita errada e produziu um erro visível, que é exatamente o comportamento desejado de uma barreira de segurança.

### Emenda — o mesmo bug em dois call sites que eu não tinha varrido (2026-07-22)

O PR #105 corrigiu o `addProject`, mas **não a classe do bug**. O 500 virou **404 "Projeto não encontrado"** — com o projeto recém-criado no banco.

7. `feito` — **Causa**: o `addProject` grava sob `withTenant`, mas chamava `enqueueSync` **fora** dele. O `enqueueSync` valida o id lendo `projects` (tabela escopada): sem contexto, o RLS não devolve a linha e ele lança `NotFoundException`. A transação do upsert já tinha commitado ⇒ **projeto criado, sync nunca enfileirado** (`syncRuns: 0` no banco de produção, com o projeto lá).
8. `feito` — **`removeProject` tinha o mesmo defeito**, ainda não manifestado: `deleteMany` no client base numa rota global não casaria linha alguma → 404 com o projeto existindo. Corrigido junto — foi a varredura que o achou, não um relato.
9. `feito` — **A regra que faltava estar escrita**: rota `/t/:tenant/...` passa pelo `TenantContextInterceptor`, que abre o contexto e o expõe via `AsyncLocalStorage`; lá `this.prisma.project` é roteado ao `tx` pelo Proxy do `PrismaService` — **é legítimo**. O `catalog` é rota **global** por decisão (ADR-020): sem tenant na URL, sem interceptor. Nele, todo acesso a tabela escopada precisa abrir o seu próprio `withTenant`. `freshness` **não** foi tocado: apesar de morar no `CatalogService`, sua rota é escopada.
10. `feito` — **Teste de arquitetura** (`global-route-scope.arch.spec.ts`), no padrão do `tenant-scope.arch.spec.ts`: varre os métodos de rota global do `CatalogService` e falha se algum tocar model escopado pelo client base; e exige o `enqueueSync` dentro de `withTenant`. Provado contra o bug: reintroduzi os dois defeitos → **2 falharam**; restaurei → 2/2. É o que impede a próxima rota global de repetir isto.
11. `feito` — **Piso**: API **619/619** (95 suites), build limpo. `reports/TESTS.md`: Regras 599 → **601**.

**Lição de método, que é o ponto**: no PR #105 eu li o call site que doeu e corrigi só ele. `enqueueSync` e `removeProject` estavam a poucas linhas dali. Bug de RLS não se conserta no call site que apareceu — se conserta varrendo quem mais escreve na mesma condição, e travando a regra com teste. O 404 foi o preço de não ter feito isso da primeira vez.

### Verificação em produção — pipeline completo (2026-07-22, após o deploy do PR #108)

Fecha o último item em aberto da issue #109 e o **critério de aceite #4 da SPEC-027** (login GitHub ponta a ponta), o único que o Code não conseguia provar sozinho — exige um humano autenticando no browser.

Estado do banco de produção depois do PI marcar o `rrb-proplan` no catálogo:

```
projetos: rrb-proplan | todos com tenant: true
syncRuns: 1 → success (12:36)
documentos ingeridos: 64
issues (cache do board): 44
insights (IA): 2
```

O que cada número prova, em cadeia:

- **`syncRuns: 1 → success`** — o `enqueueSync` volta a enfileirar. Era exatamente isto que o 404 impedia: o projeto nascia e o sync nunca era criado.
- **64 documentos** — a ingestão leu `docs/` do repo-alvo via Trees/Contents API (ADR-003: nunca clona).
- **44 issues** — o board montou o cache a partir das GitHub Issues (ADR-011).
- **2 insights** — a `ANTHROPIC_API_KEY` está operante e a inferência versionada roda em produção.
- **`todos com tenant: true`** — o `tenantId` é gravado no INSERT (PR #105) e o RLS deixa passar.

**Dogfooding real**: o board do ProPlan em produção renderizou as próprias entregas do dia — #103, #106 e #109 em Finalizado. O produto exibindo o próprio ciclo de vida é o teste de aceite mais honesto que esta fatia podia ter.

**Critérios da SPEC-027 — todos verificados**: SPA com fallback (1) · `/health` 200 (2) · migration antes do tráfego (3) · **login ponta a ponta (4)** · RLS com role não-owner (5) · workers BullMQ com o Redis do Railway (6, provado pelo sync) · documentos atualizados (7–10).

**Pendência de operação, não de código**: rotacionar o `POSTGRES_PASSWORD` — foi exposto em texto claro durante o setup.

**Write-back provado junto**: o commit `d7e30b7` em `.proplan/STATUS.md` foi feito por **`rrb-proplan[bot]`** — a projeção do board gerada em produção, listando as próprias issues #106 e #109 como finalizadas. Prova o installation token do ADR-015 (escrita com identidade de bot) e o ADR-011 (projeção em `.proplan/`, nunca em `docs/`), sem nenhum teste artificial: o produto escreveu no repo por conta própria.

## FIX #113 — `$transaction` em lote quebra sob `runInTenantContext` — `feito`

Bug de **produto**, não de teste. Achado pelo `--check` do ADR-019 no CI do PR
#112 (`Banco 18|17|1`) e **confirmado em produção pelo PI**: o painel de
Atividade mostrou `Sincronização falhou: Invalid prisma.documentResolution.createMany()
invocation: Unique constraint failed`.

Sem spec: o comportamento correto já está no `ARCHITECTURE.md` → Resiliência
(invariante do `withTenant`) — bug documentado pela tabela do `CLAUDE.md`.

### O defeito, provado por SQL

Com `log_statement='all'` no Postgres, o `$transaction([deleteMany, createMany])`
dentro de `runInTenantContext`:

```
[41969] set_config('app.tenant_ids', …)   ← contexto na conexão 41969
[41968] INSERT INTO document_resolutions  ← INSERT na 41968
[41968] COMMIT
[41969] DELETE FROM document_resolutions  ← DELETE na 41969, DEPOIS
[41969] COMMIT
```

PIDs distintos = conexões distintas. **Não é uma transação, são duas**, e a
ordem inverteu: o INSERT commitou antes do DELETE. Quando o INSERT ganha a
corrida, colide no unique `(project_id, entity)` e o sync morre.

**Causa**: o client estendido (`$allOperations`) embrulha cada operação na sua
própria `$transaction([set_config, query])`. Esses `PrismaPromise` já-construídos
não se fundem ao lote externo — cada um executa por conta própria.

### Tentativa descartada

Carimbar a intenção (`{model, operation, args}`) na promise e refazer a operação
no client base. **O Prisma reembrulha o retorno do `$allOperations` e a marca não
sobrevive** (`TEM_MARCA: false`). Revertida.

### A correção

`$transaction` **interativo** nos seis call sites de replace-all — `resolution`,
`canonical`, `context`, `link`, `board`, `inferred-links`. O `tx` do callback é
**uma** conexão para as duas operações, na ordem escrita.

Não recai no problema que o PR #86 corrigiu: lá o defeito era segurar a transação
pelo **job inteiro**, com chamadas de rede dentro. Aqui é delete+insert puro,
milissegundos.

O Proxy do `PrismaService` passou a injetar o `set_config` **também** na forma
interativa. O comentário antigo afirmava que o `tx` "já roda na conexão do
contexto" — era **falso**, e passou despercebido porque nenhum call site usava
essa forma dentro de um contexto de tenant.

### Verificação

- Teste novo (`worker-context.int-spec.ts`) que **falha sem o fix** — confirmado
  rodando com o `prisma.service.ts` em stash.
- SQL depois do fix: `[43366] DELETE` → `[43366] INSERT`, **mesma conexão, ordem
  certa**, nas duas rodadas do `rebuild`.
- **620 testes** na API (+1), 50 na web, build verde.

### Nota — o mock que escondia o bug

Os seis fakes de `$transaction` só entendiam a forma em array, então um call site
que quebraria em produção passava no teste. Extraí `test/prisma-transaction-mock.ts`,
que suporta as duas formas, e todos os specs passaram a usá-lo. **Mock frouxo é
o que deixou este bug viver** — a nota está no `ARCHITECTURE.md`.
## SPEC-026 — Costura identidade ⊥ conexão — `em andamento` (issue #94)

Spec `aprovada-pi` (2026-07-20). Frente pós-MVP1, sem número de fatia.
**REFATORAÇÃO** do módulo `identity`, que já existe e é robusto: hoje a
identidade **é** o GitHub App — o `userToken` do OAuth do App é a própria sessão.

**Este é o PR-1: a porta de entrada.** A sessão passa a derivar do IdP; o resto
da costura (entidade `Connection`, IdP fake, CTA no catálogo) vem depois.

### Passos

- [x] **Schema — `User` deixa de ser uma conta GitHub**: `githubId` vira
      **nullable** e entram `googleId` (o `sub` do OpenID — estável mesmo se o
      usuário trocar o email) e `email`, ambos `@unique`. Migration
      `20260725160000_spec_026_identidade_google`, **sem backfill**: as linhas
      existentes já têm `github_id` e ganham `google_id` no primeiro login.
- [x] **`GoogleOauthClient`** (`infrastructure/`): `authorizeUrl` /
      `exchangeCode` / `fetchUser`, escopos `openid email profile`. **Não guarda
      token do Google** — ele serve para ler o perfil uma vez e montar a sessão;
      o ProPlan não pede acesso a nada da conta Google além de identificar a
      pessoa. `email_verified: false` é recusado (ver abaixo).
- [x] **`AuthService.handleGoogleCallback`**: três casos, nesta ordem —
      `googleId` conhecido → mesmo usuário · `googleId` novo mas **email já
      existe** → é o usuário pré-existente migrando, carimba `googleId` na linha
      que já tem projetos/tenants · nenhum → conta nova, **sem conexão**.
- [x] **Rotas `/auth/google` e `/auth/google/callback`** (`auth.controller.ts`),
      espelhando o state anti-CSRF e as flags de cookie do fluxo GitHub.
      **`/auth/github` fica intacto** — deixa de ser identidade e vira a porta
      da *conexão* (o front passa a chamá-lo de dentro do painel, na #93).
- [x] **Web — `Login.tsx`**: CTA "Entrar com Google" (`api.googleLoginUrl`) e a
      caixa de contexto reescrita para dizer que **entrar ≠ conectar**. O
      `GithubIcon` saiu daqui junto com o CTA antigo — não virou código morto.
- [x] **8 testes** (`google-login.spec.ts`), sendo **3 sobre a migração** — o
      critério caro da spec. O e2e da tela passou a ancorar no CTA do Google.
- [x] **Docs**: `ARCHITECTURE.md` → Identity reescrito para conta ⊥ conexão
      (era *"GitHub App = Identity"*), este arquivo e o `STATUS.md`.
- [x] **Entidade `Connection`** — mover `userToken`/`installationId`/
      installation-token do `User` para lá. **PR seguinte, de propósito**: fazer
      junto com a troca de IdP dobraria o raio de risco sobre o
      `github-auth.service`, que é o caminho de **toda leitura** (ADR-015).
      **Feito na SPEC-025** (issue #93), que precisava dela como fundação —
      ver a seção abaixo. `installationId` **ficou onde estava**: ele mora no
      `Project`, não no `User`, e movê-lo não era pré-requisito de nada aqui.
- [x] **CTA "conectar GitHub" no catálogo** — entregue na SPEC-025 (card de
      conexão). O **IdP fake no dev** segue pendente: não bloqueia ninguém
      enquanto as chaves reais do Google funcionam no local.
- [x] **Dogfooding com as chaves reais do PI** — **feito em 2026-07-25, local.**
      O PI entrou com Google e caiu no Catálogo autenticado. A migração foi
      verificada **no banco, não na tela**: `users` continua com **1 linha**, o
      **mesmo `id`** (`ca08cd44…`), `google_id` carimbado, `github_id` 80895
      preservado, `login` `RodReis` intacto — e **8 projetos / 1 tenant / 1
      membership** onde estavam. É a prova de que o caso 2 rodou (migrou) em vez
      do caso 3 (conta nova).
- [x] **Produção** (`proplan.rrbtrading.com.br`) — migration no release do
      `ffa4273`, `UPDATE` do email pelo PI antes do 1º login, migração casada
      (1 row com `github_id` **e** `google_id`), 8 projetos no catálogo. Dois
      erros de config no caminho → FIX **#123** (mergeado, #124) e cadastro do
      redirect URI no Console. Detalhes em *Verificação*.
- [ ] **Preencher `email` de quem já existe** — ver *Por que o email precisa ser
      verificado*. Hoje depende de `UPDATE` manual (feito no local e em
      produção); a solução geral é a issue **#122** — buscar `GET /user/emails`
      no login GitHub, decidido pelo PI.

### Por que o email precisa ser verificado

A migração casa por **email**, e é ela que entrega os projetos e tenants da conta
antiga a quem loga. Sem exigir `email_verified`, qualquer um criaria uma conta
Google com o email de outro e herdaria o acesso — a chave de casamento viraria a
porta de invasão. Por isso a recusa mora no `fetchUser`, antes de qualquer
consulta ao banco: o perfil não confiável nunca chega a ser comparado.

O usuário antigo tem email gravado? **Em geral não** — e o dogfooding provou que
esse é o caso comum, não a exceção. A coluna `email` nasceu nesta migration e o
login GitHub nunca a preencheu; pior, `GET /user` devolve `email: null` para
quem mantém o email privado no perfil (o caso do próprio PI: as contas Google e
GitHub são o **mesmo** endereço, e ainda assim o GitHub não o expõe).

Consequência prática: sem `email` na linha, o caso 2 não dispara e o usuário
pré-existente cai no caso 3 — conta nova, projetos e tenants órfãos na linha
antiga. **Não é perda de dados** (nada é apagado), mas é perda de acesso até o PR
da `Connection`.

No banco local isso foi resolvido com um `UPDATE users SET email = …` antes do
primeiro login. **Não serve como solução geral** — está anotado nos passos como
pendência: ou o `handleCallback` do GitHub passa a buscar `GET /user/emails`
(exige o escopo de email na instalação do App e devolve o primário mesmo quando
privado), ou a costura da `Connection` casa por outro critério. Decisão do PI.

### Verificação

`tsc --noEmit` limpo na API e na web · **API 675 testes** (100 suítes, +8 meus) ·
**web 67** · `vite build` verde · `reports/TESTS.md` regenerado (ADR-019):
Regras 656 · Banco 19 · Tela 69, **zero falhas**.

**Dogfooding local (2026-07-25)**: login Google ponta a ponta com as chaves
reais. `/auth/google` → 302 com `client_id` preenchido, `redirect_uri` casando
o cadastro do Console, escopos `openid email profile` e state anti-CSRF em
cookie `HttpOnly` espelhado na URL. Consentimento no browser → Catálogo
autenticado, e o banco provando a migração na mesma linha (acima).

**Produção verificada (2026-07-25)** — `https://proplan.rrbtrading.com.br`.
Migration aplicada no release do commit `ffa4273` (deploy `fd09d201`, SUCCESS).
O PI rodou o `UPDATE` do email **antes** do primeiro login, e a migração casou:

```
id                                    login   github_id  google_id            email
14070176-c0d2-4762-8df1-25b55042485f  RodReis 80895      102835572885821409668 rodreisb@gmail.com
1 row
```

**1 row** com `github_id` **e** `google_id` na mesma linha — nenhuma conta nova.
Os 8 projetos aparecem no catálogo. Note que o `id` difere do banco local:
bancos distintos, mesma prova.

**Dois erros de configuração no caminho, ambos só visíveis em produção** — e o
primeiro virou o FIX #123:

1. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` **não existiam** no serviço
   `@proplan/api` do Railway (eu documentei no `DEPLOY.md` e não cadastrei).
   Com `?? ''`, a API mandava o usuário ao Google com `client_id` vazio →
   `Erro 400: invalid_request`, tela do Google que parece problema da conta.
   Corrigido no #124: config ausente falha na API, nomeando a variável.
2. O redirect de produção (`https://api.proplan.rrbtrading.com.br/auth/google/callback`)
   não estava nos *Authorized redirect URIs* do OAuth client →
   `Erro 400: redirect_uri_mismatch`. Cadastro no Console, ação do PI.

O `DEPLOY.md` lista as duas variáveis; o `README.md`, o redirect. Ambos os
passos existiam na doc e ainda assim escaparam — **documentar não é
configurar**.

**O que o dogfooding expôs e a suíte não pegava**: o usuário pré-existente tinha
`email` NULL, então o casamento por email — o caminho que os testes cobrem —
estava **morto na prática**. Só apareceu ao olhar a tabela antes de logar. O
teste não errou: ele prova a função dado um email; o que faltava era o dado.
Vale como método — testar a lógica não substitui inspecionar o estado real
**antes** de rodar uma migração de uma via.

## SPEC-025 — Desconectar / reconectar o GitHub — `em andamento` (issue #93)

Spec `aprovada-pi` (2026-07-20). 2ª da Frente Identidade, pós-MVP1, sem número
de fatia. Rege o **ADR-021**.

**A spec dizia "sem modelo novo — a conexão já é entidade separada na
SPEC-026". Não era.** A SPEC-026 entregou a troca de IdP (PR-1) e deixou a
entidade `Connection` explicitamente para o PR seguinte; os tokens continuavam
no `User`. Sem essa separação, *desconectar* não teria como não ser *deslogar* —
que é a razão de existir desta fatia. Por decisão do PI (2026-07-25), a
`Connection` foi **absorvida aqui** em vez de virar um PR à parte da #94.

### Passos

- [x] **Entidade `Connection`** (`schema.prisma`): `userId` + `provider` +
      os três campos de token, com `@@unique([userId, provider])` — *1:N no
      schema, 1 na UI* (SPEC-026). `provider` é texto livre e hoje só vale
      `"github"`: GitLab/Jira/Notion entram sem migration, costura dormente.
      Desconectar **deleta a linha** em vez de marcar inativa — token revogado
      não tem valor guardado, e ausência é estado mais simples que uma linha
      morta com campos nulos.
- [x] **Migration `20260725190000_spec_025_connection`** — cria a tabela,
      **copia os tokens de quem já existe** e só então derruba as três colunas
      do `users`. O `INSERT` do meio é o ponto crítico: sem ele, todo usuário
      perderia o token no deploy e teria de reconectar (o PI tem 8 projetos).
- [x] **`github-auth.service` lê da `Connection`** — o caminho de **toda
      leitura** (ADR-015). Ausência de conexão virou `UnauthorizedException`
      tratada, não `TypeError` ao ler campo de `null`: depois de desconectar (ou
      numa conta nascida do Google) a linha simplesmente não existe, e isso é
      resposta legítima.
- [x] **`handleCallback` ganhou dois papéis**: com `userId` (sessão viva) →
      **conecta** o GitHub à identidade logada; sem `userId` → **login legado**
      pelo GitHub, como antes da SPEC-026. Conectar carimba só o `githubId`; o
      `login`/`name` da sessão não são sobrescritos — quem manda no rótulo é o
      IdP, não a conexão.
- [x] **`GithubOauthClient.revoke`** — `DELETE /applications/{client_id}/grant`,
      que derruba **a concessão inteira** (access + refresh). O irmão `/token`
      invalidaria só o access e deixaria o refresh vivo: quem "desconectou"
      seguiria renovável. Revogação real é o que honra *"seus dados continuam
      seus"* da spec. 404 (concessão já inexistente) não é erro — o fim
      desejado já vale.
- [x] **`POST /auth/connections/github/disconnect`** e
      **`GET /auth/connections/github`**. O disconnect **não** limpa o cookie de
      sessão, de propósito: é a linha que separa desconectar de deslogar.
      Revogação é *best-effort* — se o GitHub recusar, a conexão cai localmente
      mesmo assim, senão o usuário ficaria preso a algo que mandou remover.
- [x] **Web — card de conexão no Catálogo** (posição e layout do mockup do PI,
      2026-07-25, adaptados aos tokens do `DESIGN.md`): selo Ativo/Desconectado,
      botão **Desconectar** vermelho, e o CTA **Conectar GitHub** quando não há
      conexão — a única porta de volta.
- [x] **Web — rota `/settings`** (`SettingsPage.tsx`), com **Tema · Conta ·
      Conexões**. Página, não modal: o `Settings.tsx` existente é um modal aberto
      pela Sidebar do *workspace*, e desconectado não há workspace de onde
      abri-lo — que é exatamente quando se precisa dela. Traz a distinção que a
      spec §6 pede: **Desconectar GitHub** (vermelho) × **Sair da conta**
      (neutro), e o link externo para desinstalar o App no github.com.
- [x] **Web — cards read-only com selo "GitHub desconectado"**. A fonte é o
      **índice local** (`/catalog/projects`, só banco), não
      `/catalog/installations` — este é leitura no GitHub e devolveria 401 sem
      conexão, que a UI leria como falha. É a "memória preservada" da spec §4.
- [x] **`catalogView` como função pura + 5 testes**: o repo testa lógica pura,
      não mocka a `api`. O erro que ela barra é tratar *desconectado* como
      *vazio* — os dois chegam com `groups: []` e pedem telas opostas
      (reconectar × instalar o App).
- [x] **14 testes na API** (`github-connection.spec.ts` + o caso "sem conexão"
      no `github-auth.service.spec.ts`), cobrindo revogação real, sessão que
      sobrevive, falha do GitHub, reconectar sem duplicar linha.
- [x] **`reports/TESTS.md` regenerado** (ADR-019) — a contagem mudou e o CI
      barra divergência. **O relatório acompanha o PR que muda a contagem**: os
      11 testes da API entram no PR-1, então é lá que o número confere; commitar
      só no PR-2 fez o CI do PR-1 falhar (a guarda roda por PR, isolado).
- [x] **Desconexão verificada em runtime** — ver *Verificação*.
- [ ] **Dogfooding no navegador** — pendente (as telas nunca foram abertas).

### Verificação

`tsc --noEmit` limpo na API e na web · **API 689 testes** (102 suítes, +14
meus) · **web 72** (+5) · `vite build` verde · e2e (2) passando.

`reports/TESTS.md` regenerado: **Regras 670 · Banco 19 · Tela 74**, zero
falhas. As categorias do relatório agregam diferente do total bruto do runner —
Banco é subconjunto das suítes da API (670 + 19 = 689) e Tela soma os 72 do
vitest com os 2 do Playwright.

**Migration validada no banco local** (o mesmo do dogfooding do PI, com 8
projetos): antes, `users` com token; depois, `connections` com **1 linha**
(`provider=github`, access e refresh migrados, `token_expires_at` preservado) e
os **8 projetos intactos**. Rotas novas respondem **401 sem cookie** e
`{"connected":true}` com sessão real.

**Desconexão exercitada de ponta a ponta (2026-07-25, API local + sessão real do
PI)** — o critério central da spec, provado fora do teste unitário:

| passo | resultado |
|---|---|
| `GET /auth/connections/github` antes | `{"connected":true}` |
| `POST …/disconnect` | `{"connected":false}` |
| `GET /auth/me` **depois** | a sessão responde íntegra — **desconectar ≠ deslogar** |
| `GET /catalog/projects` | **8 projetos** — a memória que vira os cards read-only |
| `GET /catalog/installations` | **401** — nenhuma leitura no GitHub em nome dele |
| banco | `connections` **0** · `projects` **8** · `users` **1** |

A linha da conexão foi deletada e nada mais se moveu.

**Produção verificada pelo PI (2026-07-25)** — `proplan.rrbtrading.com.br`.
Deploys **SUCCESS** nos dois serviços: API no `44fdd84` (PR-1, que carrega a
migration) e web no `aaee6bc` (PR-2). O PI confirmou *"produção ok, tudo
funcionando"*, com o Kanban carregando normalmente.

**É o Kanban que prova o backfill.** A migration é de uma via — derruba três
colunas do `users` — e o board lê o GitHub com o `userToken`, que agora só
existe dentro da `Connection`. Cards renderizando em produção significa que o
token foi copiado antes do `DROP COLUMN`: se o `INSERT` tivesse falhado, a
leitura cairia em 401 e o board viria vazio. Diferente da SPEC-026, esta
migration não precisou de nenhum `UPDATE` manual antes do deploy.

Fatia **aceita e finalizada pelo PI** na mesma data (issue #93 `closed` +
`proplan:finalizado`).

**O que ficou sem exercitar**: o **reconectar** (refazer o OAuth pelo CTA sem
reinstalar o App) é o único critério da spec que ninguém rodou — nem por API,
nem por tela. O caminho é o `/auth/github` que já existia antes desta fatia,
mas o papel novo dele (conectar com sessão viva, em vez de logar) só tem
cobertura de teste unitário.

## SPEC-028 — URLs legíveis: slug em vez de UUID — `em andamento` (issue #107)

Spec `aprovada-pi` (2026-07-22), incluindo os esclarecimentos de implementação
(módulo, teste de arquitetura, 404×403) que o Cowork acrescentou depois de eu
levantar os dois pontos. Fatia pós-MVP, sem número. **Zero migration.**

De `/t/00000000-…/p/402e31cc-…/kanban` para `/t/rodreis/p/rrb-proplan/kanban`.

### Passos

- [x] **API — `resolveSlugs`** (`catalog.service.ts`): traduz `(tenant, project)`
      — slug **ou** uuid — nos ids canônicos. Rota **global** (ADR-020): abre o
      próprio `withTenant`, como `listProjects`/`removeProject`. O universo de
      busca é o array de membership do usuário autenticado, então tenant alheio
      **some** antes do casamento em vez de ser negado depois.
- [x] **API — `GET /resolve`** (`resolve.controller.ts`): só `JwtAuthGuard`. Sem
      `TenantGuard`/`TenantContextInterceptor` — não há `:tenant` no path para
      eles resolverem; é o que o endpoint existe para descobrir.
- [x] **Teste de arquitetura estendido**: `resolveSlugs` entra em
      `GLOBAL_METHODS` do `global-route-scope.arch.spec.ts`. Sem isso, um acesso
      futuro via `this.prisma.project` passaria despercebido e o RLS morderia em
      silêncio (fail-closed fora de contexto).
- [x] **9 testes** (`resolve-slugs.spec.ts`), com dois que travam o desenho:
      *resolve por UUID depois do rename* (prova que a identidade é o id, não o
      slug) e *projeto de outro tenant não resolve sob o tenant da URL* (prova
      que o contexto aberto é o do tenant resolvido, não o array inteiro).
- [x] **Web — `ResolveRoute`**: resolve no mount (deep-link/F5), fixa
      `setActiveTenant(tenantId)` com o **id** e reescreve a URL para a forma
      canônica (`history.replace`) quando se entra por UUID ou com caixa
      diferente. É o antigo `TenantSync` com a tradução na frente.
- [x] **Web — rotas por slug**: `App.tsx` (`/t/:tenant/p/:project/:tab`),
      `WorkspaceRoute` (recebe os ids resolvidos, navega por slug) e `Catalog`
      (abre já na forma canônica, sem passar por UUID).
- [x] **Docs**: `ARCHITECTURE.md` → Comunicação (roteamento: slug na URL, id no
      contrato), este arquivo e o `STATUS.md`.
- [ ] **Dogfooding no navegador** — bloqueado: `pnpm dev` não sobe porque o
      `.env` da raiz tem `DIRECT_URL` com placeholder do Railway
      (`${{Postgres.RAILWAY_PRIVATE_DOMAIN}}`), que o docker compose rejeita.
      Ambiente local do PI; não editei (credencial de produção).

### Nota — a nota da SPEC-022 §4 não é minha

O Escopo 6 da SPEC-028 pede uma nota de refinamento na SPEC-022 §4. **Não a
escrevi**: `docs/specs/` é do Cowork, e o Code gravar ali sobrescreveria edições
do PI. Fica registrado aqui como pendência de quem tem a caneta.

### Verificação

`tsc --noEmit` limpo na API e na web · **API 628 testes** (+27 na sessão, 9
meus) · **web 50** · `pnpm build` verde. Nenhuma migration no diff.

## Correção — combo não trocava de projeto (issue #115)

O dogfooding que faltava na SPEC-028 aconteceu em 2026-07-22 e **encontrou uma
regressão dela**: trocar de projeto pelo combo da sidebar não funcionava — a URL
"piscava e voltava" para o projeto anterior.

Comportamento correto já documentado ⇒ correção, não fatia. Fonte: **SPEC-020**,
critério de aceite — *"trocar de projeto pelo combo carrega o workspace do outro
projeto sem passar pelo catálogo"*.

### Causa

Corrida entre os **dois efeitos** de `ResolveRoute.tsx`. O efeito de canonização
lia duas fontes que mudam em tempos diferentes:

- `project` — token da URL, **já** o do projeto novo;
- `state.resolved` — resolução do `/resolve`, **ainda** a do projeto anterior.

Nesse commit intermediário `project === projectSlug` é falso, a guarda não
segura, e o `navigate(..., { replace: true })` reescreve a URL **de volta** ao
projeto anterior — desfazendo a troca que o combo tinha acabado de fazer.

O `/resolve` do projeto novo respondia **200**: a troca funcionava e era
desfeita logo depois. Por isso o sintoma parecia "o combo não faz nada".

### Diagnóstico — o que o Network provou

```
resolve?tenant=rodreis&project=rrb-jarvisos   200   ← a troca funcionou
resolve?tenant=rodreis&project=rrb-proplan    200   ← o navigate a desfez
```

Registro honesto: **minha primeira hipótese estava errada** (achei que era
projeto em tenant diferente, com o `urlFor` montando a URL com o tenant errado).
Uma query no Postgres derrubou — há um único tenant. A causa real só apareceu
com o Network do PI. Hipótese sem evidência custa uma rodada.

### Correção

Decisão extraída para `apps/web/src/pages/workspace/canonicalUrl.ts` — função
pura que devolve a URL canônica **ou `null`**. Devolve `null` também quando a
resolução **não corresponde** aos tokens que a URL pede agora: resolução
obsoleta não manda em URL que não é dela.

O casamento aceita **slug, uuid e slug em outra caixa** — deep-link, F5 e
bookmark por UUID da SPEC-028 continuam resolvendo. O efeito no `ResolveRoute`
virou duas linhas.

### Verificação

- 7 testes em `canonicalUrl.test.ts`, um deles reproduzindo a regressão
- **Teste comprovado contra o bug**: removida a guarda → 2 falhas; restaurada → 7/7
- Suíte web **57/57** verde · `tsc --noEmit` limpo
- **Dogfooding local do PI**: três trocas seguidas pelo combo
  (`rrb-organize` → `rrb-proplan` → `rrb-jarvisOS`), URL/sidebar/breadcrumb
  coerentes em todas

### Entrega

**Mergeado — PR #116 (squash `3fcc5ee`), `refs #115`**, em 2026-07-22. **Aceito
pelo PI e verificado em produção** no mesmo dia: em
`proplan.rrbtrading.com.br`, a troca `rrb-proplan` → `rrb-jarvisOS` pelo combo
leva URL, sidebar, breadcrumb e conteúdo juntos.

A guarda do ADR-019 **barrou a primeira tentativa de merge** — os testes
passavam, mas faltava a linha de carimbo da entrega em `reports/TESTS.md`. Eu
tinha regenerado o relatório com `--issue 115`, que atualiza os totais mas não
grava o histórico datado; o comando certo passa as variáveis
(`REPORT_ISSUE`/`REPORT_SPEC`/`REPORT_PR`), como o próprio CI instrui na
mensagem de erro. Corrigido em `b627390`.

## SPEC-023 — Stack detectada via SBOM + confronto doc×real — `em andamento` (issue #8)

Fatia 17. Exibe a **stack real** de um projeto (linguagens/ecossistemas) a
partir do SBOM do Dependency Graph e **confronta com a stack declarada na
documentação** — sem ler uma linha de código-fonte (ADR-003 adendo). O confronto
segue o ADR-018: **coroa nenhuma fonte**.

### Decisões tomadas com o PI antes de codificar

A spec tinha duas frases em conflito e uma ambiguidade de escopo:

1. **Contrato da API** — o §Contratos pedia `GET /projects/:id/stack`, mas a
   linha seguinte mandava *"consumir via composição já persistida (padrão do
   Board)"*, que é o `tabs/:tab`. **PI decidiu: payload dentro da aba.** Zero
   rota nova para o bloco, zero segundo fetch. Só a **lista detalhada** ganhou
   endpoint próprio (`tabs/stack/packages`), porque é sob demanda.
2. **Abas** — a spec cita Arquitetura *e* Deploy, mas o 1º corte trata o repo
   como stack única, sem ligar manifest a componente (isso está em *Fora de
   escopo*). Na Deploy, o bloco repetiria a mesma informação sem se ligar aos 3
   eixos da SPEC-017. **PI decidiu: só Arquitetura agora.**

### Passos

- [x] **Domínio puro** (`ingestion/domain/stack-detect.ts`): `normalizeSbom`
      (SPDX → ecossistemas + pacotes), `declaredEcosystems` (termos da doc →
      ecossistema) e `compareStack` (o veredito). Zero I/O, zero IA — o SBOM é
      fonte determinística do GitHub (ADR-012).
- [x] **Client** — `getSbom` em `github-git.client.ts`, via
      `fetchGithubOptional`: DG desabilitado/negado/404 → `null`, degrada em vez
      de estourar. Leitura ⇒ **user token** (ADR-015).
- [x] **Schema + migration** (`20260725120000_fatia_17_stack_sbom`): cinco
      colunas `stack_*` em `projects`, no molde de `deploy_*`/`ci_*`.
      `stack_enabled` **nullable** — três estados, ver ARCHITECTURE → Resiliência.
- [x] **Sync** — `updateStack` em `sync.service.ts`, chamado nos **dois** ramos
      (`success` e `noop`) ao lado de `updateCiStatus`. Tolerante a falha: SBOM
      fora do ar não derruba o sync de docs.
- [x] **Aba** — `stackBlock` em `tabs.service.ts` lê só o cache e computa o
      confronto em memória. Anexado à Arquitetura **inclusive no nível 4** (doc
      ausente), que é onde ele mais informa: repo sem `ARCHITECTURE.md` ainda
      tem manifests.
- [x] **Web** — `StackPanel.tsx` + `extras` no `TabFrame` (deixa o bloco
      aparecer sob o empty state sem fingir que a aba tem documento).

### O confronto roda no render, não no sync

Único ponto em que fugi do padrão dos sinais vizinhos, de propósito: o lado
**detectado** é cache do sync, mas o lado **declarado** depende da resolução de
documento — que muda quando o dono remapeia `.proplan/config.yml` **sem que o
SBOM mude**. Veredito persistido ficaria velho nesse caso. Como o confronto é
comparação de dois arrays curtos em memória, computar no render não viola o
ADR-002 (a proibição é **chamada externa** no caminho da request, não CPU).

### O bug que só o dado real mostrou

Os 20 primeiros testes passavam e o domínio estava errado. Rodei contra o SBOM
real de `vercel/swr` (743 purls) e o veredito saiu **`discorda`** para um projeto
npm puro com doc dizendo TypeScript — falso positivo no caso mais comum.

**Causa**: o SPDX inclui dois purls que não são dependência da aplicação —
`pkg:github/vercel/swr@main` (o **próprio repositório**, nó raiz do grafo) e
`pkg:githubactions/actions/checkout` (passos de CI). O detectado virava
`['npm','actions','github']`, que nunca casa com o que um humano escreve na doc.

**Correção**: `NON_STACK_ECOSYSTEMS` filtra os dois **antes** do alias de
ecossistema. Revalidado contra o mesmo SBOM real: `['npm']`, 589 pacotes, e os
três vereditos corretos (`concorda` / `nao_declarado` / `discorda`).

**Lição registrada**: fixture escrita por mim confirma o que eu já imaginava. O
que pegou o erro foi a resposta real da API — e esta fatia existe justamente
para desconfiar de fonte que ninguém conferiu.

Um segundo erro meu, na mesma linha, veio de um teste: a fronteira do casamento
de termos barrava `.` à direita (para proteger `.net`), e com isso *"Backend em
Python."* não casava — todo termo em fim de frase sumia. As bordas ficaram
assimétricas, com o porquê no código.

### Verificação

- **26 testes** de domínio (`stack-detect.spec.ts`), 4 deles regressões do dado
  real · **6** do passo de sync (`stack-sbom-integration.spec.ts`) · **8** do
  bloco na aba (`tabs.service.spec.ts`) · **10** de UI (`StackPanel.test.tsx`),
  incluindo um que falha se qualquer lado do confronto receber rótulo de
  "correto"/"errado"
- Suíte **API 670/670** e **web 67/67** verdes · `tsc --noEmit` limpo nos dois ·
  `vite build` ok · migration aplicada com `prisma migrate deploy`
- **Dogfooding contra a API real do GitHub**: `vercel/swr` (público, DG ativo) →
  `enabled: true`, `['npm']`; **este repo** (`rrb-proplan`, privado) → **404**,
  que é exatamente o caminho de fallback — DG vem desabilitado por padrão em
  repo privado, como o ADR-003 adendo previu

### Entrega

**PR #117** mergeado em 2026-07-25 (`refs #8`, squash `731a011`). Issue **#8
fechada pelo PI** com `proplan:finalizado` no mesmo dia — fatia **aceita**.

---

## Fatia 12 — `descartado` (#4, decisão do PI em 2026-07-25)

Card fechado sem código, por não ter escopo implementável. Registro aqui porque
descarte também é entrega de fluxo: o board mentia — a issue estava em **A Fazer**
com prio média e assignee, para um trabalho que não existia.

O que havia no card, item por item:

| item | onde foi parar |
|---|---|
| Migração Issues↔`STATUS.md` (o **título** do card) | **entregue na Fatia 5** — a SPEC-005 foi reescrita sobre Issues (decisão do PI, 2026-07-12) |
| Sub-issues | **entregue na Fatia 18** (SPEC-024, #97, finalizada em 2026-07-21) — e antes disso estavam *rejeitadas* pelo ADR-011 |
| GitHub Projects v2 | **condição, não tarefa**: `MVP2.md` item 5 — *"só se a ordenação determinística do board incomodar na prática"*. Sem spec |
| Issue types | **condição, não tarefa**: *"sem caso de uso hoje"*. Sem spec |

### Por que não codifiquei nada antes de descartar

As duas sobras vivas não têm spec `aprovada-pi`, e o ADR-011 + `DECISIONS.md`
tratam o **board plano** (`card = fatia`) como o desenho **correto** — não como
defeito. Então:

- **Não é fatia** que eu possa pegar: sem spec, escolher entre Projects v2 e
  issue types seria eu decidindo escopo de produto.
- **Não é `[FIX]`**: não há comportamento correto documentado sendo violado —
  o documentado é o comportamento atual.

Restava reescopar ou descartar, e **as duas são decisão do PI**. Levei as duas
opções; o PI escolheu descartar.

**O que fica vivo sem card:** as condições no `MVP2.md`. Se alguma se satisfizer
na prática (a ordenação do board incomodar de fato), nasce **card novo com spec
própria** — o #4 não se reabre.

---

## Fatia 19 (SPEC-029) — Clientes, funil Kanban e ciclo de vida do link público — `feito` (issue #127, `proplan:done`; aguardando aceite do PI)

Primeira fatia do **MVP3 / Frente Clientes** (`docs/specs/MVP3.md`). Fatia grande:
escrita em **4 PRs empilhados** (1 branch por PR, todos com base `main`).

| PR | escopo | estado |
|---|---|---|
| **PR-1** | Modelo de dados: 5 tabelas, enum do funil, RLS em profundidade, 2 ADRs | `feito` |
| **PR-2** | Módulo `clients`: máquina de estados, CRUD + busca, transições auditadas, RBAC | `feito` |
| **PR-3** | Módulo `briefing`: link hash-only, `GET /b/:token` não-diferencial, rate limit | `feito` |
| **PR-4** | UI: página Clientes + Kanban dnd-kit com rollback | `feito` |

### Os 4 PRs entraram num squash só — e por que isso importa

O **PR #132 (PR-4) veio cumulativo**: como os 4 branches apontavam para `main` (ver
*Correção de rota nos PRs empilhados*, no PR-3), o diff do #132 contra `main` trazia
os quatro juntos. Ele foi mergeado como squash **`a985ebd`** (55 arquivos,
+7668/−417) em 2026-07-26, e os PRs **#129/#130/#131 foram fechados sem merge** — o
conteúdo deles já estava na `main`, e mergear qualquer um reaplicaria o mesmo diff.

**A lição fica registrada porque o ganho dos PRs empilhados se perdeu:** apontar
todos para `main` resolveu o CI que não disparava, mas fez cada PR conter os
anteriores. A revisão isolada, que era a razão de empilhar, só existiu enquanto
ninguém mergeou. Para a próxima fatia grande: ou base encadeada (e resolver o
gatilho do CI, que é decisão do PI — ver o candidato `[INFRA]` abaixo), ou aceitar
de saída que o último PR é o que entra e revisar os anteriores antes dele.

**Pendente para o aceite:** dogfooding não foi feito — nenhuma tela aberta no
navegador. Criar cliente, arrastar card e conferir o rollback segue não exercitado
contra o ambiente real.

### PR-1 — modelo de dados e isolamento

- [x] **5 tabelas novas**: `clients` (raiz de tenancy), `client_projects`,
      `client_status_transitions`, `briefing_links`, `audit_events` (append-only).
- [x] **Enum `ClientProjectState`** com os 10 estados internos do funil
      (`DRAFT` → … → `ARCHIVED`), mais finos que as 4 colunas da UI.
- [x] **RLS em profundidade** (mesmo desenho da SPEC-022): raízes filtram por
      `tenant_id = ANY(app.tenant_ids)`; filha (`client_projects`) e netas
      (`client_status_transitions`, `briefing_links`) herdam por JOIN até
      `clients`. `ENABLE` + `FORCE` nas cinco.
- [x] **ADR-023** — funil de clientes é estado do app; ADR-011 segue mandando no
      board de repos. Domínios disjuntos, nenhum fato nos dois lugares.
- [x] **ADR-024** — `Tenant` existe sem instalação do GitHub.
- [x] **Teste de isolamento** (`clients-rls.int-spec.ts`, 6 casos contra Postgres
      real): raiz, filha, netas, `audit_events`, array de membership e fail-closed.

#### `installationId` nullable não gerou DDL

A spec pede *"migration: `Tenant.installationId` aceita NULL"*. Ao ir escrever a
migration, a coluna **já era nullable desde a Fatia 8** — nasceu
`"installation_id" INTEGER` (sem `NOT NULL`) na
`20260717214642_fatia_8_multi_tenant`, porque o tenant pessoal já podia existir
antes da instalação de org.

Então o critério de aceite estava satisfeito **antes** da fatia começar, e um
`ALTER COLUMN ... DROP NOT NULL` teria sido DDL no-op. O que faltava de verdade
era o **ADR-024**: tornar deliberada uma propriedade que até aqui era acidente
de implementação — e da qual a Frente Clientes passa a depender. Registrado
como constatação no próprio ADR.

#### Grants ficaram fora da migration

`proplan_app` é não-owner e não herda privilégio nas tabelas novas. A tentação
era um `GRANT ... TO proplan_app` no fim da migration — desnecessário: o
`scripts/bootstrap-app-role.mjs` já roda `ALTER DEFAULT PRIVILEGES ... GRANT ...
ON TABLES`, que cobre o que as migrations criarem depois. Repetir o grant
divergiria do bootstrap na próxima mudança de privilégio.

#### Netas são o ponto que um teste ingênuo deixa passar

`client_status_transitions` e `briefing_links` não têm `tenant_id` próprio — a
policy delas depende do JOIN até `clients` estar correto. Um join quebrado não
devolveria zero linhas (que apareceria na hora): devolveria **tudo**. Por isso o
int-spec povoa **dois** tenants com transição e link em cada, e afirma que o
tenant A vê só `tr-a`/`bl-a`. Com um tenant só, o teste passaria mesmo com a
policy furada.

### Decisão de navegação: `/t/:tenant/clients` (PI, 2026-07-25)

A spec define os contratos de API mas **nenhuma rota de UI**, e toda rota web
existente é `/t/:tenant/p/:project/:tab` — presa a um **repo GitHub**. Cliente
não tem repo, então não havia `:project` para pôr no path.

Levado ao PI, que escolheu **`/t/:tenant/clients`** (+ `/t/:tenant/clients/funil`):
nível de tenant, irmão do workspace de repo, espelhando a API da spec. As
alternativas — aba dentro do workspace (exigiria projeto sentinela) e `/clients`
na raiz (perderia o tenant no path, contra o ADR-020) — foram descartadas.

### Referência visual do PI (2026-07-25): imagens de Dashboard, Kanban e Clientes

O PI enviou três telas de inspiração no meio da fatia. Elas mostram **mais** do
que a SPEC-029 define, e um dos pontos era **conflito direto**, não detalhe:

| ponto | imagem | SPEC-029 | decisão do PI |
|---|---|---|---|
| **Colunas do Kanban** | 5: *Lead · Briefing · Proposta · Contrato · Entregue* | 4: *Novo/Link enviado · Briefing · Prompt e contrato · Produção e entrega* | **valem as 4 da spec** |
| Valor em R$ no card | mostra | não define | **fora** — estimativa é a Fatia 22 (SPEC-032) |
| Dashboard | tela inteira | não pede | **fora** — é a Fatia 24 (SPEC-034) |
| Badge de origem (`INDICAÇÃO`/`SITE`/`RECORRENTE`) | mostra | não define | **fora** — sem spec do enum nem de quem preenche |
| Vínculo cliente ↔ repo (`rrb-escola`) | mostra | não define | **fora** — cruzaria a Frente Clientes com o board de repos (ADR-023) |

**As imagens valem como referência VISUAL**: avatar de iniciais, densidade da
lista, contagem por coluna no cabeçalho, badges de estado, botão "Novo cliente".
Não valem como escopo — o que elas mostram a mais pertence a fatias que ainda
não têm spec `aprovada-pi`.

Registro do método, porque é a regra do `CLAUDE.md` operando: escopo é do PI.
Encolher a spec para caber na imagem, ou inflar a fatia para cobrir a imagem
inteira, seriam os dois lados do mesmo erro — eu decidindo escopo. Levei o
conflito e as quatro adições ao PI **antes** de escrever a UI, não depois.

#### Lição de método: PR empilhado com base ≠ `main` não roda CI

Abri o PR-2 com base no **branch do PR-1** (é o que "empilhado" sugere) e o
GitHub aceitou — mas o CI **nunca disparou**: o `.github/workflows/ci.yml` tem
`on: pull_request: branches: [main]`, então PR cuja base não é `main` fica sem
nenhum check. A UI não avisa; ela só mostra "no checks reported", que é fácil
confundir com "ainda rodando".

Isso é perigoso porque a guarda do ADR-019 (relatório de teste que bate com
execução limpa) é justamente o que impede entrega sem evidência — e ela some em
silêncio no exato tipo de PR onde é mais fácil errar número (relatório gerado no
branch errado, que foi o erro que cometi no PR-1).

**A Fatia 18 não teve o problema** porque apontou os 4 PRs empilhados para
`main` desde o começo — o empilhamento vivia só na ordem de merge, não na base
do PR. Adotado o mesmo aqui: **base `main` em todos os PRs da fatia**, mergeando
na ordem. O branch de cada PR continua saindo do anterior (é o que mantém o diff
pequeno); só a *base declarada no GitHub* é `main`.

Vale como candidato a `[INFRA]` futuro: fazer o CI rodar também em base
não-`main`. Não abri card porque não é comportamento documentado sendo violado —
é limitação conhecida do workflow, e mudar o gatilho de CI é decisão que merece
o PI.

### PR-4 — UI: página Clientes e Kanban do funil

- [x] **Rota `/t/:tenant/clients`** (+ `/clients/funil`) com shell próprio, irmão
      do workspace de repo. `ClientsRoute` resolve o tenant (aceita slug ou
      UUID, como as rotas de workspace), fixa `setActiveTenant` **antes** de
      renderizar e solta ao sair — deixá-lo fixo faria uma chamada global
      seguinte sair escopada por engano.
- [x] **Kanban com dnd-kit**, atualização otimista e **rollback** no 422.
- [x] **RBAC na UI**: `viewer` não vê os controles de escrita e não arrasta card.
      A API recusa de qualquer jeito (403) — esconder o botão é conveniência, a
      barreira é o servidor (defesa em profundidade, critério da spec).
- [x] **Cadastro/edição de cliente completo**: o modal único cria e edita nome,
      CPF, empresa, CNPJ, e-mail, telefone, WhatsApp, endereço completo e notas
      internas — mesmos campos do `Client` definido na SPEC-029. CPF/CNPJ,
      telefone, WhatsApp e CEP têm máscara de leitura, mas a API segue recebendo
      só dígitos.
- [x] Visual conforme a referência do PI: avatar de iniciais, contagem por
      coluna, badge de estado, densidade da lista. Só tokens do Carbono/Claro
      (`DESIGN.md` §4) — nenhuma cor absoluta.

#### A lógica do board é função pura, testada fora do componente

`moveCard`, `columnOf` e `applyConfirmedState` vivem em `boardView.ts`, sem
React. Motivo: **rollback é o critério de aceite mais fácil de regredir**, e um
teste de markup não o provaria. Os 9 casos cobrem o que dói:

- mover **não muta** o board original — é ele que o rollback restaura;
- mover para a mesma coluna devolve o board **por identidade** (`toBe`), e o
  componente usa isso para não disparar request ao soltar o card onde ele já
  estava;
- `applyConfirmedState` corrige o rótulo com o **estado interno** que o servidor
  devolveu. A UI move por *coluna*, o servidor responde *estado*; sem isso o
  card ficaria na coluna certa exibindo o rótulo antigo até o próximo refetch —
  bug silencioso, porque a posição estaria correta.

#### Colisão de nome no front: `BoardColumn` já existia

`BoardColumn` no `api.ts` é das colunas do board de **repos** (`backlog`,
`todo`, `doing`…). Os tipos da frente viraram **`FunnelBoardColumn`** e
**`FunnelCard`** — mesma disciplina que fez `ClientProject` não reusar
`Project` (ADR-023: domínios disjuntos, nomes disjuntos). O `tsc` pegou na
hora; se os nomes tivessem coincidido só em runtime, seria bug de tipo
silencioso.

#### `activationConstraint` no PointerSensor

Sem `{ distance: 6 }`, um clique simples no card conta como drag de 0px e a UI
dispara transição sem o usuário ter arrastado nada.

#### Dogfooding achou o bug que a suíte não podia achar

Com a API e a web de pé, `GET /b/:token` respondia **`invalid` para todo token
válido** — o link público nunca teria funcionado.

**Causa**: a rota não tem sessão, então roda **sem** `app.tenant_ids`. O RLS de
`briefing_links`/`clients` é fail-closed (é o que o PR-1 provou e celebrou), e o
`SELECT` direto do lookup voltava zero linhas. A mesma propriedade que garante o
isolamento fechava a única rota que precisa atravessá-lo.

**Por que os 14 testes do service não pegaram**: eles mockam o `$queryRaw`.
Provam a **lógica** (não-diferencial, revogado vence expirado, token não vaza) —
não o **acesso**. É a mesma classe de lacuna da issue #122: teste correto sobre
um dado que não existe. O mock não tem RLS.

**Correção** (decisão do PI): função `resolve_briefing_link(hash)` com
`SECURITY DEFINER` e superfície mínima — recebe só o hash, devolve só aquele
link, não lista nem pagina, `search_path` fixo, `REVOKE` de `PUBLIC` + `GRANT`
só para `proplan_app`. O RLS continua **ativo em todas as tabelas**; o
privilégio fica confinado a uma função auditável em vez de a uma role.

Descartadas: policy `USING (true)` (abriria a tabela inteira para qualquer query
sem contexto) e role com `BYPASSRLS` (o ADR-022 proíbe — o bootstrap **falha** se
a role tiver `rolbypassrls`).

**O teste que faltava** agora existe: `briefing-link-lookup.int-spec.ts`, contra
Postgres real, com a role `proplan_app` e **sem** contexto — exatamente como a
rota em produção. Seis casos, e o último é o que impede a "correção" preguiçosa:
`SELECT` direto sem contexto **continua** devolvendo zero linhas. Se ele virar
verde com linhas, alguém afrouxou a policy e o isolamento caiu junto.

**Verificado ao vivo** depois do fix: token válido → `{"status":"valid"}` ·
token errado → `invalid` · revogado → `revoked` · `AuditEvent` de acesso gravado
com o tenant vindo do hash · rate limit cortando na 21ª request com **429**.

### Menu global (referência visual do PI, 2026-07-25)

O PI apontou que o menu esquerdo não aparecia: as páginas existiam sem porta de
entrada — só se chegava digitando a URL. Omissão minha; a spec não define
navegação e eu não perguntei.

Levado ao PI com três opções. A escolha foi o **menu global de primeiro nível**
da imagem (`Dashboard · ProPlan · Kanban · Clientes · Configuração`), **acima**
do workspace de repo — não dentro dele. O motivo é o mesmo da decisão de rota:
exigir um repo aberto para chegar em Clientes tornaria a frente inalcançável com
o GitHub desconectado, que é justamente o estado em que ela deve funcionar
(ADR-024).

**Escopo do menu nesta fatia** (decisão do PI): só `Clientes` e `Funil` são
telas novas. `ProPlan`, `Kanban` e `Configuração` apontam para rotas que já
existiam. **`Dashboard` fica desabilitado**, com o motivo no `title`: é a Fatia
24 (SPEC-034) e depende de estimativa (F22) e contratos (F23) — renderizá-lo
agora exigiria números inventados, que o MVP3 §9 proíbe. Desabilitado e
explicado é melhor que ausente: some ≠ mentir sobre o que existe.

#### Ajuste de escopo assumido pelo PI: shell global fiel à imagem

O PI esclareceu que a imagem não era só inspiração das páginas novas: ela define
o **shell global** do app (`Dashboard · ProPlan · Kanban · Clientes ·
Configuração`). Isso é escopo novo sem spec `aprovada-pi` e redesenha a
navegação do app inteiro. O PI decidiu explicitamente assumir agora, dentro da
Fatia 19.

Decisão aplicada:

- **ProPlan = Catálogo** (mensagem do PI: "proplan = catalogo"). A tela `/`
  agora renderiza dentro do `AppShell`, com o menu global à esquerda.
- `Clientes` e `Kanban` do menu levam para as telas da Frente Clientes desta
  fatia (`/t/:tenant/clients` e `/t/:tenant/clients/funil`).
- `Configuração` segue levando para `/settings`.
- `Dashboard` continua **desabilitado**, porque é a Fatia 24 (SPEC-034) e
  dependeria de estimativa/contratos ainda inexistentes. Botão desabilitado com
  `title` explicando é melhor que esconder ou inventar número.

O `AppShell` extraiu a topbar que antes vivia só no Catálogo; o Catálogo perdeu
o header próprio. Isso deixa a tela inicial visualmente fiel à imagem: menu
lateral fixo, breadcrumb `ProPlan / ProPlan`, conteúdo do catálogo à direita.

## SPEC-030 — Painel de detalhe do card: corpo, metadados e trilha — `feito` (issue #128)

Refinamento da SPEC-005: clicar num card passa a abrir **leitura**, e o
formulário de edição vai para trás de um botão. Nenhuma tabela nova, nenhuma
coluna nova — o `grep body` no schema do board continua sem resultado.

| passo | estado |
|---|---|
| `GET .../board/cards/:number` (issue + timeline, user-to-server) | `feito` |
| Domínio `card-detail.ts`: tradução e filtro da trilha | `feito` |
| Gaveta `CardDetailPanel` + `cardDetailView.ts` | `feito` |
| Religar o clique do card (abrir ≠ editar ≠ arrastar) | `feito` |

### Nada é persistido, e é o ponto da fatia

Corpo e trilha são lidos a cada abertura e descartados ao fechar. O ADR-017 já
autoriza a UI a ler cache, mas cache é foto — e sem webhooks (ADR-009) **nada nos
avisa** quando o corpo de uma issue muda. Guardá-lo criaria a segunda fonte
defasada de um fato que o GitHub serve ao vivo, que é exatamente o
*"dado velho com aparência de autoridade"* que o ADR nomeia. Custo aceito pelo
PI: duas chamadas e latência no open. Há teste afirmando que o service não grava
(`prisma.issue.update/upsert/createMany` nunca chamados).

As duas leituras vão em `Promise.all`: são independentes, e em série a latência
apareceria somada no abrir da gaveta.

### `read<T>` nasceu por causa do 404

O client tinha `write<T>` mas nenhum leitor de recurso único, e cada leitura
repetia o bloco fetch/401/!ok. O helper novo acrescenta uma linha que importa:
**404 → `NotFoundException`**. Issue removida entre o sync e o clique é caso
normal deste endpoint; sem o mapeamento, cairia no `!res.ok` e devolveria **500**
— o dono leria "falha do ProPlan" onde a verdade é "esse card não existe mais".

### Três atritos que a spec não previu (decididos ao implementar)

**1. O `aria-label` mentia.** Era `Editar card #N`; o clique agora abre leitura,
então virou `Abrir card #N`. Três testes dependiam do texto antigo — atualizados
junto. Rótulo que promete edição engana quem navega por leitor de tela, e engana
mais o `viewer`, que passou a abrir o card sem poder editá-lo.

**2. `canEdit = !!onEdit` fundia três coisas.** A mesma flag decidia *clicar*,
*arrastar* e *ver o handle*. Efeito colateral: o `viewer` não conseguia nem
**abrir** um card para ler — e a spec não proíbe leitura, ela a oferece. Separado
em `canOpen` (clique, sempre que há callback) e `canDrag` (`canOpen && draggable`).
A prop `draggable` desce por `KanbanColumn` e `KanbanSwimlane`; a API recusa
escrita de viewer com 403 de qualquer forma, esconder o handle é conveniência.

**3. Esc com o popover aberto fechava a gaveta por baixo.** A gaveta escuta Esc
no `document`; o `EditCardPopover` não escuta nada. Com as duas montadas, Esc
fecharia a leitura e deixaria o formulário órfão. Resolvido no pai: enquanto
`editing` existe, a gaveta é **escondida com `hidden`, não desmontada** — o
estado da leitura sobrevive, então voltar da edição não refaz as duas chamadas ao
GitHub.

### `onDiscarded`: descartar não é "salvou"

`EditCardPopover` chamava o mesmo `onSaved` nos dois caminhos. Salvar deve manter
a gaveta aberta (o critério pede que o título novo apareça sem F5); descartar
tem de fechá-la, senão sobra a ficha de um card que saiu do board. Callback novo
e **opcional** — sem ele, descarte cai no `onSaved`, o comportamento de antes.
Para o reflexo sem F5, um `refreshNonce` faz a gaveta reler após salvar.

### O que foi testado fora do React, e por quê

`cardDetailView.ts` (corte da trilha, frase do evento, contraste da label) e
`domain/card-detail.ts` (filtro dos 8 tipos, ordenação, normalização do corpo)
são funções puras. Um teste de markup provaria que "algo apareceu"; estes provam
**o quê** — e trilha em ordem errada ou rótulo trocado é defeito que passa numa
revisão visual.

Dois casos que valem citar: o corte pega os **mais recentes** (não os primeiros —
a trilha é invertida antes de cortar), e `labelTextColor` existe porque o GitHub
manda só a cor de fundo: `fbca04` com texto branco fica ilegível.

**Labels `proplan:*` aparecem crus na trilha**, como o GitHub as registra — três
eventos, não um sintético "moveu de todo para doing". A spec é explícita, e há
teste fixando isso.

### Contaminação no jsdom que quase virou "bug" (registro para não repetir)

Um teste novo do `KanbanCard` falhava com **0 chamadas** no clique. Rastreando os
eventos: `pointerdown`, `mousedown`, `pointerup` e `mouseup` chegavam ao card, mas
o `click` **nunca era emitido** — e o clique nativo (`element.click()`) funcionava.
Causa medida isolando as combinações: **só falha quando o teste anterior clica no
handle de arrasto**. O `PointerSensor` do dnd-kit instala listeners de pointer que
o jsdom não desfaz entre renders, e o clique seguinte deixa de virar `click`.

Corrigido **reordenando** o caso para antes do teste do handle, com o motivo
escrito no arquivo. Nenhuma linha de produção mudou por isso — o componente
sempre respondeu. Fica anotado porque a próxima pessoa a ver "0 calls" vai
suspeitar do componente, como eu suspeitei.

### Descartado

Extrair `Objetivo`/`Escopo`/`Critérios de aceite` de `docs/specs/SPEC-nnn-*.md`
pelo token do título: imporia a convenção deste trio ao produto (ADR-014). Ficaria
perfeito neste repo e vazio em todos os outros. O corpo da issue é universal — e
neste repo já contém a mesma informação, escrita pelo humano.

### O que não foi verificado

**Nenhuma tela foi aberta no navegador.** 916 testes verdes (758 regras · 31
banco · 127 tela), `tsc` limpo nos dois apps e `vite build` OK — mas abrir um
card contra o GitHub real, ver o corpo renderizado e conferir a trilha contra a
aba do GitHub é o passo que falta. O modo degradado também não foi exercitado
com rate limit de verdade.

## FIX #134 (SPEC-029) — não havia como criar projeto: o funil nascia inoperável — `feito`

Achado no **dogfooding do PI em 2026-07-26**, logo depois de a Fatia 19 (#127) ir
para `proplan:done`: dois clientes criados, funil mostrando **0 CARDS** nas quatro
colunas.

O funil estava **certo**. Ele lista `client_projects`, e havia zero — porque
**nenhum componente chamava `createClientProject`**, embora a função existisse em
`apps/web/src/lib/api.ts` desde o PR-4. Cliente não é card; projeto é.

| camada | antes do FIX |
|---|---|
| Tabela `client_projects` + RLS | ✅ PR-1 |
| `POST /clients/:id/projects` | ✅ PR-2 |
| Ciclo de vida do link (`briefing-link`) | ✅ PR-3 |
| `createClientProject` / `createBriefingLink` no client web | ✅ escritos |
| **Componente que chamava qualquer um** | ❌ **nenhum** |
| **Detalhe do cliente** (que a spec diz listar os projetos) | ❌ não existia |

O backend inteiro estava pronto e sem consumidor. Era só UI.

### Por que a suíte não pegou — e o que mudou

O PR-4 testou `boardView.ts` (mover, rollback, reconciliação) com fixtures em
memória: provou a lógica **dado que existem cards**. Nada afirmava que a UI
consegue **criar** um.

É a mesma classe de lacuna da #122 (`users.email` NULL): a suíte estava correta,
faltava o **dado**. O teste que fecha isso agora existe e é explícito —
`ClientDetailPanel.test.tsx` → *"cria projeto pela UI e avisa o pai para recarregar
o funil"*. Sem ele, o próximo refactor reabre o mesmo buraco.

**A lição real:** teste de lógica com fixture nunca prova que existe caminho até a
lógica. Numa fatia que entrega tela, pelo menos um teste tem de percorrer a ação
do usuário de ponta a ponta — ou o dogfooding vira o primeiro teste, como foi aqui.

### O que entrou

**Detalhe do cliente** (`ClientDetailPanel`) — clicar na linha da lista abre a
gaveta com os projetos do cliente, o estado de cada um e o botão *Novo projeto*.
É o que o critério de aceite da SPEC-029 descreve literalmente (*"os dois projetos
listam no detalhe do cliente"*). Reusa a classe `.card-drawer` criada na SPEC-030.

**Clicar na linha vale para `viewer` também.** Ler não é escrever, e sem essa
porta o funil não recebe card. Os botões *Editar*/*Remover* dentro da linha fazem
`stopPropagation` — mesmo padrão do link `#N` no `KanbanCard`, senão clicar em
Editar abriria a gaveta por baixo do diálogo.

**Link de briefing na criação** (§2 da spec, decisão do PI): ao criar o projeto o
painel do link abre em seguida. O token aparece **uma única vez** — só o hash
SHA-256 persiste, então o aviso na tela diz que a única saída, se perdido, é
regenerar. Copiar / expiração (`<input type="date">` nativo, sem lib) / revogar /
regenerar, com `ConfirmDialog` no regenerar porque ele **invalida o link que o
cliente já recebeu**.

### `clientDetailView.ts` — o que erra em silêncio

Fora do React pelo mesmo motivo do `boardView.ts`. Dois casos que um teste de
markup não pegaria:

- **`status: 'invalid'` colapsa em "nenhum"**: para quem olha a tela, "não existe"
  e "existe mas não vale nada" pedem a mesma ação — gerar. Distinguir produziria
  um rótulo que ninguém sabe interpretar.
- **o rótulo do botão muda com o estado**: `Gerar link` sem link, `Regenerar link`
  com qualquer um. Quem lê "Gerar" não espera invalidar o que já mandou.

### Escopo desta correção

Card `[FIX]` criado **pelo Code** (acordo de 2026-07-22 do `CLAUDE.md`): o
comportamento correto já estava escrito na SPEC-029 antes da issue existir, então
não havia decisão de produto — só código que faltou. A issue cita o critério.

A **#127 não reabre** — segue `proplan:done` aguardando aceite. Se o PI preferir
recusá-la, este FIX vira parte da re-entrega.

### O que não foi verificado

O fluxo foi exercitado por **teste**, não no navegador contra o banco real:
criar projeto, ver o card aparecer no funil, arrastá-lo e conferir o rollback é o
dogfooding que segue pendente — junto com o da #127 e da #128.

### Emenda ao FIX #134 — o link apontava para a web, e caía no login

Achado no mesmo dogfooding, minutos depois: abrir o link gerado mostrava a tela
**"Entrar no painel"**. O token estava certo — `curl` na API devolvia
`200 {"status":"valid"}`. Errada era a URL que eu montava.

`briefingUrl` usava `window.location.origin` (a web, `:5180`), mas **`/b/:token` é
rota do NestJS** (`:3311`), declarada fora de todo guard. O React Router não tem
`/b` nenhum, então o catch-all mandava o visitante para o login — e o visitante
aqui é *o cliente do prestador*, que não tem conta.

Corrigido exportando `API_URL` do `lib/api.ts` e usando-o para montar o link. O
teste que barra a regressão afirma o que importa: a URL contém `:3311` e **não**
contém `:5180`.

**Nota de escopo, que o aviso na UI agora diz:** hoje esse link responde **JSON**,
não uma página. O *formulário* público é a Fatia 20 (SPEC-031) — a SPEC-029 o lista
em *Fora de escopo* e entrega só o ciclo de vida do link. O link já é o definitivo:
quando o formulário existir, atende no mesmo caminho. Sem o aviso, quem abrisse
para conferir concluiria que está quebrado — foi o que aconteceu.
