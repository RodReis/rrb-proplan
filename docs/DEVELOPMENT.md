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
painel do link abre em seguida. Copiar / expiração (`<input type="date">` nativo,
sem lib) / revogar / regenerar, com `ConfirmDialog` no regenerar porque ele
**invalida o link que o cliente já recebeu**.

#### O token não é recuperável — e a aba é quem lembra (FIX #151)

O servidor persiste **só o `token_hash`** (SHA-256): o token em claro existe uma
única vez, na resposta do POST. Nenhum GET pode devolvê-lo — isso é propriedade
de segurança da SPEC-029, não limitação a consertar.

A primeira versão da tela parava aí, e o dogfooding mostrou o custo: quem fechava
a janela sem copiar via só *"Link já existe"* + *Regenerar*, sem URL nenhuma — e
regenerar **invalida o link que o cliente já tem**. Conveniência de sessão sem
tocar no modelo: `briefingTokenCache.ts` guarda o token por projeto em
**`sessionStorage`** (não `localStorage` — token é credencial, e persistir em
disco é o que o hash-only evita; ele morre com a aba).

Três regras que o cache obriga, todas testadas:

- **Token lembrado só aparece se o link está `valid`.** Ele sobrevive na aba à
  expiração e à revogação feitas no servidor; oferecer para cópia uma URL morta é
  pior que não oferecer nenhuma — o operador manda para o cliente e só descobre
  pela reclamação.
- **Link recém-criado aparece sem esperar o GET.** `created` vale sozinho: o POST
  acabou de devolver um link vivo, e exigir a confirmação do `getBriefingLink`
  esconderia — mesmo que por um instante, ou de vez se a rede falhar —
  justamente o token que só existe agora. Foi o bug que a suíte pegou na primeira
  tentativa desta correção.
- **Revogar esquece o token.** Guardá-lo só criaria a chance de copiar URL morta.

Quando o token **não** está na aba (outra máquina, navegador fechado), a tela diz
a verdade em vez de deixar o operador procurando: a URL não é recuperável, a
saída é regenerar. Fechar por backdrop/Esc deixou de ser bloqueado — deixou de
ser destrutivo.

### `clientDetailView.ts` — o que erra em silêncio

Fora do React pelo mesmo motivo do `boardView.ts`. Três casos que um teste de
markup não pegaria:

- **`status: 'invalid'` colapsa em "nenhum"**: para quem olha a tela, "não existe"
  e "existe mas não vale nada" pedem a mesma ação — gerar. Distinguir produziria
  um rótulo que ninguém sabe interpretar.
- **o rótulo do botão muda com o estado**: `Gerar link` sem link, `Regenerar link`
  sobre link **válido** — quem lê "Gerar" não espera invalidar o que já mandou —
  e `Gerar novo link` para expirado/revogado, onde não há acesso vivo a destruir.
- **confirmar só sobre link válido** (`needsRegenerateConfirm`): o diálogo existe
  para proteger um acesso vivo. Pedi-lo quando não há nada a perder é atrito que
  ensina a clicar "sim" sem ler — que é como uma confirmação deixa de proteger na
  única vez em que importa.

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

## FIX #136 (SPEC-029) — o link público devolvia JSON ao cliente do prestador — `feito`

Achado **em produção** pelo PI em 2026-07-26, com a pergunta certa:
*"ela está apontando para api, está certo isso?"*

```
https://api.proplan.rrbtrading.com.br/b/jH6zk9ro4oXpuk…
→ {"status":"valid"}
```

Tecnicamente a rota respondia. Como produto estava errado, por dois motivos:

1. **O destinatário é o cliente do prestador** — alguém sem conta e sem contexto.
   JSON cru num host chamado `api.` parece link quebrado ou endereço interno
   vazado, não um convite de briefing.
2. **Amarrava o link ao subdomínio errado de forma permanente.** O formulário da
   Fatia 20 (SPEC-031) será uma página React em `proplan.rrbtrading.com.br`; todo
   link já enviado apontando para `api.` continuaria devolvendo JSON, e consertar
   exigiria **regenerar** — que revoga o link que o cliente já tem. O custo crescia
   a cada link enviado.

### Duas versões erradas, uma causa só

| tentativa | resultado |
|---|---|
| `window.location.origin` (a web) | sem rota `/b` no React, o catch-all mandava para a **tela de login** |
| `API_URL` (`api.`) | respondia, mas **JSON** para uma pessoa ler |

A causa das duas é a mesma: **havia rota no backend e não no frontend**. Trocar a
base era remendo — cada versão movia o sintoma. A correção é a rota que faltava.

### O obstáculo real estava no `App.tsx`

O gate de sessão ficava **antes** do router:

```tsx
if (auth.status === 'anonymous') return <Login />;   // ← antes do <BrowserRouter>
return <BrowserRouter>…</BrowserRouter>
```

Com isso **nenhuma rota pública era possível** — não havia router para casar
`/b/:token`. Invertido: o `BrowserRouter` passou a envolver os três estados de
sessão, `/b/:token` é declarada fora do gate, e o resto virou `path="*"` que cai
em skeleton (carregando) ou `<Login />` (anônimo).

Isso explica por que a 1ª tentativa parecia "bug de URL": a URL estava certa, o
router é que não existia naquele ponto do ciclo.

### `BriefingLinkPage` não usa o `request()` do `lib/api`

`fetch` cru, de propósito. O `request()` trata **401 como "precisa logar"** e lança
`UnauthorizedError` — comportamento correto para o painel, errado aqui: quem abre
não tem conta e nunca vai ter. Também não manda `credentials`: cookie de sessão
nesta rota não serviria para nada e só ampliaria a superfície.

**429 e 5xx não viram "link inválido".** Rate limit ou servidor fora não são
veredito sobre o token; acusar o visitante de ter um link ruim que talvez seja bom
é pior que dizer "não foi possível verificar agora" com botão de nova tentativa.
Só 404 e a resposta explícita da API decidem o estado do link.

**A não-diferenciação sobrevive na tela**: token inexistente e token de outro
tenant renderizam o mesmo texto, sem mencionar tenant, cliente ou projeto. O
backend esconde por design (SPEC-029); vazar na UI anularia isso. Há teste
comparando o texto dos dois casos.

### Verificado no navegador, sem sessão

```
GET http://localhost:5180/b/GIB1JZnQ… → "Link confirmado / Este link de
  briefing é válido. O formulário … estará disponível aqui em breve"
GET http://localhost:5180/b/token-que-nao-existe → "Link inválido"
```

E o acesso **continua auditado** — 2 novos `briefing_link.accessed` em
`audit_events` (23:28), gravados pela página consumindo a mesma rota.

### Produção não precisa de mudança de infra

Conferido antes de assumir: `apps/web/nginx.conf` já tem
`try_files $uri $uri/ /index.html`, então `/b/<token>` cai no fallback SPA e o
React assume. Nenhum ajuste no Railway, no Dockerfile ou no DNS.

### O que fica pendente

O **rollback do funil** (arrastar pulando etapa) segue sendo o único critério de
aceite da SPEC-029 nunca exercitado na tela — atravessou a Fatia 19, o FIX #134 e
este. Tem teste (`boardView.test.ts`); nunca teve dogfooding.

## Fatia 20 (SPEC-031) — Briefing público: 9 etapas, rascunho e versão imutável — `finalizado` (#138 fechada com `proplan:finalizado` em 2026-07-27; cabeçalho corrigido em 2026-07-29 — estava `em andamento` por engano, divergindo da Issue)

Issue **#138** (`aprovada-pi` 2026-07-26). Entrega o formulário que a página
`/b/:token` hoje só promete. Fatia grande — vai em **PRs empilhados**, um branch
por PR, todos com base `main` (senão o PR fica sem check nenhum).

### Passos

- [x] **PR-1 — schema, migração, RLS e seed** *(este)*
- [x] **PR-2 — rascunho no servidor** (`PATCH /b/:token/draft`) + `GET /b/:token` estendido
- [x] **PR-3 — formulário React das 9 etapas** + rotas públicas de referência da Etapa 1
- [x] **PR-4 — anexos (`FileAsset`, ADR-025)**
- [x] **PR-5 — submit: `BriefingVersion` idempotente + evento `BriefingSubmitted`**
- [x] **PR-6 — leitura no painel do prestador** *(este)*
- [x] Dogfooding no navegador (parte da entrega, não apêndice — a SPEC-029
      atravessou dois FIX por falta dele)

### PR-1 — o que entrou

Três tabelas com RLS e três de referência sem RLS. A divisão não é detalhe de
implementação, é a regra do §3 da spec:

| tabela | tenancy | por quê |
|---|---|---|
| `briefing_drafts` | bisneta (join até `clients` por 3 níveis) | rascunho é dado do cliente de um tenant |
| `briefing_versions` | neta (join por `client_projects`) | idem |
| `service_catalog_items` | **raiz** (`tenant_id` próprio) | catálogo é curado por tenant |
| `states` · `cities` · `segments` | **nenhuma** | lista do Brasil, igual para todos |

Ligar RLS nas três últimas quebraria a Etapa 1: o formulário público monta o
seletor de cidades **sem tenant no contexto**. Há teste guardando os dois lados
— fail-closed nas primeiras, legibilidade nas últimas.

### `BriefingVersion` é imutável no schema, não só na regra

A tabela **não tem** `updated_at`. A ausência é o contrato: não existe coluna
para registrar uma alteração que não pode acontecer. Os dois uniques carregam
regra de negócio, não só integridade:

- `(client_project_id, version)` — sequencial por projeto; regenerar o link cria
  v2 e a v1 permanece;
- `(briefing_link_id, content_hash)` — **idempotência** do submit: duplo clique e
  retry de rede colidem no índice em vez de gravar dois briefings.

### IBGE entra por arquivo versionado, nunca por request

`prisma/data/ibge-localidades.json` (296 KB, 27 estados / 5.571 municípios)
gerado uma vez da API do IBGE e commitado. O seed lê o arquivo. Motivo na spec:
o formulário público estaria refém de um terceiro no caminho do cliente — IBGE
fora do ar viraria briefing travado. Atualizar é reseed, tarefa de manutenção.

Idempotência conferida rodando o seed duas vezes: 27/5.571/16 estáveis, e o
catálogo foi de 27 itens novos para 0.

### O `FORCE` da RLS pegou o próprio seed

O primeiro `prisma:seed` falhou com `42501: new row violates row-level security
policy`. Não foi bug: `FORCE ROW LEVEL SECURITY` vale **inclusive para o owner**,
que é exatamente o ponto dele. O seed passou a abrir `app.tenant_ids` antes de
escrever no catálogo, mesma mecânica do `PrismaService.withTenant`. Confirmação
de que a policy está ativa — ela barrou quem tinha mais privilégio no banco.

### Anexos ficaram fora deste PR

`FileAsset` não entrou: a spec §4 exige ADR antes do código, e **ADR é do
Cowork**. O **ADR-025** saiu durante este PR (bytes em `bytea`, RLS, 10 MB por
arquivo, gatilho de revisão em 2 GB), então o PR-4 está desbloqueado — mas segue
como PR próprio, não retrofit deste.

### PR-2 — o que entrou

Rascunho retomável, com a validação das 9 etapas no `domain/`. A regra vive
longe do controller porque a spec diz que *"validação de tela é conveniência; a
barreira é a API"* — e isso só é verdade se a regra puder ser testada sem HTTP
nem banco.

**Campo fora do contrato é recusado, não ignorado.** O payload alimenta o
`jsonb` que vira entrada do pipeline de IA; aceitar chave arbitrária deixaria
quem tem o link gravar o que quisesse lá dentro. É o mesmo mecanismo que barra
`tenantId`/`workspaceId` — o critério de isolamento sai de graça da mesma regra.

**Duas funções `SECURITY DEFINER`, não uma.** A `resolve_briefing_draft` nasceu
ao lado da `resolve_briefing_link` em vez de substituí-la: trocar o tipo de
retorno da antiga exigiria DROP+CREATE, e ela continua servindo o caso "só quero
saber se o link vale" sem carregar o `jsonb` de respostas.

**Rate limit também na escrita** (10/min, teto menor que o do GET). Limitar só o
`GET` deixaria o `PATCH` como a porta larga — o critério da spec é *todas* as
rotas públicas de escrita.

### O bug que só o dogfooding pegou

Os 17 testes do service passavam e o card **não saía de `LINK_SENT`**.

Causa: o `ClientsService` assume que o contexto de tenant já está aberto — as
rotas dele são `/t/:tenant`, com `TenantContextInterceptor`. A rota pública não
tem interceptor nenhum. Chamar `transition` fora de `runInTenantContext` fazia o
`findFirst` interno cair no RLS fail-closed, devolver `null` e virar 404 —
silenciosamente engolido pelo `catch` que protege o save.

Os testes não podiam pegar: eles mockam o `ClientsService`, então provavam que a
chamada **acontece**, não que ela **funciona**. Mesma classe do FIX #134 e do bug
que gerou a `resolve_briefing_link` na SPEC-029 — a terceira vez que "teste verde
sobre acesso que não existe" morde nesta frente.

A correção envolve a chamada em `runInTenantContext`. O teste novo não repete o
erro de mockar e confiar: ele registra a **ordem** dos eventos e exige que a
transição aconteça entre o abre e o fecha do contexto.

### Verificado na API real, sem sessão

```
GET  /b/<token>                    → {"status":"valid","step":1,"answers":{},"completedSteps":0}
PATCH /b/<token>/draft (etapa 1)   → {"step":1,"totalSteps":9,"completedSteps":1}
GET  /b/<token>                    → retoma com as respostas da etapa 1
card                               → LINK_SENT → BRIEFING_STARTED, ator null
obrigatório vazio / tenantId / nome de modelo na etapa 9 → 422
etapa opcional vazia               → 200 (ausência é informação)
13 PATCH seguidos                  → 200×5, depois 429
link revogado                      → {"status":"revoked"}, sem vazar respostas;
                                     a linha do rascunho continua no banco
```

### PR-3 — o que entrou

As 9 telas em `/b/:token` **mais** as rotas públicas que a Etapa 1 precisa. O
plano original dizia só "formulário React", mas os dados de referência estavam
semeados no banco desde o PR-1 sem nenhuma rota que os servisse — a Etapa 1
nasceria com seletores vazios e o critério *"selecionar estado filtra as
cidades"* não teria como passar. Decisão do PI (2026-07-27): entram juntos.

| arquivo | papel |
|---|---|
| `briefing-reference.service.ts` | segmentos, estados, cidades e catálogo do tenant |
| `steps.ts` (web) | as 9 etapas do lado da tela — espelho do domain |
| `briefingApi.ts` | `fetch` cru da rota pública, sem `request()` (FIX #136) |
| `StepField.tsx` | um campo por `kind`; componente burro |
| `masks.ts` | telefone, valor e data em pt-BR — formatam, não validam |
| `BriefingForm.tsx` | navegação, autosave, revisão da etapa 9 |

**Três rotas de leitura, não uma.** `GET /b/:token` (estado do rascunho, muda a
cada save) ficou separado de `/catalog` (listas que não mudam durante o
preenchimento) e de `/cities/:state` (5.571 municípios — mandar todos em toda
abertura seria pagar ~300 KB para usar um). Cadências diferentes, rotas
diferentes.

**Cidade exige token válido mesmo sendo dado público.** Sem isso a rota viraria
um proxy aberto do IBGE hospedado na nossa API, com o nosso rate limit. Link
revogado responde nas três o mesmo 404 do inexistente, e o catálogo do tenant
não sai — há teste provando que a query nem chega a rodar.

**A validação da tela é conveniência declarada.** `steps.ts` duplica o contrato
do `briefing-steps.ts` do domain de propósito: evita um round-trip para
descobrir que um obrigatório está vazio. Quem decide é o servidor — quando o 422
discorda da checagem local, a mensagem dele vence e a tela fica na etapa do erro.

#### Máscaras de telefone, valor e data (FIX #152)

Três campos eram `input` de texto cru: `whatsapp` (etapa 6), `desiredDate` e
`budgetRange` (etapa 7). Ganharam máscara **pt-BR** via `mask?: MaskName` na
`FieldDef` — `(62) 98525-0959`, `dd/mm/aaaa`, `R$ 12.500,00`. Campo mascarado
também abre teclado numérico no celular (`inputMode`) e mostra o formato no
placeholder.

**Formatam, não validam** — e isso é a decisão, não o atalho. O domain aceita os
três como texto livre, então máscara que **recusa** entrada transformaria
conveniência de digitação em bloqueio de envio: telefone estrangeiro, "a
combinar" no orçamento, mês sem dia certo. Por isso `31/02/2027` passa: recusar
exigiria decidir o que fazer com data parcial, e `31/0` é inválido no meio de
`31/03/2027` — travaria justamente quem está digitando certo.

- **Valor entra pela direita**, como caixa de supermercado: `12500` → `R$ 125,00`.
  Não exige explicar onde fica a vírgula e evita o clássico mil-vezes-o-valor.
- **Data é texto mascarado, não `<input type="date">`**: o campo é opcional e a
  spec chama de *data desejada*; o picker nativo exige data exata e válida, e
  quem responde muitas vezes só sabe "março de 2027".
- **O hífen do telefone anda.** Até o 10º dígito o número ainda pode ser fixo
  (hífen depois de 4); o 11º resolve a ambiguidade e ele passa para depois de 5.

Puras e fora do React pelo mesmo motivo do `clientDetailView.ts`: o defeito de
máscara é **silencioso**. Perder o último dígito, ou travar quando se apaga no
meio, passa por revisão visual — quem testa digita uma vez, do início ao fim, e
nunca vê. Há teste para os dois casos.

**Campo vazio não vira `""` no payload.** `pruneBlank` remove antes de enviar:
ausência é informação (ADR-014), e `""` no `jsonb` seria indistinguível de "não
informado" para quem lê depois. O teste que prova isso preenche e apaga o campo —
a primeira versão dele passava mesmo com a poda quebrada, porque campo nunca
tocado jamais entra em `answers`.

**Autosave não reenvia etapa que não mudou.** O teto de escrita é 10/min
(PR-2); um autosave ingênuo gastaria a cota indo e voltando entre etapas. O
`savedRef` guarda a impressão do que já foi persistido.

### O que o dogfooding pegou desta vez

A revisão da etapa 9 mostrava **`Segmento: G`** e **`Estado: SP`** — os códigos
gravados no `jsonb`, não os rótulos que a pessoa escolheu. Nenhum teste pegaria:
todos usavam as opções fixas (`kind`, `urgency`), que já traduziam. Só os dois
selects alimentados pela API caíam no buraco, e eles só existem em runtime.

Revisar o que não se entende não é revisar — e a etapa 9 é onde se confirma o
envio. Corrigido passando o catálogo para a `Review`, com teste dedicado.

### Verificado no navegador, sem sessão

```
abrir /b/<token>            → Etapa 1 de 9, 16 segmentos e 27 estados na tela
Continuar com campo vazio   → 2× "obrigatório", nenhuma requisição sai
escolher segmento           → chips do catálogo do tenant aparecem
escolher SP                 → 645 municípios, select destrava;
                              nenhuma requisição para domínio do IBGE
Continuar                   → rascunho no banco SEM city/services vazios;
                              card DRAFT → BRIEFING_STARTED, ator nulo
recarregar                  → retoma na etapa 4, com as respostas
etapa 8                     → "preferência, não um compromisso" em tela
etapa 9                     → 3 níveis explicados; nenhum nome de modelo,
                              nem a palavra "modelo"/"IA" (regex \b)
revisão                     → "Comércio e varejo" / "São Paulo" (após o fix)
revogar durante o preenchimento → "Link cancelado"; rascunho continua no banco
rascunho consumido          → "Briefing recebido", sem formulário
```

~~O `401` do `/auth/me` aparece no console e **não afeta a página**~~ — **corrigido
no FIX #153**: não afetava mesmo, mas o PI reportou no dogfooding, e com razão. A
rota `/b/` passou a pular a checagem de sessão. Um 401 esperado em toda abertura
ensina a ignorar o console — é lá que um 401 de verdade vai aparecer um dia.

#### O `<select>` é desenhado pelo sistema (FIX #153)

A lista aberta de um `<select>` **não** é estilizada pelo nosso CSS — é popup
nativo. Sem `color-scheme: dark` no controle, o navegador assume tema claro:
fundo branco com o nosso `--text2` (quase branco) por cima, e as opções somem.
Foi o que o dogfooding pegou nos cinco combos. Estilizar `option` uma a uma não
resolve — o Windows ignora quase todas as propriedades ali. `dark` fixo e não
`light dark` porque o briefing público tem tema próprio e escuro, independente da
preferência do sistema de quem abre o link.

#### `sistema_web_app`: opção nova entra nos DOIS lados (FIX #153)

*Sistema web + Aplicativo* virou o sexto tipo da etapa 4. O `oneOf` do
`briefing-steps.ts` é **conjunto fechado**: opção acrescentada só no `steps.ts`
da web seria oferecida ao cliente e recusada com **422 no envio** — depois de ele
responder as nove etapas. É a armadilha específica de um espelho declarado, e por
isso o teste percorre os seis tipos no domain, não na tela.

#### Rota pública não pergunta pela sessão (FIX #153)

O `App.tsx` chamava `/auth/me` na montagem de **qualquer** rota, inclusive
`/b/:token`. Lido de `window.location.pathname` direto, e não por `useLocation`,
porque o efeito roda **fora** do `BrowserRouter` (montado no return logo abaixo).

### PR-4 — o que entrou

Anexos do briefing, executando o **ADR-025**: bytes em `bytea`, sob RLS, com
limite duro. É a **única rota do produto em que um estranho sem conta escreve
bytes no banco** — o desenho todo sai dessa frase.

| arquivo | papel |
|---|---|
| `file-signature.ts` | allowlist, limites e **detecção de tipo por assinatura de bytes** |
| `briefing-attachment.service.ts` | upload/lista/remoção (público) e download (autenticado) |
| `briefing-attachment.controller.ts` | `/b/:token/attachments` — Multer + rate limit próprio |
| `file-asset.controller.ts` | `GET /t/:tenant/files/:id` — download com `Content-Disposition` |
| `Attachments.tsx` | a Etapa 5 na tela, com rede própria |

**O tipo vem do conteúdo, nunca do que foi declarado.** `Content-Type` e
extensão são escritos por quem envia — um `.png` que começa com `MZ` é um
executável com nome de imagem. Quem decide é a assinatura dos primeiros bytes, o
único campo do upload que o atacante não controla sem trocar o arquivo de
verdade. SVG ficou **fora** da allowlist de propósito: é XML, executa script, e
não tem assinatura que o distinga de um documento hostil. WebP precisa de duas
janelas (o `RIFF` do byte 0 e o `WEBP` do byte 8) porque `.wav` e `.avi` também
são RIFF — checar só a primeira aceitaria áudio com nome de imagem.

**A cota precisou de uma função `SECURITY DEFINER`.** Somar os anexos já
enviados com um `SELECT` comum devolveria zero: a rota é pública, roda sem
`app.tenant_ids`, e o RLS é fail-closed. A cota viraria decoração e o 6º arquivo
entraria como se fosse o 1º. É a **4ª ocorrência** da mesma classe de problema
nesta frente (rota pública + RLS fail-closed), agora resolvida na primeira
tentativa em vez de no dogfooding.

**Os limites do ADR-025 também viraram CHECK no banco.** A barreira real é a
verificação de assinatura no domain, mas um caminho de escrita futuro que a
esqueça (import, correção manual, migração de dados) esbarra no banco: MIME na
allowlist, `size` entre 1 e 10 MB, `size = octet_length(bytes)` e anexo sempre
com dono. O terceiro é o que impede burlar a cota de 25 MB gravando `size` 1 com
`bytes` grande. Defesa em profundidade custou quatro linhas de DDL e quatro
testes contra Postgres real.

**`file_assets` é raiz de tenancy, não neta.** As irmãs deste bloco herdam o
corte por JOIN até `clients`; esta carrega `tenant_id` na linha. Motivo: o
download autenticado busca por `id` sem passar pelo rascunho, e um JOIN de três
níveis no caminho do download seria a diferença entre uma policy simples e uma
que ninguém relê. O teste de isolamento pede o `bytea` de propósito — um
`SELECT id` filtrado passaria mesmo com policy furada em coluna grande.

**`ON DELETE SET NULL` no rascunho, `CASCADE` na versão.** Apagar o rascunho não
pode levar junto o anexo que uma versão enviada referencia: a versão é imutável
(spec §5) e precisa continuar sabendo quais bytes recebeu. O CHECK de dono
garante que ainda sobra um lado apontando.

#### Divergência da spec §4: a URL assinada não entrou — decisão do PI pendente

A spec pede *"URL assinada de vida curta"* para o download. **Foi implementada a
rota autenticada, sem assinatura**, e a diferença está registrada no
`file-asset.controller.ts`.

Assinatura existe para dar acesso a um cliente **sem credencial** — um bucket,
uma CDN. Aqui os bytes saem da nossa própria API para um browser que já manda o
cookie `proplan_session` (httpOnly): a identidade está provada antes do
controller e o RLS corta por tenant depois dele. Uma assinatura por cima disso
seria um **segundo mecanismo de autorização, mais fraco que o primeiro** (um
link assinado vaza inteiro se copiado; um cookie httpOnly, não), com um segredo
e um relógio novos para manter.

O critério de aceite da spec é satisfeito: sem sessão ou de outro tenant, a
resposta é a mesma de não encontrado (404, nunca 403 — dizer *"existe, mas não é
seu"* confirmaria a existência para quem sonda ids). Se o PI quiser a assinatura
mesmo assim — por exemplo para permitir um link de download compartilhável fora
da sessão —, ela entra depois: o acesso já é por `id`, então é uma camada na
frente, não um redesenho. **Decisão pendente do PI.**

#### O upload não move o card no funil

Anexar arquivo sem responder nada não é "começar o briefing". O rascunho vazio é
criado (o anexo precisa de dono), mas nenhuma etapa é marcada e o card não sai
de `LINK_SENT` — quem move é o 1º save de etapa, como o PR-2 estabeleceu.

#### O que os testes pegaram

O teste da tela pegou um bug de acessibilidade real: o rótulo dos anexos era um
`<span>`, então o `input[type=file]` ficava **sem nome acessível** — leitor de
tela anunciaria só "botão escolher arquivo". Virou `<label htmlFor>` +
`aria-describedby` para a linha de limites.

O `upsert` (em vez de `create`) do rascunho vazio veio de olhar a corrida: dois
uploads simultâneos do mesmo link disputariam a criação, e o segundo bateria no
unique de `briefing_link_id`.

#### Dogfooding no navegador

Feito com link real em `/b/:token`, percorrendo as etapas 1→5 e mexendo nos
anexos pela tela — não só por `curl`.

| caso | resultado |
|---|---|
| PNG legítimo pela tela | 201, aparece na lista, grava com `safe_name` gerado |
| **executável `MZ` com nome `.png` e `Content-Type: image/png`** | **422 em vermelho na tela, nada gravado** |
| **SVG com `<script>` declarado como PNG** | **422, nada gravado** |
| remover pela tela | some da lista e do banco |
| recarregar no meio | rascunho retomado, anexos continuam listados |
| download sem sessão | 401 |
| download com sessão | 200 + `Content-Type` do allowlist, `attachment`, `nosniff`, `private, no-store` |
| card no funil após só anexar | continua onde estava (upload não move) |

Cada upload e remoção gravou `AuditEvent`, como o ADR-025 pede.

**O dogfooding pegou o que os testes não pegavam** (4ª vez nesta frente, mesma
lição do FIX #134): a migration estava aplicada em `proplan_test` — porque o
harness de int-spec aplica sozinho — mas **não** no banco de dev. O primeiro
upload real respondeu **500**, `function briefing_draft_quota(text) does not
exist`. As 891 asserções verdes não pegariam: elas mockam o Prisma ou rodam no
banco de teste. Só `prisma migrate deploy` no dev resolveu — e é por isso que a
spec trata o navegador como parte da entrega, não apêndice.

### PR-5 — o que entrou

O envio (SPEC-031 §5). Fecha o buraco que o **PI encontrou usando o produto**:
preencheu as 9 etapas e o botão da última estava desabilitado, **sem nenhuma
mensagem**. Era intencional (o submit era este PR), mas a tela não dizia isso de
um jeito visível — o aviso existia *abaixo* do painel de revisão, que numa
etapa 9 preenchida fica longe da dobra. Botão morto e silencioso é a pior
combinação: quem responde conclui que o produto quebrou.

| arquivo | papel |
|---|---|
| `content-hash.ts` | serialização canônica + SHA-256 — a chave da idempotência |
| `briefing-submit.service.ts` | versão imutável, anexos, rascunho consumido, evento |
| `briefing-public.controller.ts` | `POST /b/:token/submit` |
| `BriefingForm.tsx` | botão que envia, com erro visível na tela |

**O hash precisou ser canônico.** A ordem das chaves de um objeto JS segue a
ordem de INSERÇÃO, e as respostas chegam etapa por etapa — preencher a 2 antes
da 1, ou voltar e corrigir um campo, produz o mesmo conteúdo com ordem
diferente. Um `JSON.stringify` ingênuo daria hashes diferentes para briefings
idênticos e a **idempotência morreria em silêncio**: o duplo clique voltaria a
criar duas versões e ninguém descobriria até aparecerem dois cards iguais no
funil. Arrays **não** são ordenados — a ordem em que o cliente listou
funcionalidades é informação dele, não ruído nosso.

**Idempotência em duas camadas.** A primeira é a checagem "já enviado?", que
devolve a versão existente em vez de erro — quem clica duas vezes fez a coisa
certa uma vez só, e ver "erro" depois de um envio bem-sucedido assusta sem
motivo. A segunda é o `catch` do `P2002`: dois submits simultâneos com o mesmo
conteúdo colidem no unique `(briefing_link_id, content_hash)`, e o perdedor da
corrida devolve a versão do vencedor. A primeira cobre o caso comum, a segunda
cobre a corrida que a primeira não vê.

**Uma transação para três escritas.** Versão + anexos apontando para ela +
rascunho consumido. Precisam ser atômicos: uma versão sem os anexos seria um
briefing que perdeu os arquivos, e um rascunho não-consumido com versão gravada
reabriria o formulário de um briefing já enviado. Os anexos **ganham** o
`briefingVersionId` sem perder o `briefingDraftId` — não é mover, é acrescentar,
preservando a trilha (ADR-025).

**O que não desfaz um envio já gravado:** mover o card e gravar o audit falham
em silêncio, pelo mesmo motivo do `startBriefing` no rascunho. O briefing é o
dado do cliente; a posição do card é consequência dele.

**A tela de "briefing recebido" é a mesma dos dois caminhos** — quem acabou de
enviar e quem reabre o link depois. Inventar uma segunda página de sucesso diria
a mesma coisa com outras palavras, e as duas precisariam ser mantidas juntas.

#### Dogfooding no navegador

Fluxo completo, link real, etapas 1→9 e envio pela tela.

| caso | resultado |
|---|---|
| submit com briefing vazio | 422 listando **os 8 campos** que faltam, com a etapa de cada um |
| submit sem a confirmação da etapa 9 | 422, nada gravado |
| submit válido | 201 `{versionId, version: 1}` |
| **reenviar o mesmo** | **mesmo `versionId`, `alreadySubmitted: true`** — uma linha só no banco |
| reabrir o link | `{"status":"submitted"}`, **sem** devolver as respostas |
| pela tela | "Briefing recebido", card em `BRIEFING_SUBMITTED`, rascunho consumido |

O teste de tela também pegou uma duplicação: eu havia posto "depois do envio
nada muda" abaixo do botão, e o hint do checkbox de confirmação já dizia isso.
Dois avisos idênticos na mesma tela fazem o segundo virar ruído — ficou um.

#### O card podia ficar para trás em silêncio (FIX #153)

`LINK_SENT → BRIEFING_SUBMITTED` **não existia** em `ALLOWED`. O desenho supunha
que todo submit chega a um card já em `BRIEFING_STARTED`, movido no primeiro save
do rascunho — mas esse move é **best-effort de propósito** (falha nele não derruba
o save, porque o dado do cliente vale mais que a posição do card). Quando ele não
acontecia, o submit encontrava `LINK_SENT`, `canTransition` recusava com 422, e o
**`catch` silencioso** do `moveCard` engolia.

Resultado: **briefing respondido no banco, card parado na coluna "Novo"** — sem
erro em lugar nenhum, sem log, sem nada para investigar. Os dois silêncios são
individualmente corretos (nenhum deles pode derrubar o envio) e juntos produziam
um estado inconsistente invisível. A transição foi acrescentada a partir de
`LINK_SENT` **e** de `DRAFT`: briefing chegando inteiro não é pular etapa, é o
fluxo acontecendo de uma vez.

**Rótulo do card**: `BRIEFING_SUBMITTED` passou a ler **"Briefing respondido"**.
Ao lado de `LINK_SENT` ("Link enviado"), *enviado* aparecia duas vezes com
sujeitos opostos — nós mandamos o link, o cliente mandou as respostas. Do lado de
quem responde o verbo é enviar; do lado de quem lê o board, é responder.

### PR-6 — o que entrou

A leitura no painel (SPEC-031 §6) — o lado do prestador de tudo que os cinco
PRs anteriores gravaram. Fecha a fatia.

| arquivo | papel |
|---|---|
| `briefing-read.service.ts` | estado do briefing, versão em leitura, rótulos |
| `briefing-read.controller.ts` | as duas rotas — **só `@Get`** |
| `briefing-version-immutable.spec.ts` | varre as rotas do módulo pelo metadado do Nest |
| `BriefingVersionPanel.tsx` | o briefing enviado em tela, com seletor de versão |
| `ClientDetailPanel.tsx` | estado do briefing por projeto na gaveta |

**A tradução dos códigos acontece na leitura, nunca no dado.** A versão grava
`segment: "G"`, `state: "SP"`, `city: "3550308"`; o painel precisa de "Comércio
e varejo", "São Paulo", "São Paulo". Reescrever a versão para guardar o rótulo
violaria a imutabilidade do §5 **e** congelaria um nome que a tabela de
referência pode corrigir depois. O servidor resolve na hora e devolve um mapa
`labels` indexado por `<etapa>.<campo>`, ao lado das respostas cruas — a tela
mostra o rótulo, e quem precisar do código ainda o tem. Decisão do PI
(2026-07-27) entre esta e servir o catálogo ao painel: o catálogo exigiria duas
chamadas a mais (segmentos/estados e as 5.571 cidades por estado) para exibir
três campos.

**"Não existe rota de escrita" virou teste de metadado, não de texto.** O
critério de aceite da spec pede *"provado por teste que varre as rotas do
módulo"*. Um grep por `@Patch` no arquivo passaria com um decorator escrito de
outro jeito e falharia num comentário que menciona a palavra. O teste lê
`PATH_METADATA`/`METHOD_METADATA` dos cinco controllers — **o que o roteador
realmente registra**. Ele tem uma âncora deliberada (`routes.length > 5`):
sem ela, um erro na leitura dos metadados viraria "nenhuma rota, logo nenhuma
escrita" — verde e sem valor.

**Nenhum `RequireRole` na leitura, de propósito.** A spec §6 é literal:
*"`viewer` lê; ninguém edita"*. O botão "Ver briefing" fica **fora** do
`canWrite` que protege o "Link de briefing" ao lado dele — copiar a condição do
vizinho seria o erro fácil aqui, e passaria numa revisão visual. Há teste que
renderiza a gaveta com `canWrite: false` e exige o botão de leitura presente e o
de link ausente.

**Progresso pela mesma regra do formulário.** A gaveta chama o
`completedStepCount` do domain, o mesmo que a rota pública devolve a quem
responde. Uma segunda contagem daria "4 de 9" no painel e outra coisa na tela do
cliente, e ninguém saberia qual acreditar. O rascunho considerado é o do link
**ativo e não consumido**: a linha de um link revogado continua no banco (§2),
e contá-la mostraria progresso de um preenchimento que já não pode continuar.

**Rascunho existe mas nenhuma etapa fechou ⇒ "não iniciado".** É o caso de quem
só anexou arquivo. Mesmo critério do funil, que o PR-4 fixou: quem move o card é
o 1º save de etapa, não a criação da linha.

**Falha ao ler o estado não derruba a gaveta.** São N chamadas (uma por
projeto), em paralelo, cada uma com `catch` próprio: a lista de projetos é o
conteúdo principal e o estado do briefing é acessório. Sem o dado, o rótulo cai
em "não iniciado", que é o default honesto.

**A listagem de anexo não arrasta os bytes.** O `select` do Prisma pede
`id/name/mime/size` — são até 25 MB por briefing, e a tela só mostra nome e
tamanho. Os bytes continuam saindo pelo download do PR-4, que já existia e não
precisou de nada novo.

#### O dogfooding pegou a 5ª ocorrência da mesma classe

A etapa 9 mostrava **`Nível de complexidade: alta`** em vez de "Alta". Causa: o
campo `complexity` tem `kind: 'complexity'` (desenha cartões com explicação no
formulário) e por isso nasceu **sem `options`** — quem desenha os cartões não
precisa do mapa, quem só precisa do RÓTULO precisa. Nenhum teste pegaria: os
outros campos de opção fixa (`kind`, `urgency`, `modality`) têm `options` e
traduzem.

É a mesma classe do bug do PR-3 (`Segmento: G` na revisão), agora do outro lado:
lá o rótulo vinha da API, aqui não vinha de lugar nenhum. **A correção foi no
`steps.ts`, não no painel** — pôr o mapa no componente de leitura resolveria a
tela e deixaria a revisão da etapa 9 com o mesmo defeito latente. Uma linha,
dois lugares consertados.

#### Dogfooding no navegador

Fluxo inteiro num cenário real: cliente → projeto → link → 9 etapas → anexo →
envio → **leitura no painel**, mais um segundo envio para exercitar o multi-versão.

| caso | resultado |
|---|---|
| gaveta antes de qualquer resposta | "briefing não iniciado", sem botão de leitura |
| após a 1ª etapa salva | "em preenchimento · 1 de 9" |
| após 5 etapas | "· 5 de 9" — acompanha o formulário |
| após o envio | "briefing recebido em 27/07/2026" + botão "Ver briefing" |
| leitura | as 9 etapas, rótulos traduzidos, anexo com "Baixar · 16 B" |
| etapa não respondida | "Não informado" — não some da tela |
| **regenerar o link e enviar de novo** | **v2 no seletor; v1 continua legível com o conteúdo original e o anexo dela** |
| hora do envio | "às 12:34" no fuso de quem lê, não em UTC |
| sem sessão | 401 nas duas rotas |
| `PATCH`/`DELETE` na versão | 404 — a rota não existe |
| de outro tenant, apontando para o próprio | 404 (não-diferencial) |
| de outro tenant, apontando para o alheio | 403 do `TenantGuard` |
| download do anexo de outro tenant | 404 |

O `fullDate` nasceu recortando a string ISO e foi corrigido antes do commit: o
`submittedAt` chega em `Z`, e recortar mostraria **21/07** para um envio das 22h
de 20/07 no Brasil — "recebido em" com o dia errado. `toLocaleDateString` é o
que o resto do painel já usa.

## FIX #144 — login local travado no consent screen do Google — `feito`

Issue **#144**, PR **#143**. Card `[INFRA][FIX]` criado pelo próprio Code: o
comportamento correto já estava escrito no `docs/DEPLOY.md` §3.1 (`NODE_ENV=production`
obrigatória no serviço `api`) e no `apps/api/Dockerfile:51` — a regra que este FIX
tinha de respeitar é *produção exige login, sempre*.

### Não era bug do código

O fluxo OAuth foi investigado antes de qualquer edição. A API monta a URL de
autorização certa, com `redirect_uri=http://localhost:3311/auth/google/callback`,
e o Google aceita o `client_id` e o redirect — chega na tela de login sem
`redirect_uri_mismatch` nem `invalid_client`. O que trava é **externo ao
repositório**: o consent screen está em modo *Testing* no Cloud Console e recusa
quem não está na lista de Usuários de teste (*"Acesso bloqueado"*). Nenhum deploy
nosso conserta isso.

Por isso o bypass **não substitui** a correção de raiz: adicionar o email em
*OAuth consent screen → Test users*, ou publicar o app. Registrado no `DEPLOY.md` §3.3.

### Três camadas independentes barram produção

| camada | o que garante |
|---|---|
| a regra (`identity/domain/dev-auth-bypass.ts`) | exige `NODE_ENV !== 'production'` **no AND** — produção recusa mesmo com a flag ligada por engano |
| `apps/api/Dockerfile:51` | fixa `ENV NODE_ENV=production` — a trava está assada na imagem, não depende do painel |
| Railway | as variáveis não existem no serviço `@proplan/api` (verificado) |

A redundância é deliberada: o pior caso vira um bypass que **não funciona**, em vez
de um que funciona sem ninguém notar. `.env` copiado, restore de config e
`railway variables` mal aplicado são todos cobertos pela primeira camada sozinha.

A decisão é congelada no **construtor** do guard, não lida por request — ler
`process.env` a cada chamada deixaria o estado da autenticação mutável em runtime.
Em DEV o boot loga um `WARN` dizendo que a autenticação está desligada: **se esse
aviso aparecer em log de produção, é incidente.**

O usuário assumido é **real** (o do seed), não sintético: as rotas `/t/:tenant`
exigem alguém com membership, e um usuário inventado quebraria ali de um jeito
confuso de diagnosticar.

### Verificado na mão, não só por teste

A mesma API com `DEV_AUTH_BYPASS=true` no `.env`, subida com `NODE_ENV=production`
na porta 3399 → **401** em `/auth/me` e **zero** avisos de boot. Em DEV, responde
200 com a sessão completa e o app abre no catálogo.

**24 testes novos** (17 da regra + 7 do guard — que **não tinha teste próprio** até
aqui), incluindo produção recusando com a flag ligada e a flag exigindo a palavra
exata `true`: `1`, `yes` e `TRUE` não ligam. Para algo que desliga autenticação,
permissividade é defeito.

### Rebase antes do merge

O PR foi aberto de `2d87c92` e os três FIX de briefing (#154/#155/#156) entraram
depois, conflitando em `reports/TESTS.md`. O conflito era **só no bloco "Estado
atual"** — que o `TESTING.md` §4 define como regenerado, não acumulado; o histórico
append-only não conflitou. Resolver à mão seria editar artefato gerado, então o
branch foi refeito sobre a `main` atual com o commit de código e o relatório
**regenerado** (`REPORT_DATE`/`REPORT_ISSUE`/`REPORT_PR`), com `test:report --check`
verde. Suítes na base nova: **915 API** (125 suítes) · **252 web**.

Para testar o login real no dev: `DEV_AUTH_BYPASS=false` e **reiniciar** a API — o
`--watch` recompila código mas não relê o `.env`.

---

## SPEC-032 pré-requisito 1 — teto de IA por tenant (ADR-026) — `feito` (issue #157)

**1º dos dois pré-requisitos do §4 da SPEC-032.** Não é fatia: o comportamento
correto já estava escrito e datado no **ADR-026** (aprovado pelo PI em
2026-07-27), então não havia escopo a decidir — só a decisão a executar.

### O defeito, e por que a suíte verde não o via

`Settings.userId` é `@unique` e `capsOf(userId)` resolvia
`personalTenantId(userId)`. Três consequências, todas em produção hoje:

1. **Um tenant com dois membros tinha dois tetos sobre a mesma soma**, sem regra
   de desempate — o veredito do gate dependia de **quem chamou**.
2. **Nem sempre existe um usuário**: o pipeline da SPEC-032 dispara do envio de
   um briefing **público, anônimo**. O gate era literalmente inalcançável a
   partir do caminho que mais precisa dele.
3. `canSpend(projectId)` resolvia `project.userId` — o dono, não o bolso.

Nada disso quebrava um teste, porque **nenhum teste afirmava de quem era o
teto**. O `usage.service.spec.ts` passava `'u1'` para o parâmetro e o mock
devolvia o mesmo teto para qualquer argumento: verde sem provar nada. O mock
agora **recusa** um `tenantId` inesperado — foi a mudança que deu sentido ao
resto.

### Passos

- [x] **`TenantSettings`** (`schema.prisma` + migration
      `20260727150000_adr_026_tenant_settings`): `tenant_id` **UNIQUE**,
      `ENABLE`+`FORCE` RLS como as demais raízes, `CHECK` de não-negativo. As
      colunas `llm_alert_usd_monthly`/`llm_hard_cap_usd_monthly` **saíram** de
      `settings`.
- [x] **Backfill: vence o teto do `owner` de `Membership.created_at` mais
      antiga** (decisão 3). `LEFT JOIN LATERAL` + `COALESCE` para o default —
      tenant sem `owner` não casa no join e recebe 5/20 em vez de `NULL`.
      **One-way e destrutiva por decisão**: os tetos de não-`owner` somem.
- [x] **`capsOf(tenantId)`** — nunca `userId`. Abre o próprio
      `runInTenantContext`.
- [x] **`canSpendForTenant(tenantId)`** — o gate sem sessão que a SPEC-032 vai
      consumir. `canSpend`/`canSpendForUser` continuam, resolvendo o tenant e
      delegando.
- [x] **Guarda de `owner`** (`assertOwner`) + rotas `GET`/`PUT
      /settings/llm-caps`.
- [x] **Tela**: `TenantCapsSection` lê de `/settings/llm-caps`; quem não é
      `owner` vê os números **sem** campo editável.
- [x] **19 testes novos na API** + **5 na web**; `tenant_settings` entrou na
      auditoria de RLS do CI.

### O UNIQUE é a correção, não um detalhe de DDL

Dois tetos para o mesmo tenant era exatamente o estado de que estamos saindo, e
ele vinha **de graça** do modelo antigo (`settings.user_id` UNIQUE = um teto por
pessoa). Pôr o `UNIQUE` no `tenant_id` faz o banco recusar o estado em vez de
confiar que o código não o crie — mesmo argumento pelo qual o ADR-026 rejeitou
"desempatar dentro do `capsOf`": regra que só vive numa função é regra que a
próxima query esquece.

### Por que a guarda de `owner` ficou no service, não no `RoleGuard`

O `RoleGuard`/`@RequireRole` já existe e seria o lugar óbvio, mas ele lê
`req.role` — que quem popula é o `TenantGuard`, e `/settings` é rota **global**,
sem `:tenant` no path. Usar o guard exigiria mover a rota para `/t/:tenant`,
mudança de contrato que ninguém pediu. A checagem mora no `assertOwner`, e o
teste garante que ela recusa **antes** de gravar.

### `canEditCaps` vem do servidor

A tela poderia inferir o papel, mas então teria duas fontes para a mesma regra.
O `GET /settings/llm-caps` devolve `canEditCaps` junto do número, e a tela só
obedece. Sem isso, o não-`owner` veria um campo que a API recusa — pior que
campo ausente, porque parece ter salvado.

### Dogfooding no navegador (2026-07-27) — feito

Migração aplicada no **banco de dev real** e as telas abertas de verdade:

- **Backfill preservou o teto configurado**: 10 USD do `owner`, não o default 20.
- **Escrita pela tela**: 12 → 25 no campo, blur, confirmado no banco.
- **`member` recusado**: com o papel rebaixado no banco, `PUT /settings/llm-caps`
  devolveu **403** e o valor ficou intacto; a tela mostrou os números **sem campo
  editável** e com o aviso *“Só o dono do workspace altera o teto”*.

**Um susto que era meu, não do produto**: a 1ª tentativa de editar pela tela não
persistiu. Causa: eu disparei `blur()` sintético por `js`, e o `onBlur` do React
não roda assim. `PUT` direto na rota gravou, e a edição com `fill` + clique fora
também — o defeito estava no meu script de verificação. Fica registrado porque a
conclusão apressada seria “bug na tela”.

**Watchers órfãos de novo**: 6 `nest --watch` acumulados seguravam a engine do
Prisma (`EPERM` no `generate`) e um `vite` de 08:41 ocupava a 5180, derrubando o
`pnpm dev` inteiro. Matar todos antes de subir.

### Pendente
- [ ] **Pré-requisito 2 da SPEC-032** (extração do módulo `llm`): **o ADR ainda
      não existe**. O §4 da spec pede *"ADR novo + 1º PR"*, e ADR é do Cowork. O
      PI decidiu em 2026-07-27 seguir com a extração **sem** o ADR escrito —
      fica registrado aqui como **débito documental deliberado**, para o Cowork
      carimbar depois. A fatia 21 só abre depois dessa extração.

---

## SPEC-032 pré-requisito 2 — extração do módulo `llm` — `feito` (issue #159)

**Refatoração pura, sem comportamento novo** (SPEC-032 §7.2 e **ADR-027**). Move para um
módulo próprio o que o `artifacts` (Fatia 21) precisa chamar: porta, adapters,
ledger, preço e gate do teto.

### O que motivou

`artifacts` importando `insight/domain/llm-client` é **violação direta e
greppável do ADR-001** — módulos se comunicam por interfaces públicas
exportadas, nunca importando entidade interna de outro módulo.

**Hoje não havia importador externo**: a extração é preventiva. Feita depois
que o `artifacts` existisse, seria refatoração sob pressão de uma fatia grande —
o pior momento para mover fronteira de módulo.

### O que moveu (11 arquivos, todos `git mv`)

| de `insight/` | para `llm/` |
|---|---|
| `domain/llm-client.ts` · `domain/cost.ts` (+spec) | `domain/` |
| `application/llm-usage.recorder.ts` (+spec) | `application/` |
| `application/usage.service.ts` (+spec) | `application/` |
| `presentation/usage.controller.ts` | `presentation/` |
| `infrastructure/{llm-client.factory,anthropic.client,openai-compat.client}.ts` | `infrastructure/` |

`git mv` de propósito: o git registrou os 11 como **rename**, então `git log
--follow` continua achando a história de cada arquivo. Um delete+create teria
apagado o rastro de decisões como o `priceSnapshot` (ADR-016).

### O `UsageService` foi junto, e a lista do §7.2 não o citava

O §7.2 fala em "porta, recorder, fábrica, adapters e preço". O gate do teto não
está lá, mas o **§2.6 manda o `artifacts` verificá-lo antes de enfileirar e
antes de cada capacidade**. Deixá-lo no `insight` só adiaria a violação que a
extração existe para evitar: o `artifacts` importaria `insight` para consultar
dinheiro. Foram junto o `UsageController` e as rotas `/usage/llm` — **que não
mudaram de caminho** (critério de aceite).

### `LlmModule` entrou também no `AppModule`

Chegaria de carona pelo `InsightModule`, mas então a rota `/usage/llm` e o gate
dependeriam de o insight existir. São coisas independentes agora.

### Verificação

- **987 testes verdes**: 984 — exatamente a mesma contagem de antes da
  extração, que é o resultado esperado de uma movimentação pura — mais os 3 do
  arch-spec novo. Nenhuma asserção existente precisou mudar: teste que muda de
  expectativa numa "refatoração" é sinal de que ela mudou comportamento
  (ADR-027, decisão 4).
- **API subida ao vivo**: zero erros no boot, `Mapped {/usage/llm/current-month,
  GET}` e `Mapped {/usage/llm, GET}` idênticas, e `GET /usage/llm/current-month`
  devolvendo o gasto real contra o teto do tenant (`capUsd: 10`, do
  `TenantSettings` da entrega anterior).
- Nenhuma migração de banco.

**`EADDRINUSE` de novo** (3ª vez nesta sessão): a 1ª subida achou a porta 3311
ocupada por instância velha. Se eu tivesse testado a rota sem olhar o log, teria
verificado o código **anterior** à extração e chamado de sucesso.

### O ADR-027 chegou no meio da implementação — e reprovou o 1º corte

A entrega começou como **débito documental**: o §4 pede "ADR novo + 1º PR", o
ADR não existia e o PI mandou seguir sem ele. **O Cowork escreveu o ADR-027
enquanto eu implementava**, e ele nomeia exatamente o que eu tinha feito como a
**alternativa rejeitada nº 2**: *"mover os arquivos e confiar no `exports` do
`@Module`… é o meio do caminho, e é o mais perigoso dos três: dá a aparência de
fronteira enquanto os imports profundos continuam livres"*.

Estava certo. O `exports` do Nest resolve **injeção de dependência**; não resolve
o import de TypeScript, que é onde o acoplamento mora. Meu 1º corte deixava
`artifacts` livre para escrever `from '../../llm/domain/llm-client'` — a mesma
violação do ADR-001, no endereço novo. As decisões 2 e 3 do ADR foram
implementadas depois:

- **Barril `modules/llm/index.ts`** (decisão 2) — superfície pública única e
  explícita. Todo consumidor passou a importar de `'../../llm'`.
- **`llm-public-surface.arch.spec.ts`** (decisão 3) — 3 casos: import profundo
  de fora reprova; o barril precisa exportar os 5 símbolos do ADR; e o `llm` não
  pode importar do `insight` (a dependência foi invertida, e se voltar a
  apontar para lá a extração se desfaz em silêncio).

A 1ª versão do ADR pedia a regra "com `no-restricted-imports`, checada no CI" —
e **o repo não usa ESLint**: não há config nem script de lint em lugar nenhum.
Usei a varredura estática em `*.arch.spec.ts`, o mecanismo da casa para a mesma
classe de regra (`tenant-scope.arch.spec.ts`, `batch-transaction.arch.spec.ts`),
porque o que o ADR exige é *verificação por máquina* — introduzir ESLint no meio
de uma refatoração pura seria escopo que ninguém pediu. **Apontado no PR, o
Cowork corrigiu o ADR no mesmo dia**: o mecanismo virou detalhe de
implementação, a checagem automática continua obrigatória.

**A guarda foi provada reprovando**: com um import profundo reintroduzido de
propósito no `fake-recorder.ts`, o teste falha e **nomeia o arquivo infrator**.
Teste de arquitetura que nunca reprova não protege nada.

**Com isto, os dois pré-requisitos do §4 estão cumpridos e a Fatia 21 (#147)
está liberada para código.**

---

## Fatia 21 (SPEC-032) — Pipeline de IA: artefatos versionados com aprovação humana — `aceita`

> **Aceita pelo PI em 2026-07-28** (issue #147 fechada com `proplan:finalizado`).
> É este aceite que libera a Fatia 22 a codificar — a SPEC-033 §4 condicionava o
> código à aceitação desta fatia, não ao carimbo da spec dela.


Issue **#147** (spec `aprovada-pi` 2026-07-27). Dá consumidor ao evento
`BriefingSubmitted`, que a SPEC-031 deixou solto de propósito. Fatia grande —
**5 PRs empilhados**, um branch por PR, todos com base `main` (senão o PR fica
sem check nenhum).

### Passos

- [x] **PR-1 — schema: 4 tabelas, RLS e o índice parcial**
- [x] **PR-2 — módulo `artifacts`, `inputHash` canônico e o gatilho** → fila
- [x] **PR-3 — as 4 capacidades geradoras** (saída estruturada, retry, teto, ledger)
- [x] **PR-4 — revisor, aprovação e edição humana** (o §7.4 inteiro)
- [x] **PR-5 — leitura e revisão no painel** *(este)*
- [ ] Dogfooding no navegador

### PR-1 — o que entrou

Quatro tabelas novas, e a divisão de tenancy entre elas não é detalhe de DDL:

| tabela | tenancy | por quê |
|---|---|---|
| `artifacts` | **raiz** (`tenant_id` próprio) | as rotas do §6 buscam por `id` |
| `artifact_versions` | **raiz** | idem |
| `artifact_runs` | **raiz** | idem |
| `review_verdicts` | filha por JOIN (até `artifact_versions`) | nunca buscada por `id` solto |

Três raízes é o **oposto** da divisão da SPEC-031, onde `briefing_drafts` e
`briefing_versions` herdam por JOIN — e a diferença é o padrão de acesso, não o
gosto. Lá o rascunho é sempre alcançado pelo token do link; aqui o painel busca
artefato, versão e run **direto por `id`**, e `client_projects` é neta de
`clients`. A policy viraria um JOIN de três níveis no caminho de toda leitura, e
policy que ninguém relê é policy que ninguém audita. O precedente é o
`FileAsset` (ADR-025), que virou raiz pelo mesmo motivo.

### O índice parcial — a decisão mais delicada do PR

O único de idempotência é `(artifact_id, input_hash)` **apenas quando
`author = 'ai'`** (§7.4.2). Duas razões, nenhuma estética:

1. **Versão humana não tem insumo para hashear.** Inventar um hash para texto
   escrito à mão seria mentira com cara de chave.
2. **Sem o `WHERE`, o índice mentiria por omissão.** Ele cobriria linhas de
   `input_hash` NULL, e como NULLs não colidem no Postgres, existiria dando a
   impressão de proteger uma idempotência que nunca protegeu.

**Consequência aceita, anotada na própria migration**: um `regenerate` manual
com insumo idêntico é **recusado** por este índice. A decisão 3 do PI (§2.11)
diz que regenerar sempre cria versão nova — então o **PR-4**, que implementa o
botão, é quem trata a colisão. Não pode virar 500.

### Duas escolhas menores, com motivo

- **`verdict` é `TEXT`, não enum.** Um enum com valor `'reject'` seria convite a
  alguém escrever `WHERE verdict <> 'reject'` no caminho da aprovação —
  exatamente o poder de veto que a decisão 1 do PI recusa (*o revisor anota,
  nunca bloqueia*). O tipo do dado defende a decisão melhor que um comentário.
- **`parent_version_id` é `SET NULL`, não `CASCADE`.** Apagar a versão-pai não
  pode apagar a edição humana que derivou dela: a linhagem perde o elo, o
  trabalho do dono não.
- **`llm_usage.artifact_run_id` sem FK forte**, no mesmo espírito de
  `tenant_id`: o ledger é append-only e sobrevive ao que o originou. Um run
  apagado não pode levar junto o registro de dinheiro já gasto — é o que faz
  *"quanto custou este briefing"* ser consulta ao **ledger** (ADR-016), nunca
  derivação de `ArtifactVersion`.

### Verificação

- **999 testes verdes** (era 987): 11 do int-spec novo + 1 caso na auditoria de
  RLS do CI. Relatório regenerado (ADR-019).
- **Migração aplicada no banco de dev real**, com conferência direta no
  Postgres: RLS `ENABLE`+`FORCE` nas 4 tabelas e o índice parcial com o
  `WHERE (author = 'ai'::"ArtifactAuthor")` exato.
- **A guarda foi provada reprovando**: com RLS desabilitada em
  `artifact_versions`, **3 testes falham** (fail-closed, isolamento e a
  auditoria do CI).

**Uma tentativa de sabotagem não reprovou, e o motivo importa**: remover só o
`FORCE` não muda nada para estes testes, porque eles usam `appClient` (role
`proplan_app`, **não-owner**) e `FORCE` só afeta o owner da tabela. O teste
estava certo; a sabotagem é que não atingia o caminho exercido. Registro porque
a conclusão apressada seria a inversa — "o teste não pega, então é fraco" — e
teria me feito reescrever um teste correto.

### O que o PR-1 deixa cobrado do PR-2

A migration diz isso em comentário, no lugar onde a armadilha mora: **o job não
tem request**. Ler ou gravar sem `runInTenantContext` sob RLS fail-closed **não
dá erro — dá zero linhas**, e um pipeline que gravou zero artefatos tem a mesma
cara de um bem-sucedido visto de fora. Esta frente já acumulou **5 ocorrências**
desta classe, duas encontradas só no dogfooding, todas com a suíte verde.

### PR-2 — o que entrou

Módulo `artifacts` com listener, worker, service e o `inputHash` canônico. **O
run abre, valida e fecha vazio** — `completedKinds: []` diz a verdade sobre o
que rodou. As capacidades chegam no PR-3; um run que se dissesse completo *com*
artefatos aqui seria a mentira que esta fatia existe para não produzir.

O módulo **não importa o `BriefingModule`**: o acoplamento entre os dois é o
*evento*, entregue pelo `EventEmitter2`. O que atravessa a fronteira é o **tipo**
do payload, não um provider — e o briefing continua sem saber que alguém o
escuta, que era o ponto de ter emitido o evento sem consumidor na SPEC-031.

### Duas divergências do texto da spec, e por que ambas

**1. O evento passa a carregar `tenantId`.** O §6 previa lookup próprio no
consumidor. Isso descrevia o evento como ele *era* — sem o campo — não como
precisa ser: o consumidor é um **job, sem request**, e sob RLS fail-closed o
lookup devolveria zero linhas. Resolver exigiria uma função `SECURITY DEFINER`
nova para recuperar um dado que **o emissor já tem na mão** (a linha seguinte do
`submit` o usa no `audit`). Superfície privilegiada se cria quando não há
alternativa; aqui há, e o `DocsSyncedEvent` → `InsightEventListener` já resolveu
o mesmo problema do mesmo jeito.

**2. `canonicalJson` subiu para `shared/`.** O `inputHash` precisa exatamente da
regra do `contentHash`, e `artifacts` importar de `briefing/domain/**` violaria
o ADR-001. Duplicar as 18 linhas criaria **duas verdades** sobre *"estes dois
conteúdos são o mesmo?"*, e uma correção num lado reapareceria como bug de
idempotência no outro. `shared/` já é o lugar desse tipo de utilitário puro
(`convention/columns.ts`, `github/writeback-merge.ts`). O que fica no briefing é
o que é dele: **qual** conteúdo é hasheado.

### Idempotência em duas barreiras, com propósitos diferentes

| barreira | quando vale | custo |
|---|---|---|
| `jobId: briefing_<id>` na fila | enquanto o job existe no Redis | barato, **antes de qualquer gasto** |
| `ArtifactRun` por `briefingVersionId` no banco | sempre | uma query |

A primeira some com o `removeOnComplete`, então um evento reentregue depois
passaria por ela — a segunda é a que garante a regra. O filtro é
`status: RUNNING | COMPLETED` de propósito: um run `FAILED` (teto estourado,
provedor fora) **precisa** poder ser refeito, senão o briefing fica preso para
sempre por uma falha passageira.

### O `promptVersion` dentro do hash é o caso que mais importa

Sem ele, um prompt corrigido devolveria o artefato velho do índice e a correção
**não teria efeito nenhum**. É o pior tipo de bug: o que se parece com sucesso.
O objeto hasheado é montado com chaves fixas, e não repassando o input inteiro,
para que incluir algo no hash seja um ato explícito — quebrar a idempotência de
propósito é diferente de quebrá-la por descuido.

### Verificação

- **1023 testes verdes** (era 999): 12 do PR-2. Relatório regenerado (ADR-019).
- **API subida ao vivo**: `ArtifactsModule dependencies initialized` sem erro, e
  a fila aparece no Redis (`bull:artifacts:meta`) ao lado de
  `insight`/`board`/`sync`.
- O teste do worker afirma a **ordem** (`['contexto:t-1', 'pipeline']`), não só
  que `runInTenantContext` foi chamado: rodar o pipeline antes do `set_config`
  gravaria nada e terminaria "com sucesso".
- O mock do gate **recusa** `tenantId` inesperado em vez de devolver o mesmo
  valor para qualquer argumento — foi essa frouxidão que deixou a suíte do #158
  verde sem nunca afirmar de quem era o teto.

**Erro meu no meio do caminho, que vale registrar**: reportei 1011 numa medição
intermediária. Um `git mv` de teste tinha renomeado `content-hash.spec.ts` para
`.tmp`, e o Jest simplesmente deixou de vê-lo — a suíte ficou verde com 12
testes a menos e nada apontou isso. Restaurado, o número é 1023. Contagem de
teste que cai sem ninguém notar é o tipo de verde que não prova nada, e foi o
`git status` antes do commit que pegou.

### PR-3 — o que entrou

As 4 capacidades geradoras, com prompt e **schema obrigatório** cada uma. O
pipeline passa a gerar de verdade: `normalize` → `scope` → `requirements` →
`site_prompt`, em sequência, cada uma consumindo a saída das anteriores.

Sequencial e **não** paralelo porque a dependência é real — o `scope` lê o
`normalize`. Paralelizar produziria um `scope` que ignora a normalização:
plausível e errado, que é a pior combinação para um artefato que um humano vai
aprovar.

### Um bug pré-existente que a fatia obrigou a encarar

**O ledger não gravava `tenant_id`.** A coluna nasceu na Fatia 8 com um backfill
único e nada nunca a preencheu depois:

| `tenant_id` | linhas |
|---|---|
| preenchido | 79 (todas do backfill de 2026-07-17) |
| NULL | 44 (tudo gravado desde então) |

A policy do `llm_usage` aceita NULL de propósito (histórico órfão pertence ao
tenant ativo, decisão F4 da SPEC-022), então **nada quebrou e ninguém viu**. O
caso em que isso deixa de ser inofensivo é justamente o desta fatia: o pipeline
roda **sem sessão**, e uma linha NULL faria o gasto do briefing de um tenant ser
somado no teto de qualquer um que olhasse.

Corrigido **na raiz** por decisão do PI, não só no caminho novo: `RecordContext`
ganha `tenantId` e `artifactRunId`, e o recorder resolve o tenant a partir do
projeto quando o chamador não informa — por isso **nenhum dos 6 chamadores do
`insight` precisou mudar**.

### Decisões do PR-3

| decisão | por quê |
|---|---|
| **Modelo único da frente** via `LLM_MODEL_ARTIFACTS` + `model?` novo no `LlmRequest` | Env próprio porque o `insight` roda no global; trocar `LLM_MODEL_ANTHROPIC` para Haiku mudaria o resumo de projeto junto. **Não** é o tier→modelo que o ADR-008 rejeita — não há tabela de complexidade escolhendo modelo, é uma frente declarando o seu, uma vez. |
| **Teto antes de CADA capacidade** (§2.6) | São 4 chamadas; o teto pode estourar na 2ª por gasto de outro caminho. Checar só na entrada deixaria o run gastar as quatro. |
| **Teto estourado guarda o parcial como `FAILED`** (decisão 4 do PI) | Jogar fora trabalho já pago porque o 3º passo não coube seria queimar dinheiro duas vezes. |
| **Falha de schema para o pipeline** | `requirements` consome `scope`. Pular para a próxima geraria artefato construído sobre um buraco. |
| **`upsert` no artefato, não `create`** | Ele pode existir de um run anterior que falhou depois dele — `create` estouraria o UNIQUE e transformaria "tentar de novo" em erro. |
| **`extractJsonObject` subiu para `shared/`** | Mesmo argumento do `canonicalJson` no PR-2. |
| **Prioridade barrada na origem** | `"alta"`/`"média"` é o que um modelo produz naturalmente; passariam como texto e quebrariam na SPEC-033, longe daqui. |

Todo prompt carrega a proibição de estimar horas, prazo ou preço (ADR-012 e
MVP3 §9), com teste afirmando isso nos quatro. Um modelo que "estima 40 horas"
produz número plausível e não auditável, e estimativa é da SPEC-033, onde a
conta é determinística.

### Verificação do PR-3

- **1064 testes verdes** (era 1023): 41 do PR-3. **Nenhum teste do `insight`
  quebrou** — a resolução por `projectId` manteve os 6 chamadores intactos.
- **int-spec contra Postgres real** prova que a linha **nasce** com tenant e que
  o gasto de um tenant não aparece na leitura do outro. O mock só provaria que o
  recorder *passa* o valor ao Prisma; o bug corrigido aqui viveu dois meses
  justamente porque nada além do banco o revelava.
- **Guarda provada reprovando**: com `tenantId: null` forçado, 2 int-specs falham.
- **API subida ao vivo** depois de matar instância órfã que segurava a 3311 —
  sem isso eu teria verificado o código **anterior** ao PR e chamado de sucesso.

**A cobertura do project `banco` caiu de 92,6% para 70,6%, e isso não é
regressão**: o `jest.config.js` não tem `collectCoverageFrom`, então a cobertura
mede o que os testes importam. O int-spec novo importa o `LlmUsageRecorder`, e
com ele o módulo `llm` inteiro entrou no denominador de um project que antes
praticamente só media Prisma. O numerador cresceu; o denominador cresceu mais.

**Um erro meu que virou melhoria no teste**: a rodada de sabotagem deixou linhas
com `tenant_id` NULL no banco, e meu `afterAll` limpava **por `tenant_id`** —
não as pegou. A rodada seguinte viu 2 linhas onde esperava 1, e a falha não
tinha nada a ver com o defeito. **Limpeza que depende da coluna sob teste deixa
de limpar exatamente quando o teste falha.** Passou a limpar por
`artifact_run_id`, com limpeza de entrada também, e está provado repetível
rodando duas vezes seguidas.

### PR-4 — o revisor prova por ausência que não bloqueia

O `ArtifactReviewer` roda dentro do run, depois de cada capacidade, e o
resultado vira `ReviewVerdict`. A decisão 1 do PI diz que ele **anota, nunca
bloqueia** — e três coisas garantem isso, nenhuma delas um comentário:

1. **`ArtifactReviewService` nunca consulta `ReviewVerdict`.** Há teste
   afirmando essa ausência: o mock do Prisma não tem `reviewVerdict`, então
   adicionar a consulta estoura, com o motivo escrito ao lado.
2. **`verdict` é `TEXT` livre, não enum** (decidido no PR-1). Um valor
   `'reject'` num tipo fechado seria convite a `WHERE verdict <> 'reject'` no
   caminho da aprovação.
3. **Revisor fora do ar não derruba o artefato** — o `catch` é deliberado.
   Propagar faria o revisor bloquear *na prática* o que ele não pode bloquear
   *por decisão*, e pela pior via: um `catch` ausente que ninguém decidiu.

Outras decisões do PR-4:

| decisão | por quê |
|---|---|
| Aprovar o 4º move o card; 3 de 4 não move (§2.7) | A regra que impede o card de avançar com trabalho pela metade. |
| O ator é o usuário, **nunca nulo** | Diferente do briefing, que move com ator nulo por ser público. Aqui há uma pessoa decidindo. |
| Falha na transição **não desfaz** a aprovação | A máquina de estados pode recusar (card já adiante); isso não pode virar erro numa ação que deu certo. |
| Rejeitar **nunca** move o card de volta | Voltar card por efeito colateral de outra tela ninguém entende depois. |
| Rejeição exige motivo | "Rejeitado" sem porquê deixa a tela sem pista, e quem rejeitou já esqueceu na semana seguinte. |
| Editar devolve o artefato a `PENDING_REVIEW` | O conteúdo mudou depois de quem aprovou ter olhado. |
| Editar recusa pai de outro artefato | Sem o filtro por `artifactId`, a linhagem atravessaria artefatos e a tela mostraria um pai que não é pai. |

**Nenhum `PATCH`/`PUT`/`DELETE` no módulo.** Editar é `POST .../versions` — o
verbo carrega a regra do §6 (*"nada é alterado no lugar"*). O teste que varre os
metadados de rota do Nest, do PR-6 da SPEC-031, foi **estendido ao módulo novo**
como o §5 pede.

### PR-5 — a decisão do revisor, em pixels

A tela mostra o parecer **e** mantém o botão de aprovar habilitado. Dois testes
protegem isso, e o segundo importa tanto quanto o primeiro:

- um monta uma versão com parecer **negativo** e afirma que o botão continua
  habilitado;
- o outro exige a frase *"quem decide é você"* em tela. Sem ela a pessoa lê
  "incompleto" e presume que não deve aprovar — **o veto acontece na cabeça dela
  em vez de no código, com o mesmo efeito**.

As regras de leitura vivem em `artifactsView.ts`, **fora do React**: rótulo de
estado, a distinção entre *não rodou* e *falhou*, e a contagem que autoriza
mover o card. É o que erra sem aparecer em revisão visual — a classe de bug com
5 ocorrências nesta frente (`Segmento: G`, `alta` em vez de "Alta") — e dentro
de um componente só se testaria renderizando.

Duas distinções que a tela mantém, ambas do MVP3 §9:

- **`null` ≠ `FAILED`**: "não gerado" e "falhou" têm textos diferentes.
  Colapsá-los faria *"ainda não usei"* parecer *"usei e deu errado"*.
- **`costUsd: null` ≠ zero**: sem run não há custo a mostrar; com run e zero, o
  zero é o resultado. E a tela diz que o número vem do **ledger**, para não
  sugerir estimativa (ADR-016).

### Verificação da fatia

- **1388 testes verdes**: 1025 regras · 71 banco · 292 tela. Build de produção
  OK. Relatório regenerado (ADR-019).
- API subida ao vivo com as 5 rotas mapeadas e **nenhum verbo destrutivo**.
### Dogfooding (2026-07-28) — o pipeline rodou de verdade

Executado contra o briefing real do **"Projeto EPG2"**, preenchido pelo PI na
SPEC-031. **65 segundos, 8 chamadas ao Haiku, US$ 0,0453.**

| critério §5 | resultado |
|---|---|
| 4 artefatos em `PENDING_REVIEW`, card **não** move pelo job | ✅ |
| 8 linhas no ledger com `tenantId` e `artifactRunId`, custo real | ✅ `price_missing = false` |
| "Quanto custou" vem do ledger | ✅ `costUsd: 0.045301`, bate com o SQL |
| Aprovar 3 de 4 **não** move | ✅ `cardMoved: false` × 3 |
| Aprovar o 4º move para `ARTIFACTS_READY` | ✅ `cardMoved: true` |
| Trilha com ator **não nulo** | ✅ e a linha do briefing, ao lado, com ator nulo |
| Rejeitar sem motivo | ✅ 422 |
| Edição cria v2 `human` com pai, sem hash/modelo | ✅ v1 da IA intacta |
| Tenant alheio / id inexistente | ✅ 403 / 404 |

**O revisor provou seu valor.** Os 4 pareceres apontaram a mesma falha real —
*"o artefato adiciona funcionalidades não mencionadas no briefing"* — e um deles
foi específico ao ponto de perguntar se os R$ 20.000 do briefing cobrem o
reconhecimento facial que o artefato assumiu. É exatamente o que a decisão 1 do
PI queria: anotar o que a pessoa deveria conferir, sem bloquear.

### Três achados do dogfooding

**1. `/artifacts/` sem `/t/:tenant` → 404 (FIX #166, corrigido).** Quatro das
cinco rotas do §6 saíam sem o prefixo de tenant no cliente web. Em tela o
defeito era **mudo**: clicar em "Ver" não mostrava nada — sem conteúdo, sem
parecer, sem erro. Nenhum teste pegou porque **todos mockam a camada de API
inteira**, que é onde `withTenantPrefix` vive: os 13 testes do painel provavam
que a tela *chama* `getArtifactVersion`, nenhum provava que a **URL montada**
estava certa. *Mockar a fronteira esconde defeitos DA fronteira.* Corrigido com
`withTenantPrefix` exportada e 16 testes próprios, guarda provada reprovando.

**2. `jobId` retido bloqueia re-disparo (corrigido).** O job de um run que
falhou fica em `completed` no Redis pelo `removeOnComplete: 50`, e um novo `add`
com o mesmo `jobId` era **descartado em silêncio** — nada no log, nada no banco.
Um briefing cujo pipeline falhou ficava sem gatilho até o job sair da retenção.
Tive de apagar a chave à mão para o dogfooding prosseguir.

Corrigido por decisão do PI: o `jobId` passou a ser **por (briefing,
tentativa)** — `briefing_<id>_<n>`, com `<n>` = runs existentes + 1, contado
dentro de `runInTenantContext` (o listener também não tem request; sem contexto
o RLS devolveria zero e a chave voltaria a colidir, que é o mesmo bug por outra
causa).

**O que se perde, e por que é aceitável**: a barreira da fila deixa de valer
*entre* tentativas. O que continua protegendo é a do banco — `runPipeline`
recusa abrir um 2º run quando já existe `RUNNING` ou `COMPLETED` para o mesmo
briefing, e essa vale mesmo depois de o job sumir da fila. Um evento reentregue
ainda produz um job a mais, mas ele para na 1ª query e **não gasta nada**.

Falha ao contar não impede o enfileiramento: cai num fallback que garante chave
única ao custo da numeração legível. Barrar o pipeline porque a query de um
detalhe de fila falhou seria trocar um problema pequeno por um grande. **Guarda
provada reprovando**: com o `jobId` fixo de volta, 3 testes falham.

**3. Retry automático de 429 não existe.** A decisão 6 do PI (§8) pede *"backoff
automático, 1 retentativa"*. O `runParsed` do recorder só retenta **erro de
parse** — erro de chamada relança direto. E o `attempts: 2` da fila também não
dispara, porque o `runPipeline` captura a exceção e fecha o run como `FAILED`
**sem relançar**: o BullMQ vê o job como sucesso. O run fica `FAILED` com motivo
legível (o que a spec pede para o caso terminal), mas o *automático* está
ausente.

O achado **3 segue em aberto**, por ser decisão do PI: corrigi-lo envolve
escolher entre relançar do service (que retentaria o **run inteiro**, refazendo
capacidades já pagas) e adicionar retry de chamada no recorder (que afeta o
`insight` também). Hoje o run fica `FAILED` com motivo legível — o que a spec
pede para o caso terminal —, mas o *automático* da decisão 6 não existe.

### Verificação no navegador (2026-07-28)

Depois do FIX #166, com API e web de pé:

- O botão **"Artefatos"** aparece só no projeto com briefing enviado.
- O painel mostra **"4 de 4 aprovados — o projeto avançou no funil"** e
  **"Custo desta geração: US$ 0.0453 (do ledger)"**.
- O parecer do revisor aparece **e o botão "Aprovar" fica habilitado** — a
  decisão 1 do PI em pixels, com a frase *"quem decide é você"* em tela.
- Editar promete **"cria uma versão nova"** e **"a versão da IA continua
  guardada"**; o botão é **"Salvar como versão nova"**, não "Salvar".
- **JSON inválido é barrado na tela**, sem ir ao servidor.
- Uma edição real feita pelo navegador gravou **v2 `human`** e devolveu o
  artefato a `PENDING_REVIEW`, com a tela passando a dizer *"3 de 4 aprovados /
  faltam 1 de 4 aprovações"*.

---

## Fatia 23 (SPEC-034) — Contratos: perfil, templates versionados, snapshot imutável e link público — `aceita`

> **Aceita pelo PI em 2026-07-29** — #149 fechada com `proplan:finalizado`, os 6
> PRs mergeados. É este aceite que libera a Fatia 24 a ler `Contract` sem
> emenda: o §4.3 da SPEC-035 condicionava dois dos seus blocos a uma tabela que,
> quando aquela spec foi carimbada, ainda não existia em código.
>
> **A verificação que o §4.3 pedia foi feita, e o papel bateu com o código**: o
> modelo tem `acceptedAt`, `tenantId`, `clientProjectId`, `version` e
> `createdAt` — os cinco campos que a tabela de fontes do §6 da SPEC-035 usa.
> **Nenhuma emenda datada foi necessária.** O palpite do §9 daquela spec ("se
> houver retrabalho de spec no MVP3, começa aqui") não se confirmou.


Issue **#149** (spec `aprovada-pi` 2026-07-28). Congela escopo (SPEC-032) e valor
(SPEC-033) num **contrato-snapshot imutável**, gerado de um template versionado e
acessível ao cliente por **link público auditado e de leitura**, com o aceite
registrado pelo prestador no painel.

**É a fatia com o maior custo de erro do MVP3** (#149), e a razão é dupla: expõe
dado pessoal de duas partes numa URL sem autenticação, e produz um documento que
alguém pode tratar como vinculante. As duas coisas são escopo, não rodapé.

**Liberada em 2026-07-28**: o §4 da spec condicionava o código à entrega da Fatia
22, e a #148 foi aceita (`proplan:finalizado`) nessa data. O `Estimate` que esta
fatia consome existe em código e **foi lido** — foi essa leitura que produziu a
emenda do §8.7 (o contrato carrega **horas**, não dias: o `ScenarioResult` não
tem campo de dias, e o divisor de horas produtivas/dia não existe em fatia
nenhuma do MVP3).

Fatia grande — **5 PRs empilhados**, um branch por PR, todos com base `main`
(senão o PR fica sem check nenhum).

### Passos

- [x] **PR-1 — schema: perfil, templates, contrato, link e `resolve_contract_link`**
- [x] **PR-2 — perfil do prestador + templates versionados**
- [x] **PR-3 — emissão do snapshot** (render escapado, valores como `string`, disclaimer no rodapé)
- [x] **PR-4 — link público `GET /c/:token`** (rate limit, `no-store`/`noindex`, aviso acima do contrato, revogar/regenerar) *(este)*
- [x] **PR-5 — registro do aceite** (canal de lista fechada, ator nunca nulo, move o card) *(este)*
- [x] **PR-6 — a tela do prestador** (perfil, editor de template, painel de contratos, link e aceite) *(este)*

> **A fatia virou 6 PRs, não 5.** O PR-5 do papel era *"aceite + painel"* — uma
> regra de servidor com spec fechada, mais **4 superfícies de tela** (perfil,
> editor de template, contratos, aceite). O `EstimatePanel` da fatia anterior
> tem 616 linhas para **uma** superfície. Separar não foi preferência de
> tamanho: o aceite não tem decisão de UI a tomar e podia entrar hoje; a tela
> tem, e um PR que mistura os dois obriga a revisar regra de negócio e layout no
> mesmo diff.
- [x] Dogfooding do PR-3 no navegador *(pela API, com sessão real — a tela é do PR-5)*

### PR-1 — o que entrou

Cinco tabelas (`provider_profiles`, `contract_templates`,
`contract_template_versions`, `contracts`, `contract_links`), dois enums, a
função `resolve_contract_link` e o seed dos três templates-exemplo. Sem módulo,
sem rota, sem renderização — o que entra aqui é a **forma dos dados**, porque é
a decisão mais cara de desfazer.

**O contrato é snapshot, não referência.** É a regra que organiza a fatia
inteira, e o schema já a reflete: `provider_snapshot`, `client_snapshot`,
`scope_snapshot`, `budget_brl` e `effort_hours` são **cópia**. Se o contrato
lesse o cliente ou a estimativa por FK, corrigir o endereço do cliente meses
depois mudaria em silêncio o que está escrito num documento **já enviado** — e
nada falharia. As FKs que sobram (`estimate_id`, `template_version_id`) existem
para responder *"de onde este número saiu?"*, não para alimentar o texto — e são
`RESTRICT` pelo mesmo motivo do `Estimate.effortVersionId`: `CASCADE` levaria
junto um contrato já entregue, `SET NULL` deixaria o documento órfão da origem.

**`rendered_html` é gravado, não recalculado na leitura.** Renderizar de novo a
cada acesso permitiria que uma mudança no renderizador alterasse, meses depois,
um documento que o cliente já leu.

**`contracts` é raiz de tenancy**; `contract_template_versions` e
`contract_links` são filhas por JOIN. O critério é o padrão de acesso, o mesmo
do `FileAsset` (ADR-025) e do `Estimate`: as rotas de link e de aceite buscam
**direto por `id`** e `client_projects` é neta de `clients` — a policy viraria um
JOIN de três níveis no caminho de uma escrita que move card. As duas filhas nunca
são buscadas sozinhas fora do contexto do pai.

**`expires_at` é NOT NULL — a diferença deliberada em relação ao
`briefing_links`.** Lá a expiração é opcional; aqui o link expõe CPF/CNPJ e
endereço das **duas** partes (§2.7), e link sem prazo seria dado pessoal legível
para sempre por quem tiver a URL. A coluna NOT NULL é o que impede o "esqueci de
definir" — a decisão 6 do PI (48 h) precisa de um lugar onde não dependa de o
service lembrar.

**Os CHECKs, e por que nenhum é decorativo.** Todos barram erro que **não levanta
exceção** e produz um documento plausível:

| CHECK | o que ele impede |
|---|---|
| `contracts_acceptance_triple` | aceite sem ator ou sem canal — é o ato que move o card para `CONTRACT_APPROVED`, e "aceito por ninguém" é o fechamento frágil que este produto existe para detectar |
| `contracts_budget_positive` | R$ 0,00 **com aparência de conta feita**, dentro de um documento que o cliente pode tratar como vinculante |
| `contracts_rendered_html_present` | documento em branco que a rota pública serviria como se fosse o contrato |
| `contract_links_expires_after_creation` | erro de sinal nas 48 h: link morto que a tela mostra como recém-criado |
| `provider_profiles_identity_present` | string vazia passa por `NOT NULL` sem dizer nada — e deixaria uma das partes não identificada |
| `provider_profiles_document_type_valid` | o tipo decide o rótulo ("CPF nº" vs "CNPJ nº"); fora dos dois, rótulo errado no dado que identifica a parte |

**`resolve_contract_link` — e o teste que veio antes do controller.** Espelha a
`resolve_briefing_link` porque o problema é o mesmo e já custou **cinco
ocorrências** nesta frente: `GET /c/:token` não tem sessão, roda sem
`app.tenant_ids`, e o RLS fail-closed devolveria vazio para **todo** token —
inclusive os válidos, sem erro nenhum no log. O §7.2 item 5 exige que o teste de
fail-closed venha **antes** do controller, e veio: escrito depois, ele
documentaria o que foi construído em vez de barrar o que não pode existir.

A função devolve o ciclo de vida do link + tenant + contrato, e **não devolve o
`rendered_html`** — de propósito. Ela responde *"este token serve, e para qual
contrato?"*; o documento é lido depois, já sob o contexto do tenant que ela
devolveu. Assim quem protege o conteúdo continua sendo o RLS, e não a lista de
colunas de uma função privilegiada.

**O seed dos três templates, e por que ele é insuficiente de propósito.** Sem
seed, o prestador encara um editor vazio no dia 1. Com seed, o risco é o texto
ser usado **como veio**, com o produto virando fonte de minuta jurídica sem
advogado por trás (§7.3). Duas barreiras respondem: `isSeedExample = true` (o 1º
contrato exige uma versão salva pelo dono) e o disclaimer no rodapé do documento
renderizado (§2.12) — que viaja junto do que o cliente lê, o lugar certo. A trava
é fraca de propósito: exige **uma** edição, não revisão de verdade. Ela não
garante que o texto foi lido; garante que o dono passou pela tela e assumiu o
texto uma vez, e que o `isSeedExample` deixa de mentir.

**Três templates e não um com seção condicional** (§2.2, decisão do PI):
condicional dentro de texto jurídico é o pior lugar possível para um `if` — quem
lê o template não vê qual versão o cliente recebeu, e um erro na condição produz
um contrato **válido** dizendo a coisa errada sobre propriedade de código. O
teste afirma que as três cláusulas de propriedade intelectual são distintas, e
que só a modalidade de venda **cede** titularidade (as outras concedem licença de
uso).

**O seed nunca sobrescreve.** Template existente não é tocado: ele pode já ter
versões escritas pelo dono, e reescrever o corpo apagaria texto jurídico que
alguém revisou. Reseed é idempotente pelo unique `(tenant_id, modality)`.

### PR-1 — verificação

- **1200 testes em `regras`** (era 1189: +11 do seed de templates) e **124 em
  `banco`** (era 89: +35).
- Migration validada em **banco de teste recriado do zero** (`DROP DATABASE` +
  `CREATE DATABASE`), 38 migrations aplicadas em sequência.
- **Guarda provada reprovando**: com RLS desabilitada em `contracts`,
  `contract_links` e `provider_profiles`, **7 testes falham**; religada, 35/35.
- Migration aplicada no **banco de dev real** e seed rodado: 3 templates com
  `is_seed_example = true` e `current_version_id` apontando para a v1. **Segunda
  execução: 0 novos** — idempotência conferida no dado, não só no código.
- Relatório regenerado: **1689 testes** (1200 regras · 124 banco · 365 tela).

**A guarda do ADR-019 barrou o PR, e estava certa.** O CI do #173 falhou com
todos os 1324 testes passando: o que faltava era a **linha de histórico** no
`reports/TESTS.md` para a issue #149. O `test:report` só a escreve quando recebe
`REPORT_ISSUE`/`REPORT_SPEC`/`REPORT_PR`, e a primeira execução foi sem elas. Sem
o carimbo, a tabela sugere que a entrega não teve teste — que é exatamente o que
o ADR-019 existe para impedir. Corrigido no próprio PR-1, com o comando completo.

### PR-2 — o que entrou

O módulo `contracts` nasce: perfil do prestador, os três templates versionados,
a validação de placeholder e a trava que destrava a emissão. Seis rotas, todas
autenticadas e sob `withTenant` — a rota **pública** chega no PR-4.

**Validação de placeholder ao SALVAR, não ao renderizar** (§2.4). Descoberto na
renderização já é tarde: ou o placeholder errado vaza como **literal cru** no
meio de uma cláusula do documento que o cliente lê, ou derruba a emissão com o
texto jurídico já escrito em cima dele. Recusar ao salvar devolve o erro a quem
pode consertá-lo, na tela em que ele está — e **com o nome do placeholder na
mensagem**, senão a pessoa procura num texto de 2.400 caracteres qual dos
`{{...}}` está errado. A validação devolve **todos** os problemas, não o
primeiro: corrigir um por vez, com um `POST` e um recarregamento a cada volta, é
o que faz alguém desistir e colar o texto de volta sem os placeholders.

**A regex é permissiva de propósito, e isso é a parte que erra sem aparecer.** Se
ela casasse só com o bem formado (`\{\{\w+\}\}`), um `{{client name}}` com espaço
no meio **não seria encontrado** — e o que a validação não vê, ela aprova. O
literal cru reapareceria no contrato do cliente. Há teste afirmando que o
malformado é **encontrado**, não só recusado.

**A trava do seed é por modalidade, não global** (§2.3). Editar o template de
`desenvolvimento` não pode destravar o de `desenvolvimento_venda_codigo`: são
textos jurídicos diferentes, e é justamente a cláusula de propriedade intelectual
que difere entre eles — destravar em bloco emitiria uma cessão de código que
ninguém leu. A trava vive no `requireIssuable` do service, não na tela, para que
a emissão por qualquer caminho que não passe pelo botão também seja recusada.

**`PUT` no perfil é a única escrita-no-lugar do módulo, e é exceção nominal.** A
regra que a guarda de imutabilidade protege é sobre **conteúdo versionado**
(`Contract`, `ContractTemplateVersion`); o perfil **não é versionado** — é um por
tenant, substituído por inteiro, e cada contrato guarda o seu `providerSnapshot`
(PR-1), que é o que preserva o dado como estava no dia da emissão. Salvar
template é `POST .../versions`, porque ali nada é alterado no lugar. A exceção é
**lista de nomes** com teste afirmando que contém exatamente
`['provider-profile']`: afrouxar o filtro deixaria a próxima entrar sem ninguém
decidir — mesmo desenho da exceção de `tenant-settings` na Fatia 22.

**`PUT` e não `PATCH` no perfil**, ainda: um `PATCH` deixaria o endereço antigo
convivendo com o documento novo se o cliente mandasse metade dos campos.

**Ausência é informação (ADR-014)**: tenant sem perfil recebe a forma vazia com
`exists: false`, não um 404 — a configuração ainda não existe, e a tela precisa
saber que é o primeiro preenchimento em vez de mostrar erro. Campo opcional vazio
vira `null`, nunca string vazia: `''` no banco mentiria dizendo "preenchido", e
sairia no contrato como uma linha em branco entre vírgulas.

**`ensureSeeded` no service, além do `prisma/seed.ts`.** O seed cobre os tenants
que existiam quando a fatia saiu; este caminho cobre o tenant criado **depois**,
que sem ele abriria a tela de contratos vazia e não conseguiria emitir nada — um
estado sem saída pela própria UI. Idempotente pelo unique e **nunca sobrescreve**.

**`canEdit` resolvido no servidor** e viajando na resposta, como no PR-4 da Fatia
22: regra duplicada no front divergiria da recusa real no primeiro clique, e a
tela mostraria campo editável para quem a API vai recusar — botão morto, e pior,
um que parece ter salvado.

### PR-2 — verificação

- **1247 testes em `regras`** (era 1200: +47).
- **Guarda de imutabilidade provada reprovando**: um `@Patch('contracts/:id')`
  inserido de propósito faz **2 testes falharem**, nomeando a rota.
- Build OK e **API subida ao vivo** com as 6 rotas mapeadas
  (`GET`/`PUT provider-profile`, `GET contract-templates`,
  `GET .../:modality`, `GET`/`POST .../:modality/versions`), sem `EADDRINUSE`.
- Relatório regenerado **com o carimbo** (`REPORT_ISSUE`/`REPORT_SPEC`/`REPORT_PR`).

### PR-3 — o que entrou

A emissão: o contrato deixa de ser tabela e vira **documento**. Duas regras
puras (`render.ts`, `snapshot.ts`), o `ContractIssueService`, três rotas e o
arch-spec de fronteira que o PR-2 tinha deixado nomeado no `contracts.module.ts`.

**A ordem do renderizador é a decisão inteira do PR**, e é a parte que erra sem
aparecer. Escapa o corpo do template → substitui os placeholders escapando cada
valor no ato → **só então** converte a marcação em tags. Converter por último é
o que garante que as únicas tags do documento nasceram do conversor: qualquer
`<` vindo do template ou de um valor já virou `&lt;` antes, e não há caminho em
que volte a ser tag.

**O escape do valor mora dentro do `substitute`, não em quem o chama.** Foi
assim depois de um defeito real durante o PR: a primeira versão escapava só o
corpo do template, e o teste do critério de aceite do §5 pegou o `<script>` do
nome do cliente **executável** no HTML. Quem monta os valores lê de quatro
fontes (perfil, cliente, escopo, estimativa) — um caminho que esquecesse de
escapar produziria a página pública com a tag viva. Escapar no ponto único por
onde **todo** valor passa é o que torna o esquecimento impossível.

**`{{scope}}` é a exceção, e é uma lista de nomes.** É o único placeholder que
entra com marcação própria (`- item`, `**título**`), porque o `scopeToMarkup`
monta a lista a partir de itens **já escapados um a um**. A exceção é
`MARKUP_PLACEHOLDERS`, com o mesmo desenho da exceção de `provider-profile` na
guarda de imutabilidade: afrouxar para um padrão genérico deixaria a próxima
entrar sem ninguém decidir. E o escape item a item não é zelo: o escopo nasce de
um artefato que a IA gerou a partir do briefing que o **cliente** preencheu.

**Marcação vinda de valor é neutralizada** (`*`, `#`, `_`, `-` viram entidade).
Não é segurança — nenhuma tag nova nasce daí —, é o documento saindo diferente
do que o dono escreveu: um cliente com `**` no nome deixaria metade da cláusula
em negrito. Quem marca é o template; valor é conteúdo, e conteúdo não formata.

**Markdown escrito à mão, sem biblioteca.** O subconjunto dos templates é `#`,
`##`, `- item`, `**negrito**` e parágrafo. Toda biblioteca de markdown aceita
HTML embutido por padrão, e desligar isso corretamente é mais superfície de
configuração do que o conversor inteiro daqui. Numa página que serve dado
pessoal sem autenticação, a superfície menor ganha.

**Dinheiro nunca passa por `Number()`** (§6). O `calculation.ts` serializa
`Prisma.Decimal` como texto de propósito (ADR-016), então a formatação trabalha
**sobre a string**: separa centavos e agrupa milhares por manipulação de texto.
Um teste emite `12345678901234567.89` e afirma o valor íntegro no HTML — com
`Number` no caminho ele sairia arredondado, e o contrato mostraria um número que
a estimativa nunca produziu. Valor que não parece decimal sai como veio, não
como `R$ NaN`: o documento erra em voz alta.

**Emitir não move o card** (§2.6), e isso é provado por ausência: o arch-spec
varre o módulo e afirma que **nenhuma** transição de funil sai dele — nem
`prisma.clientStatusTransition`, nem `.transition(`, nem os literais dos
estados. Emitir duas versões do contrato não pode mexer no funil duas vezes.

**As quatro recusas têm ordem deliberada** — template, escopo, estimativa,
perfil —, cada uma com motivo legível. A pessoa está a um clique de um documento
que vai ao cliente e precisa saber o que falta, não receber um 422 genérico. A
quinta é a menos óbvia e a mais cara: estimativa aprovada **sem cenário provável
legível** é recusada, senão o contrato sairia com o valor em branco — um
documento plausível dizendo nada sobre preço.

**O escopo lido é a versão CORRENTE do artefato aprovado**, não a da IA. Se um
humano editou o escopo, é a edição dele que vale; copiar a da IA descartaria a
correção sem avisar, e o contrato descreveria um escopo que ninguém aprovou.
Mesmo desenho do `exigirEffortAprovado` da SPEC-033. A estimativa é a **última**
aprovada, pelo mesmo motivo.

**`parseScope` é defensivo porque o `content` é `jsonb` editável à mão** (§2.10
da SPEC-032): campo ausente ou com tipo errado vira lista vazia, e a seção some
do documento — nunca um `TypeError` derrubando a emissão.

### Decisões do PR-3

| decisão | por quê |
|---|---|
| **`RenderValues` é `Record<ContractPlaceholder, string>`**, não interface com 12 campos | acrescentar placeholder no PR-2 passa a quebrar aqui até alguém decidir de onde ele sai. Duas listas divergiriam em silêncio, e o placeholder novo apareceria vazio no contrato do cliente |
| **Placeholder sem valor vira vazio**, não literal cru | o desconhecido já foi recusado ao salvar (§2.4); o que chega aqui sem valor é campo opcional em branco, e `{{payment_terms}}` cru no contrato é pior que uma linha vazia |
| **CNPJ na frente do CPF** no `clientSnapshot` | cliente com os dois é pessoa jurídica contratando, e é o CNPJ que identifica a parte |
| **Seção de escopo vazia SOME** do documento | um "Riscos" com lista vazia sugere que ninguém preencheu; o certo é não haver a seção |
| **`paymentTerms` vazio grava `null`**, nunca `''` | `''` mentiria dizendo "preenchido" e sairia como linha em branco no documento |
| **Rotas `POST`/`GET` apenas** | refazer emite versão nova; a anterior continua legível porque pode já ter sido enviada ao cliente |

### PR-3 — verificação

- **1306 testes em `regras`** (era 1247: +59).
- **O critério de aceite do §5 provado como teste, não como comentário**: um
  cliente chamado `<script>alert(1)</script>` aparece como texto no HTML, tanto
  no domain quanto passando pelo service inteiro.
- **A ordem de escape provada nos dois sentidos**: `Bar & Cia` não vira
  `&amp;amp;` (não reescapa) e `<img onerror>` no corpo do template não vira tag.
- **Imutabilidade provada em cima do snapshot gravado**: editar o template ou o
  cliente depois da emissão não altera o `renderedHtml` relido.
- **Guarda de imutabilidade provada reprovando de novo**, agora com as rotas de
  contrato existindo: `@Patch('contracts/:id')` faz **2 testes falharem**.
- Build OK, `tsc --noEmit` limpo e **API subida ao vivo** com as 3 rotas novas
  mapeadas (`POST`/`GET client-projects/:id/contracts`, `GET contracts/:id`),
  sem `EADDRINUSE`.
- Relatório regenerado **com o carimbo** (`REPORT_ISSUE`/`REPORT_SPEC`/`REPORT_PR`).

### PR-3 — dogfooding no navegador

Feito em 2026-07-28 no projeto **EPG2** (cliente Rafaela), pela API real com a
sessão autenticada do browser — **não pela tela**, que é do PR-5. O que a suíte
não pega e o dogfooding pegou está abaixo.

**As quatro recusas saíram na ordem, com dado de verdade.** O estado do dev
tinha as quatro travas armadas ao mesmo tempo, então cada uma apareceu ao
derrubar a anterior — que é exatamente como o prestador vai encontrá-las:

1. `Edite e salve o template desta modalidade antes de emitir o primeiro contrato`
2. `O escopo precisa estar aprovado antes de emitir o contrato.`
3. `Preencha o perfil do prestador antes de emitir o primeiro contrato.`
4. (a 4ª, da estimativa, já estava satisfeita — a Fatia 22 aprovou uma no dev)

**A trava do seed destravou pelo ato certo**: salvar a v2 do template pela rota
do PR-2 virou `isSeedExample=false` e `readyToIssue=true`, e só então a emissão
passou.

**O contrato emitido, conferido como documento e não como JSON**: v1 com
R$ 178.480,00, 770 horas, template v2, estimativa v2, 3.074 caracteres de HTML.
Renderizado no browser, lê-se como contrato — títulos, cláusulas numeradas,
escopo em lista, disclaimer em itálico no rodapé.

**Imutabilidade provada mexendo no dado vivo, não em mock.** Depois de emitir:
trocado o `legalName` do prestador por `NOME TROCADO DEPOIS DA EMISSAO` e salva
uma v3 do template com uma cláusula 11 nova. O contrato v1 relido pela API veio
**byte a byte idêntico** — nome original preservado, cláusula nova ausente,
`templateVersion` ainda 2. E emitir de novo produziu a **v2 com o texto novo**,
com a v1 intacta ao lado: é a diferença entre copiar e referenciar, vista no
banco.

**Emitir não moveu o card — e a prova é temporal.** A trilha de
`client_status_transitions` mostra a última transição às **20:42:44.076**, 16 ms
depois da aprovação do escopo (`reviewed_at` 20:42:44.06). Os dois contratos
foram criados às **20:43:21** e **20:44:17**, e **nenhuma transição** existe
depois disso. O §2.6 vale em produção, não só no arch-spec.

**O teste de XSS refeito com dado hostil no banco.** O nome do cliente virou
`<script>alert(1)</script> & **Cia**` e um contrato foi emitido em cima disso: o
`<script>` aparece **como texto legível** na página, `document.querySelectorAll('script').length` é **0**, o `**` não virou negrito e o `&` saiu como `&amp;` — não
`&amp;amp;`. É o mesmo caso do teste unitário, agora com o dado atravessando
Prisma, `jsonb` e HTTP. Dado de teste restaurado ao fim.

**`&` no nome do prestador foi deliberado.** O perfil foi cadastrado como
`RRB Software & Cia Ltda` justamente para exercer o reescape no caminho real —
saiu correto no documento.

**Duas observações que não são deste PR, registradas para o PI:**

1. **O card regrediu `CONTRACT_PENDING → ARTIFACTS_READY`** quando o escopo foi
   aprovado. É transição permitida (`funnel.ts`) e vem do `moverSeCompleto` do
   `ArtifactReviewService` (Fatia 21), que move o card ao completar os 4
   artefatos — inclusive para trás, quando o card já estava adiante. Não afeta a
   emissão (que não exige estado de card, só escopo e estimativa aprovados), mas
   um card andando para trás por efeito colateral de outra tela é do tipo que
   ninguém entende depois.
2. **O documento do cliente sai sem máscara** (`35027047000123`), porque está
   cru no banco — o do prestador, digitado com máscara, saiu com máscara. O
   contrato imprime fielmente o que existe; formatar no render seria inventar
   apresentação que a spec não pediu. Se o PI quiser CPF/CNPJ normalizado, é
   decisão de produto sobre o cadastro (SPEC-029), não sobre esta fatia.

### PR-4 — o que entrou

O **2º link público do produto** (§7.2): `GET /c/:token`, sem sessão, servindo
um documento que traz CPF/CNPJ e endereço completos das duas partes. Mais as
duas rotas de ciclo de vida no painel (gerar/regenerar e revogar) e a leitura do
estado do link.

**O fail-closed já estava provado antes deste PR.** O §7.2 exige o teste da
`resolve_contract_link` **antes** do controller, e o PR-1 o escreveu — 7 casos
no `contracts-rls.int-spec.ts`, incluindo o que afirma que um `SELECT` direto
sem contexto devolve zero (o bug que a função existe para evitar). Este PR
consome a garantia; não a refez.

**O rate limiter mudou de casa, não foi duplicado.** `SlidingWindowRateLimiter`
saiu de `briefing/domain/` para `shared/`. A fronteira entre módulos proíbe o
`contracts` importar entidade interna do `briefing`, e a alternativa era uma
segunda cópia do mesmo limitador — com os mesmos testes, envelhecendo em
paralelo. Mover custa 3 imports; duplicar custaria para sempre. Os 3 call sites
do briefing seguem verdes.

**`Retry-After` passou a existir de verdade.** O critério do §5 pede o header no
429. O produto **não o emitia em rota nenhuma**: o `description` da
`HttpException` do Nest não vira header — vira `cause`, que morre no servidor. O
comentário do limitador prometia `Retry-After` desde a SPEC-029 e ninguém
entregava. Agora sai por `res.setHeader` antes do throw, provado ao vivo
(`Retry-After: 4`).

**Estado que não serve responde 200, não 404.** O código de status é observável
por quem sonda: um 404 para inexistente e 200 para revogado distinguiria os
dois, que é exatamente a diferença que o não-diferencial (§5) proíbe expor. Os
quatro estados devolvem 200 com a página explicando — e nenhuma delas cita
tenant, cliente, projeto ou id de link.

**O aviso é provado por POSIÇÃO, não por presença.** A SPEC-031 já pagou esse
defeito uma vez, com um aviso invisível na etapa 9. O teste compara o índice do
aviso com o do corpo do contrato: presença é o que passa quando o aviso está no
rodapé que ninguém rola até.

**A página não tem `<form>`, `<button>` nem `<input>`** — ausência provada por
teste. Aceite anônimo seria assinatura sem nenhuma garantia de assinatura
(§2.7); quem registra o aceite é o prestador, no painel (PR-5).

**A página não reescapa o `renderedHtml`.** Ele foi escapado na emissão e é
imutável — reescapar transformaria `&amp;` em `&amp;amp;` e a página exibiria um
documento diferente do que foi emitido. Há teste nos dois sentidos.

**Revogar entrou na lista nominal de exceções da guarda de imutabilidade**, e a
guarda do PR-2 reprovou o PR-4 até que a decisão fosse escrita — que é o
desenho: a exceção aparece no diff. O link é **credencial de acesso**, não
documento; revogar não toca o contrato, e um `DELETE contracts/:id` continua
derrubando o teste.

### Verificação do PR-4

- **1368 testes verdes** em `regras` (era 1306: +62); 124 em `banco`, 365 em `tela`
- `tsc --noEmit` limpo, build OK, as 4 rotas novas mapeadas ao vivo sem `EADDRINUSE`
- **Dogfooding pela API, com o contrato v1 do PR-3**: link gerado com expiração
  em 48 h exatas; os 4 headers conferidos na resposta real (`no-store`,
  `no-cache`, `noindex, nofollow`, `text/html`); aviso acima do contrato;
  revogação com efeito **na requisição seguinte**; rate limit barrando com
  `Retry-After: 4`
- **Auditoria conferida no banco**: 5 eventos, nenhum com IP, user agent ou
  token em claro; o acesso ao link revogado também auditado; token inexistente
  **não** gerou evento (não há tenant a descobrir)

### PR-5 — o que entrou

`POST /t/:tenant/contracts/:id/acceptance` — **o único ato da fatia que move o
card**. Emitir não move (§2.6): emitir duas versões não pode mexer no funil duas
vezes.

**O ator é validado antes de tudo, e a barreira mora aqui de propósito.** O
`ClientStatusTransition.actorUserId` é nullable por decisão anterior — transição
disparada pelo próprio sistema (1º save do rascunho, submit do briefing) não tem
usuário por trás. Então o schema **não** pode barrar ator nulo, e a garantia do
§2.10 (*ator nunca nulo*) precisa de um lugar próprio. Um contrato "aceito por
ninguém" é o fechamento frágil que este produto existe para detectar.

**A checagem vem antes da leitura do contrato**, não depois: chegar até a
escrita para só então descobrir que falta ator deixaria a porta aberta a um
caminho futuro que esquecesse de passar o usuário.

**Canal é lista fechada e a recusa nomeia os válidos.** Texto livre viraria
`whatsapp`, `WhatsApp`, `zap` e `wpp` na mesma coluna, e *"por qual canal os
contratos costumam ser aceitos?"* deixaria de ter resposta. O enum existe no
banco desde o PR-1; a constante do TypeScript é o mesmo fato do outro lado.

**Transição recusada não desfaz o aceite.** Mesmo desenho do
`EstimatesService.approve` e do `ArtifactReviewService`: a máquina de estados
pode recusar (card já adiante), e isso não pode apagar o ato que a pessoa
pediu e que já está gravado. A resposta diz `cardMoved: false` em vez de mentir.

**Aceitar duas vezes é idempotente, não erro.** Dois cliques no mesmo botão não
são um problema a reportar — o que não pode é o segundo mover o card de novo ou
sobrescrever a data e o ator do aceite que realmente aconteceu.

**O link não é revogado ao aceitar** (§8.4) — o cliente relê o que aceitou, até
o prazo acabar. Provado por ausência: nada no service toca `contractLink`.

**A fronteira afrouxou de forma medida, e o arch-spec passou a separar dois
verbos.** Antes ele afirmava que *nenhuma* transição saía do módulo. Agora:
gravar `clientStatusTransition` direto continua **proibido** (escreveria a
trilha por fora da máquina de estados, sem `canTransition` e sem a atomicidade
que o `ClientsService` garante numa transação só), e `.transition(` é permitido
em **exatamente um arquivo** — o do aceite. Se um segundo passar a mover o card,
a lista cresce e o teste cai.

### Verificação do PR-5

- **1396 testes verdes** em `regras` (era 1368: +28); 124 em `banco`, 365 em `tela`
- `tsc --noEmit` limpo, build OK, rota mapeada ao vivo sem `EADDRINUSE`
- **Guarda provada reprovando**: um `.transition(` plantado no
  `contract-issue.service.ts` derruba 2 testes do arch-spec — a fronteira barra
  a emissão voltar a mover o card, não só documenta que ela não move
- **Dogfooding pela API, com o contrato v1 do PR-3**: as 3 recusas na ordem
  (canal fora da lista, canal ausente, contrato alheio), cada uma nomeando os
  canais válidos; aceite movendo `CONTRACT_PENDING → CONTRACT_APPROVED`
- **Provado no banco**: canal, nota e ator gravados; **8 transições** onde havia
  7 — uma só, apesar dos **dois** POSTs (o segundo devolveu
  `alreadyAccepted: true`); as versões v2 e v3 do contrato seguem sem aceite; o
  link não foi revogado pelo aceite

### PR-6 — o que entrou

As **4 superfícies** que o PR-5 deixou de fora, e a razão de terem virado PR
próprio: aceite é regra de servidor com spec fechada, tela tem decisão de UI a
tomar. Um diff que misturasse os dois obrigaria a revisar regra de negócio e
layout no mesmo lugar.

**Perfil e templates viraram página de workspace, não gaveta de projeto.** Os
dois dados são **um por tenant**: abrir pelo projeto A e pelo projeto B editaria
a mesma coisa, e a gaveta sugeriria uma configuração por projeto que não existe.
Entraram como `/t/:tenant/clients/contratos`, irmã de Clientes e Funil, com item
próprio no `GlobalNav`. Emissão, link e aceite ficaram na gaveta do projeto, ao
lado de Artefatos e Estimativa — esses **são** por projeto.

**A URL pública aponta para a API, não para o web** — e esta é a decisão que
mais barato custou por ter sido pensada antes. O `/c/:token` é
`@Controller('c')` no Nest, que devolve o HTML já renderizado; o `/b/:token` do
briefing é rota React. Montada sobre `window.location.origin`, a URL do contrato
cairia no `Navigate to="/"` do `App.tsx` e levaria o cliente ao **catálogo**. É o
defeito que o `briefingUrl` documenta ter pago uma vez, com os papéis trocados —
e o comentário dele foi o que fez a pergunta ser feita aqui.

**O vocabulário do link não foi reimplementado.** `LinkState`,
`LINK_STATE_LABEL`, `generateLabel`, `canRevoke` e `needsRegenerateConfirm` vêm
do `clientDetailView.ts`: o link do contrato tem o mesmo ciclo de vida do de
briefing, incluindo a regra de **confirmar só sobre link válido** (sobre link
morto não há acesso a proteger, e confirmar ali ensina a clicar "sim" sem ler).

**Três linhas novas em `TENANT_SCOPED_PREFIXES`** (`/contracts/`,
`/contract-templates`, `/provider-profile`). É literalmente o FIX #166: sem elas
o aceite e o link sairiam sem `/t/:tenant`, a API devolveria 404 e a tela falharia
**muda** — porque todos os testes de tela mockam a camada de API, que é onde
`withTenantPrefix` vive.

**O painel não reescapa o `renderedHtml`.** Ele foi escapado na emissão e é
imutável; reescapar transformaria `&amp;` em `&amp;amp;` e o painel mostraria um
documento **diferente do que o cliente lê**. Mesmo desenho da página pública do
PR-4, e há teste nos dois sentidos.

**Regras de leitura em `contractsView.ts`, fora do React** — o padrão das duas
fatias anteriores. O caso que justifica o arquivo: **`isAccepted` lê
`acceptedAt`, nunca o estado do card**. O card pode estar em `CONTRACT_APPROVED`
por causa da v1; carimbar "aceito" na v3 por isso afirmaria um fato que não
aconteceu. Dentro de um componente, isso só se testaria renderizando.

### Verificação do PR-6

- **409 testes verdes** em `tela` (era 365: +44), sobre `main` já com o PR-5
- Relatório regenerado (ADR-019): **1396 regras · 124 banco · 411 tela**
- `tsc --noEmit` limpo, build de produção OK, e2e do Playwright passando
- **Guarda provada reprovando**: `duration_days` plantado na lista de
  placeholders da tela derruba 2 testes — a cópia da lista do servidor não pode
  divergir em silêncio, e `web` e `api` são pacotes sem barrel compartilhado

### PR-6 — dogfooding no navegador (2026-07-28)

Com API e web de pé, sessão real, contra o **Projeto EPG2** e os contratos do PR-3:

| o que | resultado |
|---|---|
| Item **Contratos** no menu global → `/t/RodReis/clients/contratos` | ✅ |
| Salvar perfil (`PUT`), conferido no banco | ✅ e-mail e telefone gravados |
| Placeholder inválido recusado **ao salvar**, com o nome na mensagem | ✅ `{{duration_days}}` recusado, **nenhuma versão gravada** |
| Salvar template cria **versão nova**, a anterior segue legível | ✅ v1 e v2 no banco, `is_seed_example` → `f` |
| Aviso "texto de exemplo" some depois da 1ª edição (trava §2.3) | ✅ e a 3ª modalidade segue `t`, intocada |
| Botão **Contratos** na gaveta, junto de Artefatos e Estimativa | ✅ |
| Selo "aceito" **por versão** | ✅ só a v1; v2 e v3 sem selo, com o card em `CONTRACT_APPROVED` |
| Snapshot é cópia, não referência | ✅ o v3 mostra `NOME TROCADO DEPOIS DA EMISSAO` |
| `<script>alert(1)</script>` no nome do cliente | ✅ texto na tela, não executa |
| Link gerado abre o contrato de verdade | ✅ `localhost:3311/c/…`, os 4 headers, `<meta robots>`, aviso acima, expira 31/07 |
| Aceite grava canal, nota e **ator não nulo** | ✅ `presencial` na v3 |
| `cardMoved: false` **não** é erro | ✅ **8 transições** continuam 8 (card já adiante), tela diz "Aceite registrado" sem erro |
| Link **não** é revogado pelo aceite (§8.4) | ✅ seguiu válido |
| Revogar tem efeito na requisição seguinte | ✅ a página passou a dizer "revogado" |

**Um defeito de acessibilidade achado por teste, corrigido na tela.** O selo da
modalidade semeada saía como `"Desenvolvimento· exemplo"` no nome acessível: o
`ml-1.5` dá espaço **visual**, não textual, e um leitor de tela leria as duas
palavras coladas. A saída fácil era afrouxar o matcher do teste; a correção foi
pôr o espaço no texto. É a mesma classe de defeito que o `artifactsView.ts` já
anotou — o que erra sem aparecer em revisão visual.

---

## Fatia 22 (SPEC-033) — Estimativa: cálculo determinístico e decomposição por IA — `entregue`

Issue **#148** (spec `aprovada-pi` 2026-07-28). Consome os requisitos aprovados
da Fatia 21 e produz uma estimativa versionada e reproduzível: horas por tarefa,
três cenários, custos diretos e de IA, contingência e preço final em BRL — **cada
número mostrando a sua conta**.

A regra que organiza a fatia inteira: **a IA decompõe, o código calcula**
(ADR-012 aplicado a dinheiro). Nenhuma multiplicação, soma, cenário ou preço sai
de um modelo de linguagem. O motivo não é purismo: erro de aritmética de IA é
plausível, e erro de soma numa estimativa **não aparece como falha** — aparece
como proposta enviada ao cliente.

**Liberada em 2026-07-28**: o §4 da spec condicionava o código à **aceitação** da
Fatia 21 (não ao carimbo da spec), e a #147 foi fechada com `proplan:finalizado`
nessa data. O contrato de `requirements` que o `EffortEstimator` consome está,
portanto, estável — nenhuma emenda datada foi necessária.

Fatia grande — **5 PRs empilhados**, um branch por PR, todos com base `main`
(senão o PR fica sem check nenhum).

### Passos

- [x] **PR-1 — schema: `estimates`, `effort_breakdown` e os parâmetros do tenant**
- [x] **PR-2 — a 5ª capacidade (`EffortEstimator`) + rotas de decomposição**
- [x] **PR-3 — o cálculo determinístico** (3 cenários, contingência, custos, MVPs) e o `approve` que move o card
- [x] **PR-4 — parâmetros por workspace** (valor/hora, % contingência, câmbio) só-`owner`
- [x] **PR-5 — painel de estimativa no prestador** *(este)*
- [x] Dogfooding no navegador

### PR-1 — o que entrou

Uma tabela nova (`estimates`), um valor novo no enum `ArtifactKind`
(`effort_breakdown`) e quatro colunas em `tenant_settings`.

**`effort_breakdown` entra no enum e NÃO no array.** `ARTIFACT_KINDS` /
`REQUIRED_ARTIFACT_COUNT` (`artifacts/domain/artifact-kind.ts`) continuam sendo
exatamente os 4 da SPEC-032, porque é esse array que gate a transição para
`ARTIFACTS_READY`. O motivo é temporal: o `effort_breakdown` só passa a existir
**depois** desse estado (§2.2 — o botão só aparece com os 4 aprovados). Incluí-lo
ali exigiria 5 aprovações para um estado que hoje exige 4 — quebraria um critério
de aceite **já aceito** da Fatia 21.

**`estimates` é raiz de tenancy**, não filha por JOIN. Mesmo critério das três
tabelas do pipeline e do `FileAsset` (ADR-025), e pelo mesmo motivo: a rota
`POST /t/:tenant/estimates/:id/approve` busca **direto por `id`**, e
`client_projects` é neta de `clients` — a policy viraria um JOIN de três níveis
no caminho de uma escrita que **move card**.

**Os parâmetros são copiados para a linha, não lidos por relação.** Valor/hora,
% de contingência, câmbio e o multiplicador de complexidade viram **snapshot** no
instante do cálculo. Se a estimativa lesse `tenant_settings` por relação, editar
o valor/hora do tenant **recalcularia silenciosamente uma proposta já enviada ao
cliente** — o número em tela deixaria de ser o número que ele recebeu, e nada
falharia. É snapshot que torna "reproduzível" verdade.

O **fator** de complexidade é gravado além do **nível**: a tabela de
multiplicadores (0,85 / 1,00 / 1,30) pode ser revista, e a conta de uma linha já
gravada não pode mudar retroativamente com ela.

**`RESTRICT` na FK para `artifact_versions`**, não `CASCADE` nem `SET NULL`. A
versão do `effort_breakdown` é a **conta que explica o número**: com `CASCADE`,
apagá-la levaria junto a estimativa que o cliente já recebeu; com `SET NULL`,
deixaria o número órfão da decomposição que o produziu. Que o banco recuse e a
decisão seja consciente.

**Quatro CHECKs, e nenhum é decorativo** — todos barram erro que *não levanta
exceção no caminho feliz* e produz número plausível:

| CHECK | o que barra | por que passaria despercebido |
|---|---|---|
| `estimates_approval_pair` | `approved_at` sem `approved_by` | estimativa "aprovada por ninguém" — e é este ato que move o card para `CONTRACT_PENDING` (§2.11 exige ator nunca nulo) |
| `estimates_contingency_range` | contingência fora de 0–100 | `150` no lugar de `15` multiplica o orçamento por 2,5; o total sai maior e parece deliberado |
| `estimates_hourly_rate_positive` | valor/hora ≤ 0 | orçamento de R$ 0,00 **com aparência de conta feita** |
| `estimates_exchange_rate_pair` | taxa sem data (ou vice-versa) | taxa sem data é número sem validade: meses depois ninguém sabe se a cotação era de ontem, e o total em BRL segue exibido como corrente |

Os mesmos CHECKs de faixa existem **nas duas tabelas**, de propósito: a linha de
`estimates` é snapshot e **não herda nada** de `tenant_settings`, então um valor
absurdo pode entrar por um caminho que nunca passou pela tela de parâmetros.

**Câmbio nasce NULL e isso é estado legítimo**, não "falta preencher": sem taxa
informada, o custo de IA aparece em USD, rotulado, e **fora** do total em BRL
(§2.6). Um DEFAULT aqui seria pior que o NULL — inventaria uma cotação que
ninguém digitou e a faria entrar num total que o dono assinaria sem saber.

**Os parâmetros reaproveitam `tenant_settings`** em vez de criarem uma 2ª tabela
de configuração: ela já é por tenant e já só o `owner` escreve (ADR-026), que são
exatamente as duas regras que a spec pede. É também, nominalmente, a "2ª
configuração por tenant" que o comentário do ADR-026 dava como encomendada.

**Divergência da spec, registrada e decidida pelo PI (2026-07-28)**: o §6 pede
`PATCH /t/:tenant/tenant-settings`, mas o teto de IA (ADR-026) hoje vive em
`/settings/llm-caps` — rota **global**, que resolve o tenant por
`personalTenantId(userId)` e não pela URL. As duas rotas vão conviver sobre a
mesma tabela: a nova, sob `withTenant`, para os parâmetros de estimativa (é o que
a spec pede, e o que faz sentido para config de *workspace*); a antiga, intocada.
Decisão do PI ao ser apresentada a divergência, antes de qualquer linha escrita.

### PR-1 — verificação

- **1117 testes verdes** na API (era 1099): **+18** no project `banco`.
- Migration aplicada num **banco de teste recriado do zero** — o SQL foi validado
  de ponta a ponta, não só o `ALTER` incremental.
- **Guarda provada reprovando**: com `ALTER TABLE estimates DISABLE ROW LEVEL
  SECURITY`, **4 testes falham** (3 de isolamento + a auditoria de cobertura).
  Religada, 21/21 verdes.
- `estimates` entrou em `TENANT_TABLES` no `rls-audit.int-spec.ts` — a rede que
  faz uma tabela futura sem policy quebrar o build.
- Relatório regenerado: **1425 testes** (1028 regras · 89 banco · 308 tela).

### PR-2 — o que entrou

A **5ª capacidade** (`EffortEstimator`), a fila `estimates` e as duas rotas de
decomposição. A partir daqui existe artefato de esforço — versionado, revisável
e **inútil até um humano aprovar**, como os outros quatro.

**O schema não tem onde guardar um total.** Esta é a decisão central do PR. O
prompt proíbe somar em três lugares, mas proibir no texto e aceitar no schema
deixaria a proibição valendo **só enquanto o modelo obedecesse** — um
`totalHoras` vindo do modelo entraria numa proposta comercial sem ninguém
conferir a aritmética. O parser monta o objeto com chaves fixas: campo de soma
que o modelo invente é **descartado**, e há teste provando o descarte.

**Faixa fora de ordem nunca vira artefato.** `horasMin ≤ horasProvavel ≤
horasMax` é critério de aceite (§5), e o motivo é o formato do defeito: uma faixa
invertida **não quebra nada na hora** — os três cenários continuam somando, e o
"otimista" só sai maior que o "pessimista". Ninguém lê isso como erro. Junto vêm
três barreiras numéricas que pegam falhas distintas: `1e999` (que `JSON.parse`
devolve como `Infinity`, sobrevive a toda soma e contamina o total **sem nunca
lançar**), zero/negativo (linha que reduz o orçamento em silêncio) e o teto de
2000 h por tarefa (o dígito a mais: `800` virando `8000` não parece errado numa
lista de 30 linhas, mas multiplica a proposta por dez).

**Tarefa pendurada em requisito inexistente é recusada.** Sem isso o modelo
inventaria um requisito, a tarefa entraria na conta, e o total ficaria maior por
um trabalho que ninguém pediu.

**Requisito sem tarefa, porém, anota — não bloqueia.** Recusar o artefato inteiro
jogaria fora as outras tarefas boas, pagando o modelo de novo por elas. A lacuna
vai no conteúdo (`requisitosSemTarefa`) para a tela mostrar e o humano decidir —
mesmo desenho do `ArtifactReviewer`.

**Decompõe a versão CORRENTE do `requirements`, não a da IA.** Se um humano
editou os requisitos (§2.10 da SPEC-032), é a edição dele que vale — decompor a
versão da IA ignoraria a correção e geraria tarefas para requisito que deixou de
existir.

**O `inputHash` é sobre o `requirements`, não sobre o briefing.** O insumo desta
capacidade são os requisitos aprovados: é deles que as tarefas saem. Hashear
`answers` faria o hash mudar por edição de briefing que não afeta a decomposição
e **não mudar** quando alguém corrige um requisito à mão — exatamente ao
contrário do que a idempotência precisa.

**Fila própria (`estimates`), não a do `artifacts`.** A decomposição é gatilho
humano sob demanda; um job dela na fila do pipeline automático disputaria worker
com a geração dos 4 artefatos, que é o caminho crítico de um briefing
recém-enviado.

**A chave da fila conta TODOS os runs do projeto**, e o filtro "certo" seria o
bug. Contar `completedKinds: {has: 'effort_breakdown'}` parece mais preciso e
**reintroduziria o achado do dogfooding da Fatia 21**: run `FAILED` fecha com a
lista vazia, não entraria na conta, a tentativa seguinte reusaria a chave, e o
job retido em `completed` no Redis **engoliria o clique em silêncio**. Contar
demais custa um número maior; contar de menos custa o botão parar de funcionar.

**A fronteira com `artifacts` é decisão, não impedimento técnico.** `estimates`
**não escreve** em `artifacts`/`artifact_versions`/`artifact_runs`: pede ao
`ArtifactsService` (`openExternalRun` · `saveExternalVersion` ·
`closeExternalRun`). `PrismaService` é global, então nada barraria o
`prisma.artifactVersion.create` direto — funcionaria hoje e desmancharia a
fronteira em silêncio. O `estimates-boundaries.arch.spec.ts` varre o módulo e
quebra o build se acontecer, no instrumento da casa (`tenant-scope`,
`llm-public-surface`).

**O mesmo arch-spec prova a ausência de GitHub** (§2.9, §5: *"auditável por
ausência"*): nenhum import de client, nenhuma URL da API. A decomposição em MVPs
é **só dado** — criar issues no repo do cliente mudaria a fronteira do MVP3 §3 e
pede ADR próprio.

**Edição humana não ganhou rota nova**: reaproveita
`POST /t/:tenant/artifacts/:id/versions` da SPEC-032, que já cria versão `human`
com `parentVersionId`. Rota própria duplicaria o contrato de linhagem, e as duas
divergiriam na primeira correção.

**A guarda de imutabilidade foi estendida ao controller novo** — e ela pegou um
caso real: a asserção *"toda rota sob `client-projects` é GET"* deixou de valer
com `POST .../effort-breakdown/generate`, que é escrita legítima (enfileira um
job). O recorte agora exclui ações explícitas (`/generate`, `/approve`,
`/reject`) em vez de proibir toda escrita sob o prefixo, que não era o que a
asserção queria dizer.

### PR-2 — verificação

- **1184 testes verdes** (era 1117): **+67**, sendo 37 do schema da capacidade.
- **Guarda de fronteira provada reprovando**: um `prisma.artifactVersion.create`
  inserido de propósito no service faz o arch-spec falhar **nomeando arquivo e
  linha**. Removido, verde.
- Build OK e **API subida ao vivo** com as duas rotas mapeadas
  (`GET .../effort-breakdown` e `POST .../effort-breakdown/generate`) e o
  `EstimatesController` registrado.
- Relatório regenerado: **1492 testes** (1095 regras · 89 banco · 308 tela).

### PR-3 — o que entrou

O **cálculo**. `domain/calculation.ts` é regra pura — sem Prisma, sem HTTP, sem
Nest —, e é o outro lado do ADR-012: a IA decompôs, aqui o **código calcula**.
Nenhuma linha depende de um modelo de linguagem, e é isso que faz cada número
conseguir mostrar a sua conta.

**`Decimal`, nunca `number`.** Dinheiro em ponto flutuante acumula erro em
frações de centavo (`0.1 + 0.2 !== 0.3`), e numa soma de 30 tarefas × valor/hora
× multiplicador × contingência o desvio deixa de ser teórico. Mesmo motivo pelo
qual `LlmUsage.costUsd` é `numeric` no banco. Na fronteira HTTP os `Decimal`
viram **string**: serializados como número, valores com muitas casas perderiam
precisão exatamente no dado que a fatia existe para manter exato.

**Cada cenário carrega as suas parcelas.** `horasBrutas`, `horas`, `maoDeObra`,
`custosDiretos`, `subtotal`, `contingencia` e `total` viajam separados (§2.5:
*"linha própria e visível… nunca embutida"*). Devolver só o total obrigaria a
tela a redividir para exibir a conta — e uma tela que recalcula é uma **segunda
implementação da regra**, que diverge na primeira correção.

**Os 3 cenários saem de somar as colunas, não de um fator global** (§2.4).
Otimista = Σ`horasMin`, provável = Σ`horasProvavel`, pessimista = Σ`horasMax`. A
diferença importa: a faixa de cada tarefa carrega a incerteza *daquela* tarefa, e
um "provável ±X%" achataria a informação que o modelo produziu item a item.

**A ordem das operações é a conta.** Multiplicador do grau de acabamento →
subtotal → contingência. Aplicar o fator depois faria a contingência ser
calculada sobre horas que não são as do orçamento. E a contingência incide sobre
**mão de obra + custos diretos**: só sobre a mão de obra, uma estimativa com
custo direto alto teria reserva proporcionalmente menor justo onde há mais a dar
errado.

**O custo de IA nunca entra no total dos cenários.** É linha informativa, não
item do orçamento: somá-lo cobraria do cliente o custo de gerar a proposta dele.

**Sem taxa de câmbio, não converte** — `incurredBrl` e `projectedBrl` ficam
`null` e a tela mostra USD rotulado, fora do total (§2.6). Converter com taxa
inventada seria pior que não converter: o número entraria no total e ninguém
saberia que é chute.

**O piso de 3 runs para projetar** (§2.8): média de 1 ou 2 execuções não é média,
é a última execução com cara de estatística — e entraria na conta com aparência
de número medido. Abaixo do piso, cai no campo digitado, rotulado. Com histórico,
o valor é **calculado e o digitado é ignorado**: aceitar os dois deixaria o
número exibido dependendo de qual caminho o código tomou. Em ambos os casos o
rótulo é *"projeção"* — `isCalculated` diz **como** o número veio, não que ele
deixou de ser estimativa.

**Parâmetros viram snapshot na linha** (a decisão do PR-1, agora exercida): a
`Estimate` guarda a conta que foi feita, não uma referência que pode mudar.

**Decomposição em MVPs usa o cenário provável e não inclui contingência** — ela é
do orçamento, não do grupo; distribuí-la faria a soma dos grupos *parecer* o
total sem ser. Ordenação alfabética para a tabela não mudar de ordem a cada
regeneração.

**Leitura defensiva do `jsonb`**: a versão corrente do `effort_breakdown` pode ter
sido **editada à mão** (§2.10 da SPEC-032) e edição humana não passa por schema.
Item malformado é **descartado, nunca corrigido** — adivinhar o que um campo
quebrado queria dizer produziria horas inventadas dentro de um cálculo que existe
justamente para não ter nenhuma. Tarefa sem MVP cai num balde nomeado (`sem
MVP`): some do agrupamento, não do orçamento.

**`POST /estimates/generate` é síncrono**, ao contrário da decomposição: aqui
**não há IA**, só soma e multiplicação sobre dados que já estão no banco.
Enfileirar um cálculo determinístico de milissegundos só adiaria a resposta e
obrigaria a tela a fazer polling por um número já pronto.

**O `approve` que move o card** (§2.11, §7.1) — rota, método e rótulo separados
do `approve` do artefato, porque *"se os dois botões parecerem o mesmo na tela, a
decisão do PI vira ambígua na prática"*. Ator **nunca nulo**: há uma pessoa
decidindo o preço que vai ao cliente. Aprovar duas vezes é **idempotente** (dois
cliques não são um problema a reportar), e transição recusada **não desfaz a
aprovação** — mesmo desenho do `ArtifactReviewService`. **Reestimar nunca chama
`transition`** (§2.12): a versão nova fica disponível e o funil segue de onde
estava.

### PR-3 — verificação

- **1257 testes verdes** (era 1184): **+73**, sendo 44 do cálculo puro.
- As contas dos cenários estão **conferidas à mão** nos testes (20 h × R$ 200 =
  R$ 4.000 · 15% = R$ 600 · total R$ 4.600), e há teste afirmando
  `total = subtotal + contingência` nos três cenários.
- Build OK e **API subida ao vivo** com as 4 rotas mapeadas (`GET`/`POST
  .../estimates`, `GET /estimates/:id`, `POST /estimates/:id/approve`).
- Relatório regenerado: **1565 testes** (1168 regras · 89 banco · 308 tela).

### PR-4 — o que entrou

Os parâmetros de estimativa por workspace (§2.6): duas rotas
(`GET`/`PATCH /t/:tenant/tenant-settings`), a guarda de `owner` e o client de
API no web.

**A divergência do §6, agora exercida.** A spec pede
`PATCH /t/:tenant/tenant-settings`; o teto de IA (ADR-026) vive em
`/settings/llm-caps`, rota **global** que resolve o tenant por
`personalTenantId(userId)`. As duas convivem sobre a mesma tabela, e a diferença
é o **escopo**: parâmetro de *workspace* precisa do tenant **da URL** — com o
tenant pessoal, quem participa de dois workspaces editaria sempre o valor/hora do
seu, achando que mexeu no do cliente. Decisão do PI antes de codar.

**O papel vem do `TenantGuard`**, não de uma query nova. `req.role` já está
resolvido para a URL — diferente do `SettingsService`, que consulta a membership
à mão porque `/settings` é rota global sem `TenantGuard`.

**`canEdit` é resolvido no servidor** e viaja na resposta: regra duplicada no
front divergiria da recusa real no primeiro clique, e a tela mostraria campo
editável para quem a API vai recusar — botão morto, e pior que morto: um que
parece ter salvado.

**A data do câmbio é do servidor, nunca digitada.** Ela responde *"quando esta
cotação foi informada"*; aceitá-la do cliente permitiria carimbar hoje uma taxa
do ano passado — exatamente a confusão que o par taxa+data existe para evitar.

**`null` limpa a taxa; ausente não toca.** A distinção viaja do corpo HTTP até o
banco porque limpar é decisão legítima: cotação velha é pior que nenhuma, já que
segue exibida como se fosse corrente — e sem o `null` não haveria como voltar
atrás depois de digitar uma vez. Os dois campos saem juntos (o CHECK do PR-1
exige o par).

**Validação no service além do CHECK no banco.** Os limites já estão no
`tenant_settings` desde o PR-1; aqui eles ganham **motivo legível** em vez de
virarem um 500 de constraint. O CHECK continua sendo a barreira que vale para
qualquer caminho de escrita — inclusive um `UPDATE` à mão no psql.

**`PATCH` é o único verbo de alteração-no-lugar do módulo**, e a guarda de
imutabilidade ganhou **exceção nominal** para ele. A regra que ela protege é
sobre *conteúdo versionado* (`ArtifactVersion`, `BriefingVersion`); configuração
de workspace **não é versionada** — o valor/hora corrente é um só, e cada
`Estimate` já guarda o seu snapshot (PR-1), que é o que preserva a conta de uma
proposta enviada. A exceção é uma **lista de nomes**, não um padrão genérico:
afrouxar o filtro deixaria a próxima exceção entrar sem ninguém decidir, e há
teste afirmando que a lista contém exatamente `['tenant-settings']`.

**`/estimates/` e `/tenant-settings` entraram na allowlist do `withTenantPrefix`**
— literalmente o FIX #166. Sem isso as chamadas sairiam sem `/t/:tenant`, a API
devolveria 404 e a tela falharia **muda**, porque todos os testes do web mockam a
camada de API e nenhum passa por essa função. O `tenantPrefix.test.ts`, que
nasceu daquele bug, foi estendido com as 5 rotas novas.

**A UI dos parâmetros fica no PR-5**, junto do painel: é lá que o usuário está
quando precisa mudar valor/hora, e uma seção em `/settings` (rota global, sem
tenant na URL) teria de escolher um workspace arbitrário para editar.

### PR-4 — verificação

- **1278 testes na API** (era 1257) e **311 no web** (era 308).
- **Duas guardas provadas reprovando**: (1) um `@Patch('estimates/:id')` fora da
  exceção faz a guarda de imutabilidade falhar **nomeando a rota**; (2) remover
  `/estimates/` da allowlist derruba 2 testes do `tenantPrefix`.
- Build OK e **API subida ao vivo** com `GET` e `PATCH /t/:tenant/tenant-settings`
  mapeadas.
- Relatório regenerado: **1591 testes** (1189 regras · 89 banco · 313 tela).

### PR-5 — o que entrou

O painel de estimativa, que fecha a fatia: parâmetros do workspace, os dois
passos (decompor → calcular), as versões, a conta inteira em tela e o botão que
move o card.

**Os dois "aprovar" não podem parecer o mesmo botão** (§7.1) — e isso vive em
texto, não em intenção. O que move o card se chama **"Aprovar estimativa e
avançar o card"**, com a frase *"não confundir com aprovar a decomposição, que
só marca as tarefas como revisadas"* logo abaixo. Enquanto a decomposição está
pendente, o passo 1 diz que aprová-la **não** move o card. Sem essas frases,
alguém aprova a decomposição, vê o card parado e conclui que o sistema não
funcionou — a decisão do PI viraria ambígua na prática.

**Nada na tela recalcula.** `scenarioLines` monta as parcelas na ordem da conta a
partir do que o servidor mandou; há teste passando um `totalBrl` propositalmente
inconsistente para provar que a tela **exibe o que recebeu**. Uma tela que refaz
a conta é uma segunda implementação da regra.

**Regras de leitura em `estimatesView.ts`, fora do React** — mesmo motivo do
`artifactsView.ts`: é o que erra sem aparecer em revisão visual. `complexityLabel`
existe porque o dado é `'media'` **sem acento** e exibi-lo cru já produziu defeito
nesta frente (a etapa 9 mostrava `alta` no dogfooding da SPEC-031).

**O botão aparece de `ARTIFACTS_READY` em diante**, e continua depois de o card
avançar: a estimativa aprovada precisa seguir consultável — é dela que o contrato
(SPEC-034) tira o valor.

### Dogfooding (2026-07-28) — o ciclo inteiro contra dados reais

Feito no "Projeto EPG2", o mesmo da Fatia 21.

- **Decomposição real**: 31 tarefas em ~18 s, **US$ 0,0173** no ledger. As
  garantias do schema **valeram no dado de verdade**: 31/31 faixas com
  `min ≤ provável ≤ máx`, 2 grupos de MVP, e o `content` com **exatamente**
  `tarefas` e `requisitosSemTarefa` — nenhum total escapou do modelo.
- **Cálculo conferido à mão em tela**: 770 h × R$ 200 = R$ 154.000 · +R$ 1.200 de
  custo direto = R$ 155.200 · 15% = R$ 23.280 · **total R$ 178.480**. Os
  subtotais por MVP (660 + 110 h) somam exatamente o provável.
- **Reestimar criou v2 e preservou v1** (R$ 177.100), como o §2.10 exige.
- **Aprovar moveu o card** `ARTIFACTS_READY → CONTRACT_PENDING` com ator não
  nulo e uma linha na trilha; a **2ª aprovação devolveu `alreadyApproved: true`,
  `cardMoved: false`** e a trilha continuou com **uma** transição.
- Custo de IA em USD, rotulado e **fora** do total, com o aviso em tela.

**Um achado de ambiente, não de código**: a primeira tentativa deu **404 na rota
de estimativas**. A causa foi `EADDRINUSE` **silencioso** — uma instância da API
de horas antes ainda segurava a porta 3311, a nova morreu no boot, e a velha (sem
as rotas desta fatia) respondeu. É a classe já registrada no repo; o que ela custou
aqui foi um diagnóstico inicial errado. **O painel se comportou bem no incidente**:
mostrou o 404 em tela em vez de falhar mudo.

**Duas limitações do headless, verificadas como não sendo bug do produto**: o
`fill`/`type` do browse não dispara o `onChange` de input controlado do React (o
valor entra quando o evento nativo é disparado corretamente — testado), e o
clique no botão de aprovar não chegou ao servidor pelo mesmo motivo. **A rota foi
exercitada por `curl` e o resultado conferido no banco** — o comportamento do §2.11
está provado, só não pelo caminho do clique sintético.

### PR-5 — verificação

- **365 testes no web** (era 311): **+54**, sendo 30 das regras puras e 22 do
  painel.
- Build do web OK, `tsc --noEmit` limpo.
- Relatório regenerado: **1643 testes** (1189 regras · 89 banco · 365 tela).

---

## Fatia 24 (SPEC-035) — Dashboard: retomada, funil de clientes e Kanban de repos — `entregue`

> **Entregue em 2026-07-29** — os 4 PRs mergeados (#179, #180, #181, #182),
> `proplan:done` aplicado na #150. **Aguardando o aceite do PI**, que é quem
> fecha a issue e aplica `proplan:finalizado` (ADR-011).
>
> **Fecha o MVP3 em código**: as seis fatias (19–24) estão entregues, e esta era
> a última.
>
> **Dois critérios do §5 merecem nota explícita, para o aceite ser informado:**
> *"nenhuma tabela nova na migração"* é verdade por construção — a migração tem
> **uma coluna** e nenhum `CREATE TABLE`. Já *"usuário de outro tenant recebe a
> mesma resposta de não-encontrado"* tem cobertura **indireta** pelo
> `TenantGuard` (que barra não-membro com 403 e tem testes próprios), mas **não
> há teste específico do dashboard** afirmando isso. Registrado como o que é: um
> critério satisfeito por herança, não por prova local.

Issue **#150** (spec `aprovada-pi` 2026-07-28). **6ª e última fatia do MVP3.**
Acende o item `Dashboard` que a Fatia 19 deixou desabilitado com
`title="Disponível na Fatia 24"` em `GlobalNav.tsx`.

**Não é um resumo do funil — é uma tela de retomada** (decisão do PI): *o que
andou por aqui*, *o que espera por você*, o funil de clientes e o Kanban de
repos, lado a lado, **sem nenhum número somando os dois domínios** (ADR-023).

**O risco desta fatia não é técnico, é de honestidade.** Dashboard é a tela mais
fácil de encher com número bonito, e o MVP3 §9 proíbe exatamente isso: ou o
número tem origem rastreável em linhas do banco, ou não existe. Cada card
precisa responder *"de qual `SELECT` você saiu?"*.

**A dependência do §4.3 foi verificada e não gerou emenda.** A SPEC-035 foi
carimbada com a `Contract` ainda inexistente em código, e o §9 registrou o
palpite de que o retrabalho de spec do MVP3, se houvesse, começaria aqui. A
Fatia 23 foi aceita em 2026-07-29 e o modelo real tem os cinco campos que a
tabela de fontes usa (`acceptedAt`, `tenantId`, `clientProjectId`, `version`,
`createdAt`). **Papel e código bateram** — os três pontos que o cabeçalho da
spec mandava reler continuam válidos como escritos.

Fatia grande — **4 PRs empilhados**, um branch por PR, todos com base `main`
(senão o PR fica sem check nenhum).

### Passos

- [x] **PR-1 — o agregador**: superfície de resumo nos 5 módulos-fonte,
      `GET /t/:tenant/dashboard`, período com fuso, `stalled_days` e o arch test *(este)*
- [x] **PR-2 — *Esperando você*: a fonte do "parado", o drill-down e o contador** *(este)*
- [x] **PR-3 — o bloco de repos ao vivo** (`GET .../repos`) + as 4 salvaguardas do §2.11 *(este)*
- [x] **PR-4 — a tela React** + menu (acende o item, some sem cliente, contador ao navegar/foco) *(este)*
- [x] Dogfooding do PR-4 no navegador — a fatia inteira, com sessão real e falha real do GitHub

> **O PR-1 entrega mais do que "o schema"**, ao contrário do 1º PR das fatias
> anteriores. A razão é a fronteira: esta fatia quase não tem schema (uma coluna
> de configuração), e o que ela tem de caro é a **composição** — cinco módulos
> passando a expor um resumo por tenant. Separar "as superfícies" de "o
> agregador que as usa" produziria um PR inteiro de código sem chamador, que não
> dá para revisar: não se vê se o formato serve antes de alguém consumi-lo.

### PR-1 — o que entrou

**Cinco services de resumo, um por módulo-fonte, e um agregador que só compõe.**

A descoberta que organizou o PR: **nenhum módulo expunha contagem por tenant**.
Tudo o que `clients`, `artifacts`, `estimates` e `contracts` oferecem é *por
projeto* — `getBoard`, `byClientProject`, `list(tenantId, clientProjectId)`. O
dashboard faz uma pergunta diferente (*"o que no tenant inteiro espera por
alguém"*), e ela não tinha superfície.

Havia duas saídas. A barata era o agregador consultar `client_projects`,
`artifacts` e `contracts` direto — e é **exatamente** o que o §5 manda o
`dashboard.arch.spec.ts` quebrar o build para impedir. A escolhida foi a que a
spec descreve no §2.1: cada módulo ganha um `*-summary.service.ts`, exportado
pelo `@Module`, e o agregador **só chama service público**.

| service | módulo | o que responde |
|---|---|---|
| `ClientsSummaryService` | `clients` | funil por coluna · cards parados · `hasAnyClient` · trilha de transições |
| `ArtifactsSummaryService` | `artifacts` | artefatos em `PENDING_REVIEW` |
| `EstimatesSummaryService` | `estimates` | briefing sem estimativa **ou** estimativa sem aprovação |
| `ContractsSummaryService` | `contracts` | contratos sem aceite · contagem no período · `hasAny` |
| `ActivitySummaryService` | `activity` | auditoria e syncs do tenant |

**O agregador não recebe `PrismaService`, e isso é o mecanismo — não o estilo.**
Sem o cliente injetado, não existe caminho para consultar tabela de outro módulo
nem por acidente. O arch test prova por varredura (o `PrismaService` é global e
o `exports` do Nest resolve *injeção*, não import de TypeScript — ADR-027), e há
um teste comparando o construtor. Duas provas porque o risco aqui é maior que no
`estimates`: são **cinco** módulos lidos, e cada bloco da tela é uma tentação de
"só um `count` rapidinho".

**Zero é resultado; ausência é outra coisa** (§2.7). `COUNT(*)` devolve `0` para
*"usei e deu zero"* e para *"nunca usei"*, e colapsá-los faz o segundo parecer o
primeiro — o §5 chama isso de o defeito mais provável desta tela. Por isso
`hasAnyClient` e `ContractCounts.hasAny` viajam na resposta, **fora do recorte de
período**: a pergunta que eles respondem é *"esta funcionalidade já foi usada
alguma vez"*, e uma janela de 30 dias responderia outra coisa.

**O contador é o tamanho da lista, por construção.** `pendingCount` chama
`pending` e conta — não reimplementa a soma. É o que torna impossível o número
do menu divergir da lista da tela: um contador que somasse por conta própria
divergiria na primeira regra que mudasse só de um lado, e aí o contador vira
enfeite (§2.3). A rota é separada porque é chamada a cada navegação; o **caminho
de dado é o mesmo**.

**O período recusa valor fora da lista, nunca corrige em silêncio** (§6).
Corrigir caladamente faria um erro de front virar dado errado em tela: a
contagem apareceria plausível, de uma janela que ninguém pediu.

**A virada de mês acontece em `America/Sao_Paulo`, não em UTC** (§2.9). Linha
criada às 22 h de 31/07 BRT é 01 h de 01/08 em UTC; cortar o mês em UTC jogaria
essa linha para agosto e julho perderia o próprio último dia. Erro que só
aparece ao fechar o mês, quando ninguém está mais olhando o código que o causou
— e por isso o teste cobre a virada de mês e a de ano explicitamente.

**"O que andou por aqui", e não "onde eu parei"** (§7.1). Confirmado no schema
durante a implementação: `AuditEvent` e `SyncRun` **não têm coluna de ator** —
só `client_status_transitions` tem. O bloco é rotulado por **tenant**, e o ator
não entra na projeção. Projetá-lo só na trilha que o tem produziria uma lista em
que um terço das linhas tem nome e o resto não, que é pior que nenhuma ter. Há
teste afirmando o `select` sem ator, para que a promessa não volte por descuido.

**Nenhum índice novo — e a verificação disso custou duas tentativas.** As
consultas por tenant sobre `contracts` e `artifacts` pediam índice (§2.1), e a
primeira versão do PR criou um. A migração falhou com `42P07`
(*relation already exists*): `contracts_tenant_id_created_at_idx` **já existia**,
criado pela SPEC-034.

O diagnóstico inicial dessa falha foi **errado** — concluí que o índice existia
no banco mas não no `schema.prisma`, e "corrigi" o schema, que na verdade já o
declarava. O resultado foi um `@@index` duplicado, e quem o pegou foi o **CI**:
`prisma generate` recusa nome de constraint repetido (`P1012`), então o build
quebrou antes de qualquer teste rodar.

O registro fica porque o erro é instrutivo: `42P07` diz *"esse índice já
existe"*, e a leitura apressada foi tratá-lo como *"existe no banco, falta no
schema"*. A pergunta que faltou fazer é a mais barata das duas —
`grep` no schema antes de editá-lo.

**Uma coluna, nenhuma tabela** (§5). `tenant_settings.stalled_days`, com
`DEFAULT 7` — o valor da decisão do PI de 2026-07-27, então a migração não muda
o comportamento de ninguém. Entra nessa tabela, e não numa terceira de
configuração, pelo mesmo motivo dos parâmetros da SPEC-033: ela já é por tenant
e já só o `owner` escreve (ADR-026). Coluna e não constante porque o §2.3 diz
"configurável" e o §5 cobra que *"parado"* use o valor configurado, não um `7`
literal espalhado.

### PR-1 — verificação

- **2006 testes verdes** (1471 regras · 124 banco · 411 tela), 171 suítes.
  Relatório regenerado (ADR-019).
- **45 testes novos** cobrindo o PR: 8 do período (incluindo virada de mês e de
  ano), 10 do resumo de clientes, 16 dos outros três resumos, e os do agregador,
  do arch test, das settings e do controller.
- `tsc --noEmit` limpo; `pnpm build` verde (API e web).
- **Migração aplicada e sem drift** — `prisma migrate status` reporta o schema em
  dia nos dois bancos (dev e teste).
- **Dogfooding no navegador fica para o PR-4**, que é quando existe tela. O que
  este PR entrega é servidor, e a rota é exercitável por API.

### PR-2 — o que entrou

O PR-1 já tinha `pending()` e `pendingCount()`, então o PR-2 começou relendo a
spec contra o que existia — e o que a releitura achou não foi "faltam rotas", foi
**uma fonte errada e um destino inexistente**.

**"Parado" media a coisa errada.** O §6 nomeia a fonte: *"`client_projects` cuja
última `client_status_transition` é anterior ao limite"*. O PR-1 implementou com
`clientProject.updatedAt`, e a diferença não é detalhe — `updatedAt` do Prisma
muda a **qualquer** escrita na linha. Corrigir uma vírgula no título tiraria da
lista um projeto travado há 60 dias, sem que nada tivesse andado. *Parado* é uma
afirmação sobre o **funil**, não sobre a linha do banco.

A correção lê a última transição de cada projeto e corta sobre ela. **Projeto sem
transição nenhuma conta desde a criação**: card criado e nunca movido é o caso
mais parado que existe, e exigir uma transição para entrar na lista esconderia
exatamente quem nunca andou. O corte acontece em memória de propósito — um
`where` sobre a relação responderia *"tem alguma transição anterior ao limite"*,
que é verdade para todo projeto antigo que andou ontem.

**O drill-down não tinha para onde apontar.** O §7.3 diz *"item cuja tela de
destino não existe é texto, não link"*, e ao procurar o destino apareceu o
problema: a gaveta do cliente abre em **estado local** (`useState` na
`ClientsPage`), e cada painel de projeto (artefatos, estimativa, contratos) em
outro estado local dentro dela. Não havia URL para lugar nenhum.

**Decisão do PI: dar o destino em vez de aceitar o texto.** A URL passa a ser
`/t/:tenant/clients?cliente=<id>&projeto=<id>&painel=<nome>`, e o item abre a
gaveta já no painel certo. As duas telas são entregues e aceitas (Fatia 19 e
SPEC-032/033/034), então a mudança foi desenhada para não alterar comportamento
existente: **sem os parâmetros, nada muda** — há teste afirmando isso em ambas.

Três guardas, todas com teste, e todas sobre a mesma regra do §7.3 — *não ensinar
ninguém a desconfiar dos links*:

- **Id que não está na lista não abre nada**, e a tela atrás continua utilizável.
  Link velho para cliente ou projeto apagado é o caso real.
- **`painel=` desconhecido é ignorado** (lista fechada `PAINEIS_ABRIVEIS`), e a
  gaveta abre normal em vez de tentar abrir algo que não existe.
- **Fechar não reabre.** Sem trava, fechar a gaveta a veria reabrir no render
  seguinte, porque o parâmetro continua na URL — a pessoa fecharia e ela
  voltaria, que é pior que não abrir. `ClientsPage` limpa os três parâmetros ao
  fechar (`replace`, para não empilhar histórico) e o painel guarda um
  `abertoPara` com o alvo já consumido.

**O destino sai do servidor, não do `kind` remontado na tela.** Cada item traz
`target: 'artefatos' | 'estimativa' | 'contratos' | null` e o `clientId` do dono.
Quem sabe que "artefato pendente" se resolve no painel de artefatos é quem
produziu o item; a tela replicando esse mapa seria uma segunda cópia da regra, e
as duas divergiriam no primeiro tipo novo. O `clientId` viaja junto porque a
gaveta é a do **cliente** — sem ele a tela precisaria de uma segunda chamada por
item só para descobrir o dono.

**"Parado" vem com `target: null`, de propósito.** O projeto pode estar travado
em qualquer etapa, e escolher um painel seria adivinhar. A gaveta do cliente
ainda abre (o `clientId` viaja), mas nenhum painel é pré-selecionado — que é
exatamente a distinção que o §7.3 pede entre *levar ao lugar certo* e *fingir que
sabe qual é*.

**O contador do menu** (`usePendingCount`) atualiza **ao navegar e ao voltar o
foco da aba**, sem polling — a decisão 4 do PI, e o §5 cobra a ausência de
`setInterval` por nome. O teste prova por comportamento, não por varredura:
adianta o relógio em 5 minutos e afirma que nenhuma request nova saiu.

Duas escolhas dentro do hook merecem registro. **`visibilitychange` e não
`focus`**: clicar de volta numa janela que nunca ficou oculta não é *voltar*, e
dispararia request a cada alt-tab curto — que é o polling que a decisão evitou,
com outro nome. E **falha vira `null`, nunca zero**: sem número o menu não mostra
badge; zero seria a afirmação *"nada espera por você"*, a mais cara de errar aqui
porque a pessoa deixa de olhar.

**Uma linha em `TENANT_SCOPED_PREFIXES`** (`/dashboard`) cobre as três rotas. É
literalmente o FIX #166: sem ela o contador sairia sem `/t/:tenant`, a API
devolveria 404 e o menu mostraria **zero em silêncio** — indistinguível de "nada
esperando". Nenhum teste de tela pegaria, porque todos mockam a camada de API,
que é onde `withTenantPrefix` vive; por isso a prova está no
`tenantPrefix.test.ts`, que a exercita direto.

**Um teste de infraestrutura consertado, achado de raspão.** O
`dashboard.arch.spec.ts` reprovou o próprio comentário que descreve a regra: o
filtro de comentários usava `.*$`, que com checkout em **CRLF** para antes do
`\r` e deixa a linha passar inteira. Passava no PR-1 (arquivo recém-escrito, LF)
e quebrou depois do merge. O filtro virou `\r?$` e uma função nomeada — o sintoma
é o pior tipo de teste instável, porque só aparece na máquina de quem tem
`autocrlf` ligado.

### PR-2 — verificação

- **2034 testes verdes** (1477 regras · 124 banco · 433 tela) — **+28** sobre os 2006 do PR-1: 6 no
  servidor (fonte do "parado", `clientId`, `target`) e 20 no web (deep-link da
  gaveta e do painel, contador, prefixo de tenant).
- **A correção do "parado" tem os dois lados**: teste afirmando que `updatedAt`
  **não** entra no `where`, e teste do projeto sem transição contando desde a
  criação.
- **As três guardas do §7.3 têm teste**: id inexistente, painel desconhecido e
  fechar-não-reabre — nas duas telas.
- **O contador não faz polling, provado por comportamento**: relógio adiantado em
  5 min, contagem de chamadas inalterada.
- `tsc --noEmit` limpo; `pnpm build` verde (API e web).
- **Dogfooding no navegador fica para o PR-4**, quando existe a tela que produz
  os links — o que este PR entrega é o destino deles.

### PR-3 — o que entrou

O bloco de repos ao vivo (§2.6) — **a decisão mais cara da tela**, nas palavras
do §7.2 — e as quatro salvaguardas que a spec torna obrigatórias.

**A leitura ao vivo não existia, e reusar o board teria sido errado.** O
`BoardService.getBoard` lê o **cache** (`prisma.issue`), preenchido pelo
`syncIssues`; a spec pede ao vivo, *"nada persistido"* (ADR-017). O
`BoardSummaryService` é o caminho novo: vai ao GitHub, conta, e **não grava**.
As duas leituras convivem por razão, não por descuido — o board do workspace é
interativo, tem drag-and-drop e precisa responder rápido; o dashboard mostra a
contagem do momento.

**A regra de coluna não é reimplementada.** `columnOf` e `isEpic` vêm do
`domain/` do próprio `board`. Recontar por conta própria produziria um dashboard
que discorda do board **na mesma tela**, e quem estivesse olhando não teria como
saber qual dos dois mente. Pelo mesmo motivo o caminho é
`listIssuesWithHierarchy`, não `listIssues`: sem `hasSubIssues`, épico entraria
como card e o número do dashboard ficaria maior que o do board.

**As quatro salvaguardas do §2.11, cada uma com teste:**

1. **Falha isolada.** Cada repo captura a própria falha antes do `Promise.all`,
   então nenhuma rejeição escapa e o `all` nunca curto-circuita. Há teste do
   caso extremo — **todos** os repos falhando ainda devolvem o bloco, em vez de
   virar 500 e tirar o dashboard do ar por causa de um terceiro.
2. **Timeout curto e paralelo.** 5 s por repo, contra os 10 s do client (que são
   dimensionados para o sync): a tela abre **sem** o bloco, não depois dele. O
   paralelismo é provado por comportamento — as N chamadas partem antes de a
   primeira resolver.
3. **Teto de 10 repos por carga** (decisão do PI). O excedente **não é
   consultado**, e o número dele viaja para a tela: lista curta sem o número
   leria como *"são só estes"*. A ordem é `lastCodeCommitAt desc`, com os `null`
   por último — quando alguém cai sob *"ver todos"*, tem de ser o repo parado,
   não o que teve commit ontem.
4. **Rate limit explícito.** É a mais importante, e a que custou mais código.

**O rate limit precisou virar erro reconhecível.** O client lançava
`Error('GitHub issues 403')`, e com isso o bloco não teria como dizer *"o limite
volta às 16h"* — cairia no texto genérico, e um bloco vazio leria como **board
vazio**, que é exatamente a leitura que o §2.11 proíbe. Entrou
`board/domain/rate-limit.ts` com `RateLimitError`, e três decisões dentro dele:

- **`403` só é rate limit com `x-ratelimit-remaining: 0`.** `403` com cota
  sobrando é **permissão**, e chamá-lo de limite mandaria a pessoa esperar por
  algo que não passa sozinho com o tempo.
- **`x-ratelimit-reset` ganha do `retry-after`** (absoluto vence relativo), e sem
  nenhum dos dois o horário é `null`. A tela diz que o limite foi atingido **sem
  inventar horário**: um horário falso é pior que a ausência dele, porque a
  pessoa volta, falha de novo, e passa a desconfiar da mensagem inteira.
- **Rate limit no GraphQL não degrada para o REST.** O fallback existente
  cobria *"shape mudou / feature indisponível"*; com limite atingido a cota é a
  mesma, então o REST falharia igual — gastando uma segunda chamada do que já
  acabou e trocando um erro que a tela sabe explicar por um genérico. Há teste
  dos dois lados: rate limit sobe com **uma** chamada, falha comum ainda degrada
  com duas.

**Uma exceção nominal no arch test, e ela foi discutida antes de ser aberta.** O
`dashboard.arch.spec.ts` proíbe importar `domain/` de outro módulo, e pegou o
import de `board/domain/rate-limit` — corretamente, porque a regra existe para
impedir reimplementar regra alheia. Mas o que atravessa aqui é o **tipo do erro
que o service público lança**, que é o oposto: é usar a interface dele. A
alternativa seria casar a mensagem por string, que quebra em silêncio na
primeira vez que o texto mudar.

A exceção é **lista de nomes**, no padrão de `provider-profile` (SPEC-034) e da
allowlist (SPEC-033), com um **segundo teste** afirmando que nada mais de
`board/domain/` entra. Sem esse segundo teste, a lista poderia crescer sem
ninguém notar — o primeiro ficaria verde justamente por causa do item novo.

**A rota é isolada** (`GET /t/:tenant/dashboard/repos`), e a separação é a
garantia: a falha do bloco não pode contaminar a resposta principal. Há teste nos
dois sentidos — o `/repos` não chama o dashboard, e o dashboard não chama o
`/repos`. Isso é estrutural, em vez de um `try/catch` que alguém pode remover sem
perceber.

**O que permanece, e está registrado** (§7.2): N chamadas ao GitHub por carga, no
mesmo rate limit do catálogo e do sync, com a tela dependendo de um terceiro no
caminho de abertura. As salvaguardas **contêm** o dano; não eliminam a
dependência. O gatilho de revisão é rate limit recorrente ou abertura degradando
— e a saída **não** é cache silencioso, que colidiria com o ADR-017, e sim voltar
ao PI com *"ao vivo sob clique"*, que já estava na mesa.

### PR-3 — verificação

- **2079 testes verdes** (1521 regras · 124 banco · 434 tela) — **+45** sobre os 2034 do PR-2: 14 do
  domínio das salvaguardas, 14 do orquestrador, 9 do `BoardSummaryService`, 6 do
  rate limit atravessando o client.
- **As 4 salvaguardas têm teste, uma a uma**, incluindo os casos extremos: todos
  os repos falhando, tenant sem repo nenhum, e rate limit sem horário informado.
- **Paralelismo provado por comportamento** (chamadas simultâneas contadas), não
  por leitura do código.
- **Nada persistido**, provado por ausência nos dois níveis: o
  `DashboardReposService` não tem `prisma`, e o `BoardSummaryService` tem teste
  afirmando que nenhuma escrita em `prisma.issue` acontece na leitura ao vivo.
- `tsc --noEmit` limpo; `pnpm build` verde (API e web).
- **Dogfooding no navegador fica para o PR-4**, quando existe tela. As
  salvaguardas 1, 2 e 4 pedem falha real do GitHub para serem vistas — o plano é
  exercitá-las com repo inexistente e token sem escopo.

### PR-4 — o que entrou

A tela, o menu, e o **dogfooding que só existe aqui** — as salvaguardas do §2.11
pedem falha real do GitHub para serem vistas, e os três PRs anteriores não
tinham onde exercê-las.

**O item `Dashboard` acendeu.** Nasceu desabilitado na Fatia 19, com
`title="Disponível na Fatia 24"`, porque depender de estimativa e contratos
inexistentes obrigaria a inventar números. Agora ele **some quando o tenant não
tem cliente nenhum** (§2.12) — some ≠ aparecer vazio, pelo mesmo princípio de
antes: uma tela de retomada sem nada a retomar é ruído no menu, não informação.

**O contador do menu virou um hook só com o `hasClients`.** O PR-2 tinha
entregue `usePendingCount`; ele foi substituído por `useDashboardNav`, porque as
duas informações dependem do mesmo estado do servidor e buscá-las em hooks
separados dobraria as chamadas a cada navegação. Os testes do §2.10 vieram
junto, inteiros — **sem cliente, o contador nem é buscado** (não há item para
exibi-lo), e **falha de rede não esconde o item já exibido** (falha não é
evidência de que os clientes sumiram).

**Quatro blocos, e nenhum número cruzando os domínios** (ADR-023). O bloco de
repos nem viaja na mesma resposta que o funil — a ausência de um total agregado
é auditável, que é como o §5 pede.

**`never` e `zero` renderizam diferente, em pixels** (§2.7): *"Você ainda não
emitiu contrato"* sai em itálico e `--faint`; *"Nenhum contrato emitido no
período"* sai em `--body`. Não é decoração — são frases diferentes porque são
fatos diferentes, e o §5 cobra as duas com teste.

**O drill-down é `<Link>` quando há destino e `<div>` quando não há** (§7.3).
Não `<a>` sem `href`: um link que não navega promete o que não cumpre. *"Card
parado"* vem com `target: null` do servidor e por isso é texto — o projeto pode
estar travado em qualquer etapa, e escolher um painel seria adivinhar.

### PR-4 — dogfooding no navegador (2026-07-29)

Com API e web de pé, sessão real (`@RodReis`, 7 repos), contra os dados que as
fatias 19–23 produziram.

**Os números batem com o banco, conferidos um a um** — que é o critério do §5,
*"todo número tem origem rastreável em linhas do banco"*:

| tela | `SELECT` | bate |
|---|---|---|
| *Esperando você* = 1 | `contracts where accepted_at is null` → 1 | ✅ |
| "3 emitidos · 2 com aceite" | `contracts` → 3 | ✅ |
| Nenhum artefato pendente | `artifacts where state='PENDING_REVIEW'` → 0 | ✅ |
| 4 repos no bloco | `projects where installation_status='active'` → 4 | ✅ |

**O contador do menu e a lista concordaram na tela**: badge `1`, um item na
lista. É o §2.3 provado em pixels, não só no teste.

**A ordem dos repos saiu como projetada**: `rrb-proplan`, `rrb-jarvisOS`,
`rrb-adv`, `rrb-organize` — exatamente `lastCodeCommitAt desc`. E os **3 repos
`missing` ficaram de fora**, sem ocupar vaga do teto.

**O drill-down foi exercido ponta a ponta.** Clicar no item levou a
`/t/RodReis/clients?cliente=…&projeto=…&painel=contratos`, e os **dois** diálogos
abriram: `Cliente Rafaela M M Barros` e `Contratos de Projeto EPG2`. O painel
certo, do projeto certo.

**A salvaguarda 1 foi provada com falha real do GitHub**, não com mock:
renomeei um repo no banco para `repo-que-nao-existe-xyz`, recarreguei, e o bloco
mostrou o repo **nomeado** com *"Não foi possível carregar"* — enquanto os
outros três renderizaram suas contagens normalmente. Nenhum zero silencioso. O
banco foi restaurado em seguida.

**Um defeito de UX que teste nenhum pegaria, achado e corrigido aqui.** A trilha
mostrava `contract_link.accessed: 2d638f14-eeb9-4a2d-80f4-35c59770e35a`,
repetido quatro vezes. Nada ali é legível para quem abre um bloco chamado *"O
que andou por aqui"*: o nome do evento é o fato, e o UUID é o id da linha, que
não ajuda ninguém a lembrar o que estava fazendo. Os 12 tipos de `AuditEvent`
ganharam rótulo em português e o `subject` saiu.

A tradução **não esconde o que não conhece**: tipo novo (fatia futura, evento
que ninguém mapeou) cai no próprio nome cru, em vez de sumir da lista. Sumir
seria pior — uma trilha que omite o que não reconhece mente por omissão.

**Um ajuste de layout, também do olho e não do teste.** A trilha é a lista mais
longa da tela e empurrava o funil para longe da dobra; ganhou altura máxima com
rolagem própria, e o Kanban de repos subiu. Conferido nos **dois temas**.

### PR-4 — verificação

- **2121 testes verdes** (1521 regras · 124 banco · 476 tela) — **+42** sobre os
  2079 do PR-3, todos na tela: 21 da lógica de apresentação, 21 da página e do hook.
- **Os critérios de tela do §5, todos com teste**: `never` × `zero` renderizando
  diferente, item sem destino como texto, estado vazio com texto em vez de lista
  em branco, e o bloco de repos com as 4 salvaguardas visíveis.
- **O contador não faz polling**, provado por comportamento (relógio adiantado
  5 min, contagem de chamadas inalterada).
- `tsc --noEmit` limpo; `pnpm build` verde (API e web).
- **Dogfooding com sessão real e falha real do GitHub** — números conferidos
  contra o banco, drill-down exercido, salvaguarda 1 provada, dois temas.

---

## Fatia 25 (SPEC-036) — Licensing: emissão manual e ativação com license file assinado — `em andamento`

Issue **#183** (spec `aprovada-pi` 2026-07-29, perguntas resolvidas com o PI).
**1ª fatia do MVP4 — Frente Licenciamento.** Piloto: War Room.

**A frente inteira existe para administrar o pós-venda** dos produtos de
software do tenant: licenças, ativações por máquina, revogação. Modelo
Keygen.sh, self-hosted no monolito (MVP4 decisão 1).

**A decisão central de desenho é validação por assinatura, não por segredo**
(MVP4 §1): o servidor assina um license file com chave privada Ed25519; o
cliente valida com a pública embutida no binário. Offline funciona pela
validade do arquivo assinado, não por confiança no relógio do servidor.

**Premissa herdada, e vale repetir porque muda o que é "sucesso" aqui: a
proteção atrasa, não impede.** O mecanismo real é contrato + conveniência de
updates. Nenhuma fatia desta frente deve ser avaliada por "quão difícil é
burlar" — os riscos aceitos estão no MVP4 §8, sem mitigação técnica.

### Decisões do PI nesta fatia (2026-07-29)

Três pontos que a spec não fechava e mudavam o código:

1. **Nav** — item próprio **"Licenças"** no `GlobalNav` (`/t/:tenant/licencas`),
   mesmo tratamento de "Contratos". Licenciamento é frente própria, não sub-aba
   de outra coisa.
2. **Produto/edição** — **seed + CRUD mínimo na tela**. O critério de aceite
   admitia "via seed ou tela"; o PI pediu os dois, porque um tenant novo precisa
   conseguir cadastrar o próprio produto sem esperar a SPEC-040.
3. **Fatiamento** — **4 PRs empilhados**.

### Os 4 PRs

| PR | entrega |
|---|---|
| **PR-1** | schema + RLS + migração + `resolve_license` + seed do piloto |
| **PR-2** | domínio (geração de chave, Ed25519, license file) + admin: emitir, revogar, listar, trilha |
| **PR-3** | `POST /licensing/v1/activate` público + rate limit + contexto de tenant por recurso |
| **PR-4** | tela mínima (emissão + lista + revogar + CRUD de produto/edição) + arch-spec de fronteira + dogfooding |

---

### PR-1 — schema, RLS e seed — `feito`

Só a forma dos dados. Sem módulo, sem rota, sem assinatura — mesmo recorte do
PR-1 da SPEC-034, e pelo mesmo motivo: o schema é a decisão mais cara de
desfazer.

**A regra que organiza o PR inteiro: a chave em claro não existe no banco.**
Ela é devolvida uma única vez na resposta da emissão (PR-2) e some; o que
persiste é o `key_hash`. Não há coluna que a guarde, então não há caminho de
leitura que a revele — nem para o admin, nem para quem tiver acesso ao banco.

**5 tabelas.** `lic_products`, `licenses`, `lic_activations` e `lic_events` são
raízes de tenancy com `tenant_id` próprio e policy `= ANY(app.tenant_ids)`.
`lic_editions` é a única sem `tenant_id`: corta por JOIN no produto dono, porque
nada a busca direto por id. Foi testada explicitamente por ser o modo mais fácil
de escrever uma policy que não protege nada.

**`resolve_license`, `SECURITY DEFINER`.** O `/activate` (PR-3) não tem sessão,
então roda sem `app.tenant_ids`, e o RLS fail-closed devolveria vazio para
**toda** chave — inclusive as válidas. Mesmo padrão da `resolve_contract_link`
(SPEC-034) e da `resolve_briefing_link` (SPEC-029).

**A saída da função é deliberadamente estreita, e isso é uma decisão de
segurança, não de economia:** ela devolve o que a licença é (status, limites,
janelas) e de que tenant vem. **Nada do comprador sai dali** — nome e e-mail não
são necessários para decidir uma ativação, e uma função com privilégio de owner
não deve devolver dado pessoal a uma rota sem sessão. Há teste afirmando a
ausência, porque aqui a ausência é a proteção.

**Quatro CHECKs que fecham erros silenciosos**, não erros que já falham sozinhos:

- `licenses_revoked_coherent` — `status = REVOKED` ⟺ `revoked_at` preenchido. O
  caso perigoso é o inverso: revogada por reembolso mas com status ACTIVE, que
  faria o `/activate` responder `200` em vez de `410`.
- `lic_editions_limits_positive` — zero máquinas emitiria licença que não ativa
  em lugar nenhum; zero meses emitiria licença vencida no dia da compra.
- `lic_products_identity_present` / `lic_editions_identity_present` — barram a
  string vazia, que é o que passa por `NOT NULL` sem dizer nada.

**Dois uniques que são garantia de comportamento, não de higiene:**

- `(license_id, fingerprint)` — é a idempotência do `/activate`. Sem ele, duas
  requisições simultâneas da **mesma** máquina passariam as duas por um `if` no
  código e consumiriam as duas vagas do comprador.
- `licenses.key_hash` — o único caminho de busca do `/activate`. Dois hashes
  iguais fariam o lookup devolver "uma das duas", e nada diria qual licença o
  license file assinado estaria descrevendo.

**`ON DELETE` escolhido campo a campo:** `Restrict` na edição (apagá-la levaria
junto as licenças vendidas nela, e com elas a resposta a *"o que este cliente
comprou?"*); `SetNull` no `project_id` (desconectar o repo do catálogo não pode
apagar o produto licenciado — o vínculo é enriquecimento, não raiz).

**Campos que nascem sem uso, de propósito:** `expires_at` e `billing_model =
SUBSCRIPTION` (SPEC-038), `source_invite_at`/`source_invited` (SPEC-039),
`sale_ref` (idempotência do webhook). A alternativa era migração de dados quando
a primeira assinatura ou o primeiro convite chegasse. `LicEvent.type` é TEXT e
não enum pelo mesmo motivo, invertido: as fatias 27–28 acrescentam tipos, e nada
no banco decide comportamento a partir desse valor.

**Preço não entra no schema** (MVP4 decisão 4): a plataforma de venda é a fonte;
o valor pago chegará no `LicEvent.payload` do webhook.

#### PR-1 — verificação

- **2137 testes verdes** (1521 regras · **140 banco** · 476 tela) — **+16**
  sobre os 2121 do PR-4 da Fatia 24, todos no banco.
- **Os 16 são de integração contra Postgres real**, não mock: esta tabela decide
  quem pode rodar um produto pago, e os quatro modos de errar que ela tem são
  silenciosos (fail-closed devolvendo zero linhas, segunda máquina virando
  terceira, revogada que continua ativando, função privilegiada vazando o
  comprador). Nenhum levanta exceção no caminho feliz.
- **Fail-closed provado nas 5 tabelas**, uma a uma — incluindo a `lic_editions`,
  que corta por JOIN.
- **Isolamento entre tenants**: A não vê licença nem edição de B, e pedir a
  linha do outro tenant devolve **o mesmo** que pedir um id inexistente
  (distinguir os dois já é vazamento).
- Seed **idempotente**, conferido rodando duas vezes: `1 produto novo` na
  primeira, `0` na segunda. Nunca sobrescreve — o admin pode ter ajustado
  `maxMachines` pela tela, e o reseed desfaria a escolha em silêncio.
- `prisma migrate diff` sem drift novo (só o `tenant_id` nullable pré-existente
  da Fatia 8, já documentado no schema).
- `tsc --noEmit` limpo; `pnpm build` verde (API e web).

---

### PR-2 — domínio da chave, assinatura Ed25519 e admin — `feito`

O que o PR-1 deixou como forma vira comportamento: gerar chave, assinar license
file, emitir, revogar e ler a trilha. Ainda **sem rota pública** — o `/activate`
é o PR-3.

**O módulo `licensing` nasce disjunto das outras duas frentes, e isso é
estrutural.** Ele não lê `Client`, não lê `Contract`, não move card de funil. O
único import de domínio é o `IdentityModule` (que dá os guards). A costura com o
catálogo existe como `LicProduct.projectId?` — uma **coluna**, não uma
dependência de módulo. O arch-spec que torna isso verificável vem no PR-4.

#### A chave: o alfabeto é a decisão

`WR-XXXX-XXXX-XXXX-XXXX`, 16 símbolos de um alfabeto de 32 = **80 bits**. O que
decide o alfabeto não é a entropia — é que **a chave é digitada por gente**: fora
`0/O` e `1/I`, os pares que ninguém distingue num e-mail de confirmação ou numa
fonte de terminal. Um comprador que lê `O` onde havia `0` recebe `404` numa
licença que existe e abre chamado de suporte.

Pelo mesmo motivo existe `normalizeKey` (trim + maiúsculas) **antes** do hash:
sem ela, `wr-...` e `WR-...` teriam hashes diferentes e a segunda diria "não
encontrada" — o modo de falhar mais caro da fatia, porque parece erro do
comprador. O que ela **não** faz: remover hífen. Aceitar `WRAB23...` daria à
chave mais de uma forma válida, e a normalização viraria parte do formato em vez
da higiene dele.

**A garantia central tem três testes, um por caminho de fuga:** a chave não
aparece no que é gravado, não aparece no `LicEvent.payload` (o lugar mais fácil
de vazá-la "só para referência" — e que tem tela), e não aparece em nenhuma
leitura. O tipo `LicenseView` **não tem o campo** — é o tipo, e não a disciplina
de quem escreve a próxima query, que impede a regressão.

#### A assinatura: `node:crypto`, sem dependência nova

Ed25519 é nativo. Uma lib de JWT/JOSE traria negociação de algoritmo — superfície
de ataque conhecida (`alg: none`, confusão HS256/RS256) — para um formato que
**não negocia nada**: uma curva, uma chave, um `kid`.

`serializePayload` monta o objeto **campo a campo, em ordem fixa**, e não
`JSON.stringify` do que chegou. A ordem entra na assinatura: um payload montado
noutra ordem produziria outros bytes e a verificação falharia num arquivo
legítimo. Fixá-la é o que torna o formato reproduzível para quem implementa o
cliente noutra linguagem — e o War Room é exatamente esse caso (MVP4 decisão 9).

`verifyLicenseFile` existe no servidor mesmo sem o servidor usá-la: o critério de
aceite pede conferência **fora** do servidor, e um contrato público sem
verificador de referência obriga quem implementa o cliente a adivinhar os bytes
cobertos. Os testes exercem os três ataques que ela precisa recusar: payload
adulterado (estender `updatesUntil` de graça), fingerprint trocado (copiar o
arquivo para outra máquina) e assinatura de outro par.

**`LicenseSigningService` é o único ponto que toca `LICENSING_SIGNING_KEY`.**
Concentrar ali é o que torna verificável a afirmação de que a privada não sai do
servidor. Sem a chave, emissão e `/activate` respondem **`503`** — a alternativa
(arquivo sem assinatura, ou assinado com par gerado na hora) produziria arquivos
que nenhum cliente valida, e o comprador descobriria isso ao abrir o produto.

**Formato do secret alinhado ao que a casa já usa:** base64 de uma linha, igual
`GITHUB_APP_PRIVATE_KEY`. `\n` literal também é aceito, porque é o outro jeito
comum de colar PEM numa linha e recusá-lo daria "indisponível" para uma chave que
está lá. Chave ilegível → `503`, não erro cru de OpenSSL (que vazaria formato
interno na resposta). Geração e **rotação** documentadas em `docs/DEPLOY.md` §3.4.

#### Admin

Emitir, listar, buscar por chave, revogar, ler trilha — e o CRUD mínimo de
produto/edição (decisão 2 do PI). Três escolhas que merecem nota:

- **Busca por chave filtra por tenant além do RLS.** O índice de `key_hash` é
  único na tabela inteira, então sem o filtro explícito o RLS seria a *única*
  coisa entre o admin de um tenant e a licença de outro. Duas barreiras para o
  mesmo corte, de propósito.
- **Revogar é `POST /licenses/:id/revoke`, nunca `DELETE`.** A licença não é
  apagada: passa a existir revogada, com data e motivo — que é o que o
  `/activate` lê para responder `410` e o que explica a decisão meses depois. É
  idempotente: a 2ª revogação não reescreve a data original (senão o dia em que
  a venda foi desfeita viraria hoje).
- **Não há remoção de produto nem de edição.** O `ON DELETE RESTRICT` do PR-1 já
  recusa apagar edição com licença vendida; oferecer o botão para depois recusá-lo
  é pior que não oferecer. `slug` e `billingModel` também não são editáveis — o
  primeiro viaja no license file já emitido, o segundo muda o significado de
  `expiresAt` numa licença viva.

`signingConfigured` viaja no `GET /catalog` para a tela avisar **antes** de
alguém emitir e entregar uma chave que não ativaria.

#### PR-2 — verificação

- **2235 testes verdes** (1619 regras · 140 banco · 476 tela) — **+98** sobre o
  PR-1, todos de regras: 27 da chave, 13 do license file, 11 da assinatura,
  23 do catálogo, 24 do admin.
- **A chave em claro tem teste em cada caminho de fuga**: gravação, trilha e
  leitura.
- **Os três ataques ao license file** recusados por teste: payload adulterado,
  fingerprint de outra máquina, par de chaves alheio.
- **Rotação provada**: assinar com o par novo produz `kid` novo, valida com a
  pública nova e **não** valida com a antiga.
- `tsc --noEmit` limpo; `pnpm build` verde.

**A guarda do ADR-019 barrou o PR-1 e o aprendizado fica registrado:** regenerar
o `reports/TESTS.md` não basta — a entrega precisa da **linha de carimbo**, e ela
exige `REPORT_DATE` além de `REPORT_ISSUE`/`REPORT_SPEC`/`REPORT_PR`. Sem a data
a linha entra com `—` e a guarda continua reprovando.

---

### PR-3 — `POST /licensing/v1/activate` — `feito`

A rota que o cliente do War Room chama. **A terceira rota pública do produto**,
depois do briefing (`/b/:token`) e do contrato (`/c/:token`) — e a primeira que
**escreve** sem sessão.

**`/licensing/v1` é versionado, e nenhuma outra rota da casa é.** O motivo não é
simetria: o cliente é implementado noutro repo, contra este contrato (MVP4
decisão 9). Mudança depois do piloto = `/v2`, nunca quebra do `/v1`.

#### O tenant vem do recurso

Sem sessão, sem `app.tenant_ids`, e o RLS é fail-closed: um `SELECT` direto
voltaria vazio para **toda** chave — inclusive as válidas —, e cada ativação
legítima responderia `404` sem erro no log. A `resolve_license` (SECURITY
DEFINER) responde *"esta chave existe, e de qual tenant é?"*; com o tenant em
mãos, o resto roda dentro de `runInTenantContext`, e o RLS volta a ser quem
protege — em vez de um bypass genérico, proibido pelo ADR-020.

#### Uma emenda ao PR-1

A `resolve_license` nasceu com as colunas que decidem **se** a ativação é
permitida e faltou a que o license file precisa **carregar**: `issued_at` é um
dos 10 campos do contrato público. Sem ela, montar o payload exigiria repetir
outro campo no lugar — produzindo um arquivo assinado que diz uma data que não é
a da emissão.

A correção custou uma migração própria, e o custo tem nome: `CREATE OR REPLACE`
recusa mudança no tipo de retorno (`42P13`), então foi `DROP` + `CREATE` — **e o
DROP leva os privilégios junto**. O `GRANT` no fim daquele arquivo não é
cerimônia: sem ele a role da aplicação fica sem `EXECUTE` e toda ativação passa
a falhar. O int-spec roda com `proplan_app` justamente para que esquecê-lo
quebre o teste, não a produção.

#### Os quatro códigos, e por que cada um

- **`404`** chave inexistente — e é o **mesmo corpo** que uma chave malformada
  ou de outro produto recebe. Distinguir os casos diria a quem sonda quando ele
  acertou o formato.
- **`410`** revogada **e** expirada. Os dois são "existiu e não vale mais", que
  é o que 410 significa; o cliente trata igual. O 410 acontece **antes de
  qualquer escrita** — uma linha gravada ali seria ativação de licença morta,
  visível no painel.
- **`409`** limite de máquinas, **com a lista de ativações**. Sem ela o comprador
  vê "limite atingido" e não tem como saber qual desativar. A troca self-service
  é a SPEC-037, mas a informação que a torna possível nasce aqui.
- **`429`** rate limit.

#### Rate limit em duas chaves, não uma

Só por IP deixaria a chave vazada livre para ser ativada de mil endereços; só
por chave deixaria a varredura livre a partir de um IP. **10/min por IP** (a
ativação legítima é rara e o retry é idempotente) e **5/min por chave** (uma
chave legítima ativa 2 máquinas — o `maxMachines` do piloto).

**A chave entra no limitador hasheada.** O mapa vive em memória e aparece em
heap dump; guardá-la em claro ali desfaria, num despejo de memória, a decisão de
nunca persistí-la. E ela é normalizada antes — senão alternar a caixa dobraria a
cota da mesma chave sem esforço.

#### A corrida que fica registrada, não escondida

A contagem de vagas não tem lock. Duas ativações simultâneas de máquinas
**diferentes** podem contar antes de qualquer uma gravar e passar as duas. O
unique `(license_id, fingerprint)` fecha o caso da **mesma** máquina (retry,
dois cliques), que é o comum; o de máquinas distintas exigiria `SELECT … FOR
UPDATE`.

Ficou anotado como `ponytail:` no código, com o gatilho: o prejuízo teto é uma
máquina a mais numa licença de duas, num modelo cuja premissa declarada é que *a
proteção atrasa, não impede* (MVP4 §1). Se aparecer nas métricas de ativação
anômala (MVP4 §8), promove.

#### PR-3 — verificação

- **2260 testes verdes** (1627 regras · 157 banco · 476 tela) — **+25** sobre o
  PR-2: 17 de integração no `/activate`, 8 do rate limit.
- **Os 17 são contra Postgres real, e três deles só existem por isso:** que a
  ativação **grava a linha** (sem `runInTenantContext` o `create` não erra —
  grava zero linhas, e a rota devolveria `200` com license file válido para uma
  ativação que não existe); que a `resolve_license` tem `EXECUTE`; e que a
  3ª máquina é barrada pela contagem real.
- **O license file confere com a chave pública** — o critério de aceite,
  verificado fora do servidor.
- `issuedAt` ≠ `updatesUntil` no payload, provado contra as colunas do banco.
- `tsc --noEmit` limpo.

**Um erro meu que vale registrar, porque custou meia hora:** o int-spec instancia
`PrismaService` direto (é dele que vem o `runInTenantContext`), e o `super()`
dele não recebe `datasources` — lê `DATABASE_URL` do ambiente, que aponta para o
banco de **dev**. O seed gravava em `proplan_test` e o service consultava
`proplan`: todo teste dava `404` numa chave que existia. A causa é invisível no
erro (`NotFoundException` é resposta legítima da rota) e a inspeção pós-teste não
ajuda, porque o `afterAll` limpa. Reapontar `DATABASE_URL` antes de instanciar
resolveu, e o motivo está comentado no arquivo.

---

### PR-4 — tela mínima, arch-spec e dogfooding — `feito`

A fatia fecha. Item **Licenças** no `GlobalNav` → `/t/:tenant/licencas`.

**Rota de primeiro nível sob o tenant, não sob `/clients`** — decisão do PI, e
ela tem razão estrutural: licenciamento é frente disjunta (ADR-023 vale aqui
pelo mesmo princípio). Um produto licenciado não é um cliente, e o contrato de
prestação não tem nada a ver com a licença de um binário.

#### A tela é organizada por uma regra só

**A chave em claro aparece uma vez e some.** Por isso ela **não vira linha da
lista**: ocupa um bloco próprio, destacado, com o aviso explícito de que não
volta — e some quando o admin confirma que copiou. Recarregar a página a perde
para sempre, e o texto diz isso antes que alguém descubra do jeito caro.

**O aviso mais importante da tela não é sobre licença nenhuma:**
`signingConfigured: false` renderiza um alerta dizendo que as chaves emitidas
**não vão ativar**. Sem ele, emitir funcionaria, a chave chegaria ao comprador,
e o `503` apareceria na máquina dele — o pior lugar possível para descobrir uma
variável de ambiente faltando.

Outras decisões de tela, todas com teste:

- **Um campo de busca, não dois.** Quem usa é o suporte, com a chave que o
  comprador mandou ou com o e-mail dele. O `@` decide o modo — não há
  ambiguidade real, e escolher o tipo antes de digitar é burocracia sobre a
  informação que ele já tem na mão.
- **Sem botão de remover produto ou edição.** O `ON DELETE RESTRICT` recusa
  apagar edição com licença vendida; oferecer o botão para depois recusá-lo é
  pior que não oferecer. A tela mostra o **número de licenças** da edição, que é
  a explicação de por que ele não existe.
- **Cadastro de produtos recolhido.** O caminho comum é emitir; cadastrar
  produto acontece uma vez na vida do workspace, e deixá-lo aberto empurraria a
  emissão para baixo da dobra todo dia.
- **`updatesUntil` vencido diz "Updates encerrados", nunca "expirada".** A
  perpétua continua válida (MVP4 decisão 3) — o que vence é o direito a versões
  novas. "Expirada" faria o suporte acreditar que a licença morreu.
- **Evento desconhecido cai no nome cru.** As fatias 27–28 acrescentam tipos; uma
  lista que omite o que não reconhece mente por omissão (mesma regra da trilha
  da Fatia 24).

#### O arch-spec de fronteira

Critério de aceite da fatia, e ele prova **três** coisas, não uma:

1. **Frente disjunta:** nenhum import de módulo-irmão além do `identity`, nenhum
   acesso a tabela da Frente Clientes, nenhuma transição de funil, nenhuma
   escrita em `projects`, nenhum LLM.
2. **A chave privada tem um dono só:** `process.env.LICENSING_SIGNING_KEY` é
   lida em **um** arquivo, e a primitiva de assinatura mora em outro. É o que
   torna verificável a afirmação de que a privada não sai do servidor.
3. **A rota pública é separada da protegida:** o controller público **não** tem
   `@UseGuards` (teria e toda ativação daria `401`), o admin tem os três, e a
   escrita sem sessão passa por `runInTenantContext` — nunca por bypass.

Duas correções durante a escrita dele, ambas sobre a varredura reprovar o que
não devia: `.int-spec.ts` entrava na lista de arquivos "de produção" (o
`contracts` não precisava do filtro porque não tem nenhum), e as regex pegavam
**comentários** — os arquivos do módulo explicam as decisões em prosa, e essa
prosa cita justamente os nomes proibidos.

#### Dogfooding — o fluxo inteiro, contra a API e o banco reais

Par Ed25519 gerado com `openssl`, API subida com o secret em base64:

- **Emissão**: chave `WR-8ZC9-WQGG-UAXU-9LS4` no formato do produto; e-mail
  normalizado para minúsculas; `updatesUntil` = emissão + 12 meses.
- **A chave não está no banco**: `SELECT count(*) FROM licenses WHERE
  licenses::text LIKE '%8ZC9%'` → **0**. Só o `key_hash`.
- **Ativação com a chave em MINÚSCULAS** → `201` com license file completo. É o
  modo de falhar mais caro da fatia, exercido de propósito.
- **Idempotência**: reativar a mesma máquina → `201`, e o banco continua com
  **2** ativações depois de 4 chamadas.
- **Limite**: 3ª máquina → `409` **com a lista** (`desktop-rodrigo`, `notebook`).
- **Trilha**: `issued`, `activated`, `reactivated`, `activated`.
- **Revogação** → `410` na ativação seguinte.
- **Rate limit**: 6ª tentativa da mesma chave → `429`; chave nova do mesmo IP
  também `429` (o limite de IP havia estourado).
- **Nenhuma leitura devolve a chave** — `grep` na listagem: 0 ocorrências.
- **Assinatura verificada FORA do servidor**, com script próprio e a chave
  pública: `true`. E os dois ataques recusados no mundo real — `updatesUntil`
  adulterado → `false`; `fingerprint` de outra máquina → `false`.

Dado de teste removido do banco de dev ao fim (`DELETE 7 / 3 / 2`).

#### PR-4 — verificação

- **2312 testes verdes** (1640 regras · 157 banco · 515 tela, pelo
  `reports/TESTS.md`) — **+52** sobre o PR-3: 21 da lógica de apresentação, 18
  da página, 13 do arch-spec.
- `tsc --noEmit` limpo nos dois apps; `pnpm build` verde.
- **Todos os critérios de aceite da SPEC-036 exercidos** — os de tela e os de
  API, estes últimos contra Postgres real.

**Uma armadilha de ambiente que custou tempo e vale registrar:** a API de
produção lê `DEV_AUTH_BYPASS` como a string `true`, não `1`. Subir com `=1`
deixa o guard ativo, e toda rota de admin responde `401` — que parece bug da
fatia nova, e não é. Junto com isso, o `EADDRINUSE` silencioso da memória:
a segunda instância morre sem mensagem visível e a primeira, com o ambiente
**antigo**, continua respondendo.

---

## Fatia 26 (SPEC-037) — Licensing: heartbeat, desativação e troca de máquina — `entregue`

Issue **#188** (spec `aprovada-pi` 2026-07-29). **2ª fatia do MVP4.** Fecha o
ciclo de vida da ativação **sem intervenção do dono**: a máquina renova sozinha
a janela offline, e quem trocou de computador libera a vaga antiga sem abrir
suporte.

**Um PR só, e a decisão é de tamanho.** Não há schema novo (o `deactivatedAt` e
o `LicEvent.type` livre nasceram na Fatia 25 justamente para isto), não há tela
nova — a de Licenças ganha uma gaveta. Fatiar em 4 como na 25 seria cerimônia
sobre ~600 linhas.

### Duas rotas públicas, e o que cada uma recusa

**`POST /licensing/v1/heartbeat`** — atualiza `lastSeenAt`, `appVersion` e
**reassina** o license file. O que ele renova é o `signedAt`, e é sobre ele que
o cliente mede a graça de 14 dias: **não é o servidor que desliga o produto — é
o arquivo que envelhece**.

**Ele não reativa em silêncio, e essa é a decisão de desenho da fatia.** Se o
fingerprint não está ativo, houve desativação deliberada (troca) ou máquina nova
reusando a chave. Reativar sozinho aqui tornaria o `maxMachines` decorativo —
bastaria pular o `/activate`. O `409` devolve a lista e quem decide é o cliente.

**`POST /licensing/v1/deactivate`** — libera vaga por `fingerprint` (a própria
máquina) **ou** `activationId` (outra, pelo id da lista do `409`). A segunda
forma é o que faz a troca funcionar quando o computador antigo **não está mais
acessível** — o caso comum de quem trocou de máquina.

Três recusas deliberadas:

- **Ambos os campos → `400`.** Aceitar os dois exigiria decidir qual vence
  quando apontam para máquinas diferentes, e qualquer escolha desativaria em
  silêncio uma que o cliente não pediu.
- **`activationId` de outra licença → `404`**, igual a inexistente. Não
  confirmar a existência é o que impede enumerar ativações alheias com ids
  adivinhados.
- **Expirada NÃO é bloqueada** (só revogada). Quem deixou a assinatura vencer
  ainda pode querer liberar a máquina antes de renovar.

### O furo que a fatia fechou no `/activate`

A SPEC-036 reativava qualquer linha existente pelo ramo "já existe" — inclusive
uma **desativada** — sem passar pela contagem de vagas. Desativar e reativar em
ciclo teria tornado o `maxMachines` decorativo.

Agora só a linha **viva** é reativação gratuita; a desativada disputa vaga como
máquina nova. Continua sendo `update` e não `create` — o unique
`(license_id, fingerprint)` recusaria a segunda linha, e a trilha da máquina
fica inteira.

### Soft delete, e por quê

`deactivatedAt` preenchido, linha preservada. Apagar esconderia a troca do
suporte e zeraria o contador — que é justamente o sinal de abuso do §Escopo.

**Idempotente sem evento novo na repetição:** um `deactivated` a mais por retry
de rede inflaria o contador e faria o sinal disparar sozinho.

### O contador de trocas é sinal, não limite

Decisão 1 do PI: nada bloqueia. Teto errado bloquearia o cliente honesto que
formatou o PC duas vezes, e o volume do piloto permite olhar caso a caso.

**Derivado de `LicEvent`, sem coluna nova.** Uma coluna de contador precisaria
ser alimentada em todo caminho que desativa, e a que alguém esquecesse de
incrementar mentiria em silêncio — o mesmo problema do `LlmUsage.tenant_id`
registrado no `STATUS.md`.

Na tela, **ele só aparece a partir de 4 trocas**: 2 em 30 dias é vida normal, e
um número em toda licença treinaria o olho a ignorá-lo — o oposto do que um
sinal serve para fazer.

### Tela

A gaveta da trilha vira **máquinas + trilha**, numa chamada só: as duas
respondem à mesma pergunta do suporte (*"o que aconteceu com esta licença?"*), e
separá-las em dois cliques faria o atendente abrir as duas sempre.

**`lastSeenAt` não vira "online/offline".** O heartbeat é diário (24 h ± 2 h);
chamar de offline quem bateu há 25 h afirmaria uma queda que não houve — e a
licença segue válida por 14 dias de graça, independentemente disso. O rótulo é
*"último sinal"*.

### Verificação

- **2350 testes verdes** (1640 regras · 180 banco · 530 tela, pelo
  `reports/TESTS.md`) — **+38** sobre a Fatia 25: 23 de integração no ciclo de
  vida, 9 da apresentação, 6 da tela.
- **Os 23 de banco existem porque a fatia inteira é sobre contagem de vagas** —
  e vaga é propriedade do *conjunto* de linhas, não de uma linha. Um mock conta
  o que o teste mandou contar; aqui contam o unique e o `deactivatedAt` de
  verdade.
- **Tenant B não desativa máquina do tenant A**, provado com RLS real.
- `tsc --noEmit` limpo nos dois apps; `pnpm build` verde.

### Dogfooding — o ciclo inteiro contra API e banco reais

- **Heartbeat reassinou**: `signedAt` da ativação `17:50:46.092Z` → do heartbeat
  `17:50:46.598Z`. `appVersion 1.2.0` persistiu no banco.
- **Heartbeat de máquina não ativada** → `409` com a lista das duas vivas, e
  **nenhuma linha criada**.
- **Ciclo completo**: 2 vagas cheias → 3ª dá `409` → desativar o desktop
  (`remainingSlots: 1`) → a 3ª entra → **o desktop de volta dá `409`**, porque
  voltar não é retorno gratuito.
- **Idempotência**: desativar de novo devolveu `200` e o `swapCount` continuou
  **1** — o evento não duplicou.
- **Admin desativou o notebook** com evento próprio; trilha final: `issued`,
  `activated`, `activated`, `heartbeat`, `deactivated`, `activated`,
  `deactivated_by_admin`.
- **Rate limit disparou no meio do teste** (5/min por chave) e barrou a
  sequência — proteção funcionando, com o custo de esperar a janela. Registrado
  porque é o comportamento correto sendo inconveniente, não um defeito.

Dado de teste removido do banco de dev ao fim (`DELETE 7 / 3 / 1`).

---

## [INFRA] CI: build e lint no workflow de PR (#190) — `entregue`

Issue **#190**, aberta pelo PI após auditoria do `ci.yml`. **Não é fatia** — não
há comportamento de produto novo, só o processo de verificação.

**O problema tinha nome:** o `CLAUDE.md` exige *"`dev`, `test`, `lint` verdes é
o piso"*, e duas das três não rodavam. Como **o merge é do próprio Code com o CI
verde** (o portão do PI é o aceite na issue, ADR-011), o CI é a **única trava
antes da `main`** — e ele só rodava testes. Jest e Vitest transpilam sem
type-check completo, então um PR com erro de tipo podia mergear verde.

### O que o build pegou no primeiro dia

**O `@proplan/mcp` não compilava — desde a Fatia 11 (PR #62), meses atrás.** Ele
importa `@proplan/api/dist/mcp-bootstrap.js`, mas o `nest build` preserva a
árvore de `src/` e gera em `dist/src/`. Ninguém percebeu porque **o CI nunca
buildou** e o `mcp` não é deployado (foi removido do Railway na SPEC-027).

É exatamente o tipo de coisa que a issue existia para encontrar, e apareceu
antes mesmo de o workflow rodar uma vez.

O `pnpm build` da raiz também **não incluía o `mcp`** — agora inclui, na ordem
`api → mcp → web`, porque o `mcp` importa o `dist/` da api.

**Build antes dos testes**, e a ordem é deliberada: falha em ~40 s contra os
~8 min da suíte.

### O lint: 168 → 3, e nenhum `warn` de fachada

A issue previa que o volume pudesse exigir decisão do PI entre corrigir tudo ou
começar com regras em `warn`. **Não foi preciso** — a medição mudou a resposta:

| escopo | violações |
|---|---|
| medição inicial | 168 |
| fora do código de aplicação (protótipos de `docs/design/`, hooks locais de `.claude/`/`.codex/`) | **140** |
| **código de aplicação, real** | **28** |

140 eram de arquivos que não são o produto: protótipo de tela que roda solto no
navegador e o HUD local do dev, desversionado em #184. Ignorá-los não é
mascarar — é não medir a qualidade de um rascunho.

Os 28 restantes foram **corrigidos, não silenciados**: 8 imports/variáveis
mortos removidos, 2 inicializadores redundantes, 1 ternário usado como statement
(virou `if/else`), e 4 `eslint-disable` pontuais em código que está certo e a
regra é que não entende — o `const base = this` do `$extends` do Prisma, o
`/\x00/` que existe justamente para remover NUL, o `as const` + `(typeof
X)[number]`, e o `useCallback` do `theme.tsx`.

Sobram **3 avisos** (0 erros): 1 dica de `useMemo` no `BriefingForm` e 2 `any`
em dobra de teste.

**Duas escolhas de config que valem registro:**

- **Sem `projectService` (type-aware).** As regras que exigem tipo
  (`no-floating-promises`) são as mais valiosas — e as que fariam o lint levar
  minutos repetindo o trabalho que o `pnpm build` já faz no step anterior. O
  build cobre tipo; o lint cobre o que o compilador aceita e ninguém quer.
- **`eslint-plugin-react-hooks` instalado porque o código já o esperava.**
  `theme.tsx` e `OperationSteps.tsx` tinham `eslint-disable-next-line
  react-hooks/exhaustive-deps` desde antes desta config — disables apontando
  para um plugin que ninguém havia instalado. A intenção estava no código; a
  verificação, não.

### Uma armadilha do `eslint-disable-next-line`

Ela pega **exatamente** a linha seguinte. Escrevi três disables com a explicação
em duas linhas *entre* a diretiva e o código — e os três viraram
*"unused disable directive"* com o erro original intacto ao lado. A explicação
vai **antes** da diretiva, não depois.

### Verificação

- **`pnpm lint`**: 0 erros, 3 avisos, exit 0.
- **`pnpm build`**: os **três** apps, incluindo o `mcp` que não compilava.
- **2350 testes verdes** (1640 regras · 180 banco · 530 tela) — inalterados: as
  remoções foram de código morto, e o arch-spec do `mcp` provou isso ao quebrar
  quando removi um `f` que **era** usado (revertido).
- `CLAUDE.md` atualizado: a ressalva *"`build` e `lint` ainda não rodam no CI"*
  deixou de ser verdade.

## Fatia 27 (SPEC-038) — Licensing: módulo `mail`, webhook da Kiwify e ciclo da assinatura — `finalizada`

Issue **#191** (spec `aprovada-pi` 2026-07-29). **3ª fatia do MVP4.** É a fatia
em que `billingModel: SUBSCRIPTION` deixa de ser coluna e vira comportamento: a
compra na Kiwify emite a chave e a manda por e-mail, reembolso e chargeback
revogam, renovação estende a assinatura, e inadimplência é registrada **sem
derrubar quem só teve o cartão recusado**.

**Cinco PRs empilhados**, todos com base `main` (PR empilhado com base ≠ `main`
fica sem check nenhum, silenciosamente):

1. **PR-1 — schema** (este): as quatro tabelas, o `pastDueAt` e a função de
   leitura sem sessão. Sem módulo, sem rota, sem job.
2. **PR-2 — módulo `mail`**: `MailService` + adapter Resend + fila BullMQ.
3. **PR-3 — webhook**: rota pública por tenant, assinatura, job processador,
   mapeamento oferta→edição.
4. **PR-4 — ciclo da assinatura**: tolerância na validação, renovação,
   cancelamento, `sourceInviteAt`.
5. **PR-5 — admin mínimo**: pendências, reprocessar, CRUD do mapeamento,
   entregas, settings, reemissão.

### PR-1 — o schema, e as decisões que ele congela

- [x] `LicWebhookEvent`, `LicOfferMapping`, `MailDelivery`, `LicSettings`
- [x] `License.pastDueAt`
- [x] RLS (`ENABLE` + `FORCE`) nas quatro + `resolve_past_due_tolerance`
- [x] Seed do `LicSettings` com segredo sorteado
- [x] 29 testes de banco contra Postgres real

**A idempotência é do recebimento, não do processador.** A rota grava o evento
bruto e responde `200`; quem entende o evento é um job. Plataforma de pagamento
tem timeout curto e reenvia o que demora — processar dentro da request
transformaria lentidão em enxurrada de duplicatas. O `UNIQUE (platform,
external_event_id)` está no **banco** e não num `if`: duas entregas simultâneas
passariam as duas por um `if`.

**O `tenant_id` está fora dessa chave de propósito**, e o teste prova a
ausência. Um id de evento da Kiwify é único na Kiwify; incluir o tenant deixaria
a MESMA entrega ser gravada duas vezes se ela chegasse em duas URLs — e duas
licenças seriam emitidas. Ausência não se prova lendo o schema, se prova
tentando: há um caso que insere o mesmo `externalEventId` em dois tenants e
espera a recusa.

**Ele é NOT NULL, apesar de a spec escrevê-lo opcional.** O tenant sai da
própria URL (`/:tenantSlug`), então existe antes de qualquer leitura —
inclusive para o evento cuja oferta não está mapeada, que é justamente o item
que mais precisa aparecer no admin de alguém. Um evento órfão de tenant seria
invisível para todos.

**Dois uniques no mapeamento de oferta, porque um não basta.** Em Postgres,
NULL não colide com NULL: o unique de quatro colunas deixaria dois curingas do
mesmo produto (`external_offer_id IS NULL`) conviverem apontando para edições
diferentes, e a compra emitiria a licença de qualquer uma das duas. O índice
**parcial** fecha esse caso. O teste distingue os dois pela chave citada no
erro — asserção sobre as colunas, não sobre "deu erro de unique", porque um
índice sobre o par errado também rejeitaria e o teste passaria dizendo que a
garantia existe onde ela não está.

**Três CHECKs de coerência de estado**, todos sobre coisas que passariam por
NOT NULL sem falhar nada: `PROCESSED` sem `processed_at` (e `PENDING` **com**),
`FAILED` sem motivo legível, `SENT` sem `sent_at`. O de `FAILED` é o que mais
importa: item na lista de pendências sem motivo é item que ninguém sabe como
resolver — e a lista existe para ser resolvida.

**`resolve_past_due_tolerance`, e o que ela NÃO devolve.** `/activate` e
`/heartbeat` não têm sessão e rodam sem `app.tenant_ids`; sem a função, o RLS
fail-closed leria a tolerância como "não configurada" em toda validação e o
corte por inadimplência **nunca aconteceria, silenciosamente**. A saída é uma
coluna só: o `webhookSecret` **não sai daqui**, porque uma função com privilégio
de owner que o devolvesse daria a qualquer chamador o poder de forjar entrega
assinada. Há teste lendo o `pg_get_functiondef` para provar isso.

**Ambiguidade conhecida e aceita**: `NULL` responde tanto "tenant sem
configuração" quanto "corte desligado". Os dois levam ao mesmo comportamento —
não cortar por atraso — e é o lado certo de errar: tratar ausência como 15 dias
cortaria o acesso de um tenant que nunca configurou nada.

**A tolerância recusa `0` e negativo.** Zero cortaria no mesmo instante do
atraso, que é exatamente o comportamento recusado pela decisão #3 do PI; quem
quer isso deixa a plataforma revogar, e isso é `null`, não `0`.

**O segredo do seed é sorteado, não fixo.** Um valor igual em toda instalação
seria um segredo público — e é ele que separa "a Kiwify mandou" de "qualquer um
mandou". O seed **nunca sobrescreve**: reseed depois que o admin colou o segredo
real derrubaria a integração em silêncio, e a primeira notícia seria uma venda
que não virou licença.

**`SetNull` nos dois vínculos com a licença.** Apagar uma licença não pode
apagar a prova de que a venda dela chegou nem de que o e-mail saiu — são fatos
sobre o passado, e o suporte precisa deles justamente quando a licença não
existe mais.

#### Desvio da spec, deliberado

`MailDelivery` ganhou **`licenseId` (nullable)**, que o modelo da spec não tem.
O painel da SPEC-040 responde *"o que aconteceu com este cliente"*, e sem o
vínculo a resposta pararia no envio sem dizer de qual licença ele era. Nullable
porque o módulo `mail` é compartilhado — o MVP3 vai mandar e-mail sem licença
nenhuma por trás. Coluna nullable, custo zero de migração.

#### Verificação

- **`prisma migrate diff` limpo**: a migration escrita à mão bate exatamente com
  o schema Prisma. As duas linhas remanescentes do diff (`projects`/`settings`
  com `tenant_id` nullable) são divergência **pré-existente**, confirmada contra
  a `main` num shadow database limpo.
- **1849 testes verdes na API** (1640 regras · 209 banco), `pnpm build` nos três
  apps, `pnpm lint` 0 erros / 3 avisos (os mesmos da `main`).
- **`reports/TESTS.md` regenerado** (banco 180 → 209) e as duas guardas do
  ADR-019 verdes.

### PR-2 — o módulo `mail`

- [x] `MailService.send({ to, template, data })` — grava `MailDelivery` e enfileira
- [x] Adapter Resend por `fetch` (sem SDK), atrás da interface `MailProvider`
- [x] Worker com 5 tentativas e backoff exponencial
- [x] Dois templates: `license_key` e `license_revoked`
- [x] Arch-spec de fronteira · 44 testes

**Compartilhado, não do `licensing`.** Ele nasce nesta fatia porque a venda
precisa dele, mas a assinatura é `send({ to, template, data })` — nada de
licença aparece nela. O MVP3 vai mandar e-mail de briefing pelo mesmo caminho, e
quando isso acontecer não haverá o que refatorar. O arch-spec prova: nenhum
import de módulo-irmão, e nenhum tipo do domínio de licenciamento na superfície.

**Enfileira, não envia — e é a garantia da fatia.** Se o `licensing` esperasse o
Resend responder para concluir a emissão, um provedor fora do ar transformaria
compra paga em licença não emitida, e a plataforma não reenvia o evento de
compra por causa de um erro nosso. Emitir e enviar são coisas diferentes; só a
primeira é inegociável.

**A ordem `create` → `add` é decisão, não estilo.** Com o Redis fora, a linha
`PENDING` fica no banco e aparece como pendência real no admin. Na ordem
inversa, um job enfileirado sem linha seria um envio que ninguém consegue
auditar — e o worker falharia procurando a `MailDelivery` que nunca existiu.

**O corpo é renderizado no worker, nunca persistido.** A `MailDelivery` guarda
`template` e `subject`; o `html` só existe entre o `render()` e o `fetch`.
Guardar o corpo do `license_key` seria guardar a chave em claro por outro nome, e
desfaria a garantia central da SPEC-036 — é exatamente por isso que **reenviar
não reenvia a chave**, e a reemissão (PR-5) é ato distinto, com revogação da
anterior. Há teste de arch-spec varrendo `data: { … html … }` e o schema.

**`fetch` na REST API, sem SDK do Resend.** Mesma decisão do GitHub (CLAUDE.md:
Octokit é ESM-only e conflita com o build CJS do Nest) — são ~40 linhas contra
uma dependência nova num build que já pagou esse preço uma vez.

#### Duas armadilhas achadas na documentação do Resend, não no código

**O SDK não lança exceção**: `emails.send` devolve `{ data, error }`, e um
`try/catch` sozinho trataria falha como sucesso — marcando `SENT` num e-mail que
não saiu. Nosso adapter converte para `throw`, que é o que faz o BullMQ
contabilizar a tentativa; o teste do worker fixa isso.

**`User-Agent` é obrigatório e a falta dele não diz o que é**: requisições sem o
header são bloqueadas **antes** de chegar à API, com `403` e código `1010`, e a
mensagem não menciona o header. `curl` manda sozinho, `fetch` não. É a classe de
erro que só aparece em produção e leva uma tarde para achar — há teste que
falha se alguém removê-lo.

#### Decisões menores, com motivo

- **5 tentativas**, contra as 2–3 do resto da casa: os outros jobs releem uma
  fonte que continua lá; um e-mail perdido não tem segunda via, porque a chave
  que ele carrega não existe mais em lugar nenhum.
- **`FAILED` gravado em toda passagem**, não só na última: o estado do banco
  descreve o que aconteceu até agora, e `attempts` diz se ainda há tentativa
  pela frente. Marcar só no fim deixaria a falha invisível por minutos.
- **Entrega já `SENT` não reenvia.** O BullMQ pode reprocessar um job cujo
  worker morreu *depois* do envio — e dois e-mails com chaves diferentes deixam
  o comprador sem saber qual vale.
- **`text` junto do `html`**: cliente que bloqueia HTML mostraria mensagem
  vazia, e filtro de spam pontua pior mensagem só-HTML. Num e-mail que entrega o
  que o cliente pagou, cair no spam é o pior desfecho.
- **Estilo inline, não `<style>`**: o Gmail remove blocos `<style>` do `<head>`.
  É a razão de todo e-mail transacional parecer HTML de 2005.
- **Escapa HTML do nome do comprador**, que vem da plataforma de pagamento —
  entrada externa.

#### Documentação

`docs/DEPLOY.md` §3.5 (novo) e `.env.example`: `RESEND_API_KEY` e `MAIL_FROM`.
Registrada a pendência do **domínio do remetente** — subdomínio dedicado
(decisão PI #4), concreto ainda indefinido, que bloqueia **só o primeiro envio
real**. Com a armadilha anotada: sem SPF/DKIM o sintoma é o pior possível — o
`MailDelivery` fica `SENT` (o Resend aceitou) e o comprador não recebe nada.

#### Verificação

- **1893 testes verdes na API** (1684 regras · 209 banco), **+44** nesta etapa.
- `pnpm build` nos três apps · `pnpm lint` 0 erros / 3 avisos (os da `main`).
- **Nenhuma dependência nova.**

### PR-3 — o webhook da Kiwify

- [x] `POST /licensing/v1/webhooks/kiwify/:tenantSlug` — pública, sem sessão
- [x] Assinatura HMAC-SHA1 validada contra o `webhookSecret` do tenant da URL
- [x] `LicWebhookEvent` gravado bruto; processamento em job (fila `licensing`)
- [x] Os cinco desfechos: emitir · revogar · renovar · atraso · cancelar
- [x] Mapeamento oferta→edição, com `FAILED` retentável quando falta
- [x] `rawBody: true` no `main.ts` · 84 testes

#### A documentação da plataforma mudou três decisões

Antes de codificar, li a **documentação oficial** (`kiwify.notion.site/Webhooks-pt-br`,
consultada em 2026-07-29) e os prints do painel real que o PI mandou. Três coisas
que eu teria errado por suposição:

**1. O algoritmo é HMAC-SHA1, e só ele.** Eu havia escrito SHA1 **e** SHA256
"para cobrir os dois". A doc é explícita: `signature = hmac_sha1(JSON.stringify(request.body), secretKey)`,
com `signature` na **query string**. Aceitar mais algoritmos que a plataforma usa
não é robustez — é ampliar a superfície: bastaria um algoritmo fraco na lista
para a verificação valer o mais fraco. Há teste recusando SHA256 explicitamente.

**2. O segredo é o Token que a Kiwify gera, não um que nós escolhemos.** No
painel (*Apps → Webhooks → Criar webhook*) o campo **Token** vem preenchido com
algo como `7ih5upe3rvb`. É esse valor que vai para `LicSettings.webhookSecret` —
o seed sorteia um só para que a rota não aceite entrega assinada por quem leu o
repositório antes de o admin colar o real.

**3. A Kiwify assina o RE-STRINGIFY, não os bytes.** Os dois exemplos oficiais
(JS e PHP) fazem `JSON.stringify(JSON.parse(body))` / `json_encode(json_decode($payload))`.
Isso é frágil do lado deles — depende de dois serializadores concordarem em ordem
de chaves e escapes — mas é o contrato publicado. **Verificamos as duas formas**:
o re-stringify (que a Kiwify usa) e o `rawBody` (correto para qualquer plataforma
que assine bytes, incluindo a Hotmart prevista em §Fora de escopo). Duas
comparações de HMAC numa rota de poucas entregas por dia; o modo de falha que
elas evitam é *"nenhuma venda vira licença, e o log diz apenas 401"*.

O `rawBody: true` no `main.ts` fica de todo modo: ele não custa nada e é o que
torna o segundo caminho possível.

#### Não existe id de evento — a chave de idempotência é construída

O payload traz `order_id` e `order_ref`; **`webhook_event_id` não existe**. E a
Kiwify **reenvia até 5 vezes** o que não recebe `2xx` em 40 s, então a chave do
`@@unique(platform, externalEventId)` tem de vir de algum lugar. A composição é a
decisão, e cada parte fecha um bug:

- **Compra**: `order_id` sozinho. Uma venda, uma licença.
- **Evento de assinatura**: `subscription_id` + tipo + `order_id`. Sem o **tipo**,
  o cancelamento de hoje seria descartado como duplicata da renovação de três
  meses atrás — e o cliente manteria acesso depois de cancelar. Sem o
  **`order_id`**, a renovação de agosto seria duplicata da de julho, `expiresAt`
  congelaria, e **o acesso morreria com a assinatura em dia**.

Os dois casos têm teste próprio, porque nenhum dos dois falha de forma visível:
um deixa acesso aberto, o outro fecha acesso pago.

#### Não existe `offer_id` — e o mapeamento continua certo

O payload só traz `Product.product_id`. O `LicOfferMapping` do PR-1 continua como
está: a coluna `externalOfferId` é nullable, e para a Kiwify o casamento é sempre
na **linha curinga do produto**. Foi o índice parcial do PR-1 que salvou aqui —
sem ele, dois curingas do mesmo produto conviveriam e a compra emitiria a licença
de qualquer um dos dois.

#### A renovação acha a licença pela trilha, não por coluna nova

A cobrança de agosto traz `order_id` **novo**, que não casa com nenhum `saleRef`.
O resgate é o `subscription_id`, gravado no payload do `LicEvent` `webhook_issued`
na emissão — não numa coluna, porque criar uma mudaria o schema do PR-1 por um
caminho que o `saleRef` já cobre no caso comum. Três tentativas, nesta ordem:
`saleRef` → `subscriptionId` → e-mail (a licença mais recente, porque quem
comprou duas vezes tem duas).

#### O que a rota recusa, e o que ela aceita

`401` para assinatura inválida/ausente, **tenant inexistente** e **tenant sem
configuração** — os três iguais de propósito: distinguir diria a quem sonda quais
slugs existem e quais já vendem.

`200 { received: true }` para todo o resto, **inclusive** duplicado, tipo
desconhecido e o que vai falhar no processamento. Um `4xx` para o que nenhum
reenvio conserta (oferta sem mapeamento) faria a plataforma reenviar 5 vezes algo
que só o admin resolve.

**Fora do rate limit** das outras três rotas públicas: elas protegem contra
varredura de chaves, e recusar entrega legítima por excesso de vendas numa
promoção transformaria sucesso comercial em licença não emitida. A assinatura já
é a barreira.

#### O que cada desfecho faz, e a decisão do PI por trás

| evento | efeito | decisão |
|---|---|---|
| `order_approved` | emite + e-mail com a chave; `sourceInviteAt` na edição `source` | — |
| `order_refunded` / `chargeback` | `REVOKED` + e-mail; **limpa** `sourceInviteAt` | sem isso, quem pediu reembolso ganharia o código 8 dias depois |
| `subscription_renewed` | estende `expiresAt` **e limpa `pastDueAt`** | #3 — o caminho de volta é obrigatório |
| `subscription_late` | marca `pastDueAt`, **mantém `ACTIVE`** | #3 — cartão recusado é rotina; a plataforma retenta |
| `subscription_canceled` | **preserva** `expiresAt` | #2 — quem cancelou pagou o ciclo corrente |
| `billet_created`, `pix_created`, `order_rejected`, carrinho abandonado | `IGNORED` | intenção de compra e venda recusada **no ato** não são inadimplência de assinatura — marcar `pastDueAt` aí criaria atraso numa licença que nunca existiu |

Três idempotências que não são a do recebimento: revogar de novo não reescreve a
data nem manda 2º e-mail; atraso repetido **não reinicia** o relógio da tolerância
(reiniciar a cada retry da plataforma faria a tolerância nunca vencer); e
renovação **não ressuscita** licença revogada (reembolso é decisão de dinheiro).

#### Um falso positivo de arch-spec, e por que ele importa

A regra *"nada de IA nesta fatia"* era `/(llm|anthropic|openai)/i` sobre a linha
inteira — e **`bu(llm)q` contém `llm`**. Quando a fila do webhook entrou, ela
reprovou 27 imports de `@nestjs/bullmq`. Reescrita para decidir por **segmento do
especificador**, cobrindo as três formas de importar IA (caminho relativo,
pacote nu, escopo npm) e validada contra 11 casos antes de entrar. Um arch-spec
que grita por engano é um arch-spec que alguém desliga — e aí ele para de
proteger a regra de verdade.

O arch-spec também ganhou a exceção do `mail` (a SPEC-038 a exige) **com** a
contrapartida: `prisma.mailDelivery` continua proibido aqui, porque escrever
direto pularia a fila.

#### Verificação

- **1977 testes verdes na API** (1768 regras · 209 banco), **+84** nesta etapa.
- `pnpm build` nos três apps · `pnpm lint` 0 erros / 3 avisos (os da `main`).
- **O CI não fala com a Kiwify nem depende de túnel**: as fixtures são decalcadas
  do exemplo oficial.
- **Pendente: dogfooding com túnel** — é onde o formato real da entrega se
  confirma de ponta a ponta. O botão *Testar Webhook* do painel da Kiwify dispara
  eventos de teste, e o menu *Ver logs* mostra requisição e resposta de cada
  entrega, com reenvio manual.

### PR-4 — o ciclo da assinatura

O que o PR-3 deixou pela metade, e não era óbvio: ele entregou toda a **escrita**
do ciclo — renovação estende `expiresAt` e limpa `pastDueAt`, atraso marca,
cancelamento preserva a data, reembolso revoga e limpa `sourceInviteAt`. Faltava
a **leitura**. `pastDueAt` não aparecia em nenhum arquivo de validação: o webhook
marcava a inadimplência e **nada cortava**.

Era a versão silenciosa do defeito que o PR-1 previu ao criar a
`resolve_past_due_tolerance` — a função existia na migration e **não tinha um
único chamador**.

**Cinco peças:**

1. **Migration `resolve_license` + `past_due_at`.** A função devolvia 9 colunas e
   nenhuma era o atraso — o gate não tinha o que comparar. `DROP` + `CREATE` é
   obrigatório (o Postgres recusa `CREATE OR REPLACE` que muda o tipo de retorno,
   `42P13`), e o `GRANT` no fim não é cerimônia: sem ele toda ativação falha por
   permissão. Mesmo molde da emenda do `issued_at`.
2. **`domain/past-due.ts`** — regra pura, `now` por parâmetro. A decisão PI #3
   mora aqui: `toleranceDays: null` é tolerância **infinita**, não zero. Ler os
   dois como a mesma coisa inverteria a decisão do PI e cortaria a base inteira
   de um tenant que nunca pediu corte automático. Fronteira **exclusiva** — no
   instante exato do vencimento o acesso ainda vale, porque quem paga no último
   dia precisa poder abrir o app.
3. **Gate em `licencaUtilizavel`** — o terceiro `410`, junto dos outros dois, no
   método que `/activate` e `/heartbeat` **compartilham**. O comentário que já
   estava lá dizia por quê: *"uma cópia divergindo deixaria uma das rotas
   servindo licença vencida"*. Cortar só no `/activate` seria pior que não cortar
   — é o heartbeat que renova a validade offline, então o inadimplente seguiria
   com o produto vivo para sempre.
4. **`LicEvent` do corte, tipo `past_due_cut`** — **sem** o prefixo `webhook_`
   que o PR-3 usa: a causa é nossa (a tolerância venceu), não um aviso da
   plataforma, e a spec pede o corte "distinguível da revogação vinda da
   plataforma". Gravado **uma vez** por ciclo de atraso: o binário cortado segue
   chamando de hora em hora, e a idempotência vem da própria trilha
   (`createdAt >= pastDueAt`, que é o que faz um atraso **novo** voltar a
   registrar em vez de ficar mudo para sempre).
5. **`LicenseExpirySweepService`** — o job que materializa `status=EXPIRED` para
   o admin ver. Ele **não decide nada**: pode morrer por semanas sem afetar
   acesso nenhum, porque a comparação `expiresAt < now` já mora na validação. O
   pior caso é a lista do admin ficar velha — nunca alguém entrando onde não
   devia.

**Um erro meu, pego antes de fiar.** Escrevi `status: 'PAST_DUE'` no primeiro
rascunho do gate. Esse valor **não existe** no enum (`ACTIVE`/`REVOKED`/`EXPIRED`)
e contradiz a spec, que diz que `pastDueAt` registra inadimplência **sem mudar
`status`**. Se tivesse passado, teria quebrado o caminho de volta do PR-3: o
pagamento aprovado limpa `pastDueAt` e espera a licença ainda `ACTIVE`. Um estado
novo exigiria que o PR-3 — já mergeado — soubesse voltar dele. O gate agora não
toca no `status`.

**Três provas contra o bug**, não só testes verdes:

- **Gate comentado** → 6 dos 10 casos do int-spec falham.
- **Guarda de idempotência removida** → o contador vai de 1 para 3 eventos.
- **`past_due_at` removido da `resolve_license`** (função mutilada à mão no banco
  de teste, que o `migrate deploy` não reaplica) → *"Received promise resolved
  instead of rejected"*: a licença atrasada há 20 dias **ativa normalmente**. É a
  prova de que a migration carrega peso, e não é acompanhamento decorativo.

**Por que int-spec e não mock.** Três coisas do corte só existem no banco: a
`resolve_past_due_tolerance` é `SECURITY DEFINER` (um mock devolveria 15
alegremente, escondendo um `GRANT` faltando), a `resolve_license` precisa
carregar a coluna, e o evento é escrito sob RLS — fora de contexto o `create`
grava zero linhas **sem erro**.

**Não introduzi agendador.** Não existe `@nestjs/schedule` nem `repeat` do BullMQ
no repo, e a spec não diz como o job dispara. O serviço é invocável e testado;
escolher o mecanismo de agendamento é decisão de infra que não é minha.

**Suíte**: regras **1782** (+4), banco **219** (+10), tela 530. Build nos três
apps, lint 0 erros, guarda do ADR-019 aprovando.

### PR-5 — o admin mínimo

Fecha a Fatia 27. O que ele destrava, em uma frase: **a venda que não virou
licença deixa de ser um beco.**

O PR-3 grava oferta não mapeada como `FAILED` de propósito — evento com dono,
payload bruto guardado, nada emitido. Sem tela, esse estado é informação no banco
que ninguém alcança, e a única saída seria pedir à Kiwify que reenviasse. O
critério de aceite da fatia é justamente sair dele: *"cadastrar o mapeamento e
reprocessar o evento pendente emite a licença — sem precisar da plataforma
reenviar"*.

**Quatro grupos de endpoints**, em `licensing-ops.service.ts` + as rotas no
controller que já existia:

1. `GET webhook-events?status=` e `GET webhook-events/:id` — a lista **não**
   devolve o `payload`: é corpo bruto com dado do comprador, e a lista carrega
   sempre. Quem precisa dele abre o item.
2. `POST webhook-events/:id/reprocess` — volta para `PENDING` **antes** de
   enfileirar. Se o processo cair entre as duas linhas, a tela diz "esperando" e
   o dono reprocessa; o inverso deixaria um `FAILED` já na fila, e o segundo
   clique duplicaria o job. Recusa `PROCESSED` com 422: a idempotência do PR-3
   mora no `UNIQUE` do **recebimento**, não do processamento.
3. `GET|PUT settings` — segredo **write-only** e a tolerância.
4. CRUD de `LicOfferMapping` — o de-para que resolve a compra em edição.

**O desvio da spec, registrado:** ela escreve as rotas como
`/licensing/admin/...`, mas o controller do PR-2 é `@Controller('t/:tenant/licensing')`
— **o ProPlan não tem `/admin`**. Segui o código, não o texto: inventar um
prefixo novo criaria duas convenções de rota no mesmo módulo.

**Três decisões que a tela não pode errar**, todas cobertas por teste:

- **O segredo nunca aparece.** `GET` devolve `webhookSecretSet: true|false`,
  jamais o valor; o campo é `type="password"` e nasce vazio, porque serve para
  gravar, não para ler. O segredo é o Token que a **Kiwify** gera (achado do
  PR-3), então a origem é o painel dela — ninguém precisa lê-lo de volta daqui, e
  exibi-lo seria superfície de vazamento sem nada em troca. Mesmo princípio que o
  manteve fora da `resolve_past_due_tolerance` no PR-1. Provado contra o bug:
  trocar o campo para `type="text"` **quebra** o teste.
- **`null` na tolerância não é campo vazio.** É a decisão PI #3 — o ProPlan não
  corta e quem revoga é a plataforma. A tela diz isso por extenso
  (*"O ProPlan nunca corta por atraso"*), porque um `—` seria lido como "não
  configurado" e alguém iria "consertar" configurando: ligaria um corte que o
  dono desligou de propósito. `null` e ausente são distinguíveis em todo o
  caminho — client, service e `PUT`.
- **Reprocessar diz "reenfileirada", nunca "reprocessada".** O job é assíncrono;
  afirmar o resultado no toast seria o *fechamento frágil* que este produto
  existe para detectar. Há teste barrando as palavras de sucesso na mensagem.

**Um detalhe que fecha um bug silencioso:** `platform` era literal `'kiwify'` em
dois lugares do PR-3. Extraí `PLATFORM_KIWIFY` e usei nos três (intake,
processor, cadastro) — porque o cadastro **tem** de casar exatamente com o filtro
do processador. Gravar `'Kiwify'` produziria o pior sintoma possível: mapeamento
visível na tela, compra continuando a falhar como "oferta não mapeada", e nada
errado em log nenhum.

**Detalhes menores, com motivo:** `IGNORED` é badge **neutro**, não alerta —
evento de tipo desconhecido (`pix_created`) é resultado normal, e pintá-lo de
vermelho faria caçar problema onde não há; `IGNORED` **pode** ser reprocessado
(se um tipo passar a ser suportado, é exatamente o que se quer); curinga é dito
por extenso (`—` faria o caso mais importante parecer campo em branco); o
`<select>` leva `color-scheme`, senão a lista aberta fica ilegível no tema escuro
(achado da #153).

**Arquivo próprio, não inflar a página:** `LicensesPage.tsx` estava em 721 linhas
e o teto do projeto é 800. O painel virou `WebhookOpsPanel.tsx` + `webhookOpsView.ts`
(funções puras), e a página só ganhou o import e a fiação.

**Fora de escopo, por decisão registrada:** `GET mail-deliveries` e
`POST licenses/:id/reissue` estão nos Contratos da spec mas **não** na tela
mínima do §Fora de escopo — e a SPEC-040 absorve as telas mínimas das fatias
25–28. Não ampliei.

**Suíte**: regras **1804** (+22), banco 219, tela **562** (+32). Build nos três
apps, lint 0 erros, guarda do ADR-019 aprovando. **Pendente: dogfooding com
túnel** — a fatia inteira (PR-3 a PR-5) nunca viu uma entrega real da Kiwify.

## Fatia 28 (SPEC-039) — Licensing: convite ao repo source, coleta do username e revogação de colaborador — `aceita-pi (2026-07-30)`

> **Aceite do PI em 2026-07-30**, com o dogfooding do fluxo **fora** da fatia: o
> convite real e a revogação contra o GitHub dependem de uma **venda**, não de
> código, e prender a fatia a isso a manteria aberta por tempo indeterminado. A
> verificação continua devendo — está registrada como pendência própria no
> `STATUS.md`, para que ninguém a confunda com algo já conferido.

Issue **#195** (spec `aprovada-pi` 2026-07-29). **4ª fatia do MVP4.** A venda da
edição **com código-fonte** vira acesso ao repositório privado sem ninguém no
meio — e o acesso acaba quando o dinheiro volta.

O que esta fatia **não** entrega, e está escrito antes de qualquer tela sugerir o
contrário: remover o colaborador **não recupera o que já foi clonado**. O que a
remoção entrega é o fim dos *updates* — o mecanismo real do produto é contratual
(§8 do MVP4).

**Cinco PRs empilhados**, todos com base `main` (PR empilhado com base ≠ `main`
fica sem check nenhum, silenciosamente):

1. **PR-1 — schema** (este): o enum de estado, o link de coleta, o PAT por
   tenant e a função de leitura sem sessão. Sem rota, sem job, sem cliente do
   GitHub.
2. **PR-2 — coleta do username**: `GET|POST /s/:token`, página pública React,
   validação na GitHub API com confirmação por avatar, template do e-mail.
3. **PR-3 — job do convite**: reconciliação diária, `PENDING → INVITED → ACTIVE`,
   cliente GitHub com PAT (separado do cliente do GitHub App).
4. **PR-4 — revogação** (`feito`): cancela *invitation* **ou** remove colaborador,
   conforme o estado; `FAILED` retentável.
5. **PR-5 — admin mínimo** (`feito`): pendências de source, corrigir username,
   reemitir, remover acesso, PAT write-only com teste de conexão.

### PR-1 — o schema, e o booleano que precisou morrer

- [x] `LicSourceAccess` (`NONE|PENDING|INVITED|ACTIVE|REMOVED|FAILED`)
- [x] `License.sourceAccess`, `githubUsername`, `githubInvitationId`,
      `sourceAccessError` — e **`sourceInvited` removido**
- [x] `LicSourceLink` (só `tokenHash`, `usedAt` sem prazo fixo)
- [x] `LicProduct.sourceRepo`, `LicEdition.grantsSourceAccess`,
      `LicSettings.githubPat`
- [x] RLS (`ENABLE` + `FORCE`) + `resolve_source_link` (`SECURITY DEFINER`)
- [x] 13 testes de banco contra Postgres real

**O booleano da SPEC-036 não expressava a diferença que a revogação precisa.**
`sourceInvited: Boolean` não distingue *"convidado, ainda não aceito"* de
*"aceito"* — e os dois estados se desfazem por chamadas **diferentes** na API do
GitHub: convite pendente por `DELETE /repos/:owner/:repo/invitations/:id`,
colaborador aceito por `DELETE /repos/:owner/:repo/collaborators/:username`.
**Chamar a errada é no-op silencioso**: a API responde sem erro, nada aparece em
log, e o comprador reembolsado continua com acesso ao código-fonte. O campo foi
carimbado na SPEC-036 antes desta fatia existir; agora que ela é real, o tipo não
serve. Há teste afirmando que a coluna **não existe mais** — se ela sobreviver,
algum caminho volta a escrever nela.

**A tradução do dado vem antes do `DROP`, e nessa ordem.** `true` só pode virar
`INVITED`, nunca `ACTIVE`: o booleano registrava que o convite **saiu**, e nada
nele dizia se foi aceito — marcar `ACTIVE` afirmaria aceitação que ninguém
verificou. Quem promove a `ACTIVE` é a primeira reconciliação, que é o caminho
honesto. O banco local está vazio (verificado antes de escrever a migration), mas
o `UPDATE` fica: produção é o ambiente em que ele importa, e migration que só
funciona onde não há dado não é migration.

**`resolve_source_link` existe pela 6ª ocorrência da mesma armadilha.**
`GET /s/:token` **não tem sessão**: roda sem `app.tenant_ids`, e o RLS
fail-closed devolveria zero linhas para **todo** token — inclusive os válidos. O
sintoma seria *"todo comprador vê link inválido"*, sem erro em lugar nenhum. Mesmo
desenho da `resolve_briefing_link` (SPEC-029) e da `resolve_contract_link`
(SPEC-034): um argumento, sem filtro livre, sem listagem, sem paginação — não há
como enumerar.

**Nenhum dado pessoal sai da função privilegiada**, e isso é prova por ausência.
A página é **pública**: se a função devolvesse `customer_email`, o link vazado
deixaria de ser só acesso indevido e passaria a ser vazamento de dado pessoal.
O teste lista as colunas e afirma que `customer_email`, `customer_name`,
`github_username`, `github_pat`, `webhook_secret` e `token_hash` **não estão
lá** — mesmo desenho das provas de ausência de receita da SPEC-034/035.
Acrescentar uma dessas colunas um dia seria uma linha inocente no SQL e um
vazamento na rota.

**A função não filtra link usado, de propósito.** Se filtrasse, *"usado"* e
*"inexistente"* chegariam à rota como a mesma coisa — e o critério de aceite
exige que reabrir o link mostre **"já utilizado"**, nunca o formulário de novo.
Quem decide isso é a rota, com o `usedAt` que a função devolve.

**`grantsSourceAccess` existe para não casar a edição pelo slug `source`.**
Hardcode de slug funciona no piloto e quebra em silêncio no primeiro produto que
chame a edição de outra coisa: a compra emitiria a licença sem agendar convite, e
o comprador da edição mais cara do catálogo nunca receberia o código.

**O PAT não é o token do GitHub App** (ADR-015). São credenciais de propósitos
diferentes: aqui basta `administration:write` no repo do produto (decisão #8 do
MVP4), sem expandir as permissões do App nem exigir re-consent das instalações.
Por tenant e não em env var (decisão PI #2) — mesmo argumento aceito para o
`webhookSecret`. A arch-spec cobra a separação no código a partir do PR-3;
misturá-las reabriria o ADR por acidente.

**`usedAt` é a morte do link, não um relógio** (decisão PI #3). Prazo curto
trocaria um risco raro (link vazado) por um problema frequente: o comprador que
responde no dia 10 e encontra link morto, na venda mais cara do catálogo, já pago
e sem o que comprou.

### PR-1 — verificação

**Prova contra o bug, não só verde.** Derrubei a `resolve_source_link` no banco de
teste e rodei a suíte: **5 dos 13 testes falham** com
`function resolve_source_link(unknown) does not exist`. É a medida de que a
função carrega peso — sem essa prova, um teste que consultasse a tabela direto
(sob contexto) passaria com a função ausente e a rota pública quebraria em
produção.

`migrate diff` entre o schema Prisma e o banco: **zero divergência** nas tabelas
desta fatia — o SQL escrito à mão casa com o modelo (as duas linhas de
`projects`/`settings` no diff são drift pré-existente, fora deste PR).

**Suíte**: regras 1804, banco **232** (+13), tela 562 — **2036 verdes** na API.
Build nos três apps, lint 0 erros (3 warnings pré-existentes), `reports/TESTS.md`
regenerado para a guarda do ADR-019.

### PR-2 — a coleta do username

- [x] `GET /source-links/:token` · `POST .../lookup` · `POST .../username`
- [x] Página pública React `/s/:token`, duas etapas com confirmação por avatar
- [x] `GithubSourceClient` (PAT, **separado** do cliente do GitHub App)
- [x] Templates `source_username_request` e `source_username_confirmed`
- [x] Gatilho na compra: o webhook decide pela **coluna**, não pelo slug
- [x] +92 testes de regra, +8 de banco, +15 de tela

**O hardcode que o PR-1 previu estava vivo, e eu o matei aqui.** O webhook da
SPEC-038 agendava o convite por `edicao.slug === 'source'`. Agora decide por
`grantsSourceAccess`, e há teste com uma edição de slug **`completa`** que
concede source: com o hardcode antigo ela não agendaria convite nenhum — a
licença sairia normal, o comprador da edição mais cara do catálogo nunca
receberia o código, e nada apareceria em log.

**A licença nasce `PENDING` na compra**, antes de o comprador informar o
username. É o que faz a licença sem username **aparecer** na lista de pendências
do admin, em vez de simplesmente não existir para ninguém.

**Na revogação, `PENDING` volta a `NONE`; `INVITED` e `ACTIVE` não são tocados.**
Essa condição é a razão de o enum existir. Limpar o estado de quem ainda não foi
convidado tira a licença da fila do job — sem isso ela ficaria em `PENDING` para
sempre na lista de pendências, um convite que nunca sai e ninguém resolve. Mas se
o convite **já saiu**, sobrescrever com `NONE` apagaria justamente o que diz qual
chamada desfaz o acesso: `INVITED` cancela a *invitation* pelo
`githubInvitationId`, `ACTIVE` remove o colaborador pelo username. Perdido o
estado, o PR-4 chamaria a errada — que é no-op silencioso — e o reembolsado
ficaria com o código-fonte. Era exatamente o que o booleano não distinguia.

**O e-mail de coleta sai depois da chave, e falhar nele não desfaz a compra.** A
licença já está gravada e a chave já foi enfileirada; derrubar a emissão por
causa do segundo e-mail trocaria um problema recuperável (reemitir o link pelo
admin) por um irrecuperável — a plataforma não reenvia o evento de compra por
erro nosso.

**Três desfechos, não dois, na consulta ao GitHub.** `404` é "não existe";
`403`/`429`/`5xx` **lançam**. Tratar rede fora como "usuário não existe" faria o
comprador corrigir um dado correto — ou desistir. É o precedente do FIX #136, e
a tela chega a dizer *"o seu usuário provavelmente está certo"*.

**A sintaxe do username é validada ANTES da rede**, e não por elegância: sem
isso, `../../admin` é interpolado em `GET /users/:username` e a requisição sai
para outro endpoint da API do GitHub. Há teste com cinco formas de path
traversal afirmando que o cliente nunca é chamado.

**`used` é distinto de `invalid`**, e é o único ponto em que esta rota não é
não-diferencial. O critério de aceite exige que reabrir o próprio link mostre
*"já utilizado"* — mostrar o formulário de novo faria quem já informou concluir
que o envio falhou, e informar outra vez. O que continua indistinguível são
inexistente e de outro tenant, que é onde a não-diferenciação protege: a
enumeração de tokens.

**O username fica `PENDING`, nunca `INVITED`**, ao ser gravado. O comprador
informou o login; o convite ainda não saiu. Marcar `INVITED` aqui afirmaria um
convite que ninguém emitiu — e o job do PR-3, que seleciona `PENDING`, nunca
convidaria esta licença.

**O link queima na MESMA transação do username**, com `usedAt: null` no `WHERE`.
Separá-los abriria a janela em que o username está gravado e o link ainda serve —
e o link serve para gravar username: quem tivesse a URL sobrescreveria o dado de
quem comprou. Um `if` antes do update deixaria duas requisições simultâneas
passarem; o teste de corrida prova que a segunda é recusada.

**A URL do e-mail é a da web, não a da API.** `/s/:token` é rota React. Mandar a
base da API levaria o comprador a um JSON — ou ao catálogo, sem erro visível. Já
aconteceu nesta base com `/b/` (web) e `/c/` (API), e há teste afirmando a porta.

### PR-2 — verificação

**Dois defeitos meus, achados por teste que eu escrevi para pegá-los.**

O primeiro: **`503` no carregamento do link mostrava "Link inválido"**. A causa
era a tradução no cliente HTTP — todo `503` virava `GithubUnavailableError`, e a
página só tratava `UnreachableError`, então caía no `else` como inválido. Mas no
`GET` do link **não existe GitHub envolvido**: ali um `503` é a nossa API fora do
ar. Acusar de ruim um link intacto, de uso único e sem segunda via, é o pior
desfecho possível desta tela.

O segundo: o int-spec inteiro falhava com *"licença não encontrada"* porque o
`PrismaService` lê `DATABASE_URL` do `.env` — o banco de **dev**. O service
escrevia num banco e o `owner` lia noutro. O int-spec do `/activate` carrega
esse mesmo aviso desde a SPEC-036; eu repeti o erro que já estava documentado.

**Um falso positivo de arch-spec corrigido.** A
`installation-token-usage.arch.spec.ts` (ADR-015) varria `.installationToken(`
sobre o texto cru, e o `github-source.client.ts` **cita o método em prosa** —
justamente para explicar que não o chama. Reprovado pela frase que documenta a
própria conformidade. Passou a descartar comentários, como a
`licensing-boundaries` já fazia. **Provado nos dois sentidos**: verde com o
comentário, e vermelho quando inseri uma chamada real de teste.

**Prova contra o bug**: derrubada a `resolve_source_link` no banco de teste,
**7 dos 8** testes de integração falham — a medida de que a rota pública depende
dela de verdade.

**Suíte**: regras **1896** (+92), banco **240** (+8), tela **579** (+17) —
**2136 verdes** na API. Build nos três apps, lint 0 erros (3 warnings
pré-existentes).

**Pendente: dogfooding.** A página nunca foi aberta no navegador, e o convite
real ao GitHub é do PR-3. O `checkRepoAccess` existe mas ainda não tem chamador —
é do PR-5, junto do campo de PAT no admin.

### PR-3 — o convite, e o que a documentação oficial corrigiu

- [x] `SourceInviteService.reconcile(tenantId)` — duas fases, idempotente por estado
- [x] `GithubSourceClient.invite` e `.isCollaborator`
- [x] `CryptoService` exportado do `identity` (PAT cifrado com a chave existente)
- [x] +35 testes de regra

**A documentação oficial mudou uma decisão que eu teria errado por suposição.**
`PUT /repos/:owner/:repo/collaborators/:username` tem **dois desfechos de
sucesso**, não um:

| resposta | significado |
|---|---|
| `201` | convite criado — o corpo traz a *invitation*, e o `id` dela é o que permite **cancelar** depois |
| `204` | **já era colaborador**; nenhum convite foi emitido |

Eu trataria tudo como convite. O `204` acontece na recompra, ou quando o convite
é aceito entre a nossa leitura e a chamada — e gravar `INVITED` nesse caso
deixaria a licença esperando **para sempre** uma aceitação que já aconteceu, com o
PR-4 tentando cancelar uma invitation inexistente. Agora `204` grava `ACTIVE`.

**A reconciliação não é gatilho de data, e o filtro prova isso.** `sourceInviteAt
<= agora`, nunca `= hoje`. Um job por data exata deixaria órfão, para sempre e em
silêncio, o comprador que informou o username no dia 9 — o caso mais provável de
todos, porque depende de alguém ler e-mail. Há teste afirmando que o `where` tem
`lte` e **não tem** `equals` nem `gte`.

**A aceitação é descoberta, não notificada.** O GitHub não manda webhook de
convite aceito em repo pessoal, então `INVITED → ACTIVE` sai de
`GET /collaborators/:username` (`204` sim, `404` não) na mesma rodada. Sem isso a
licença aceita ficaria `INVITED` indefinidamente.

**Falha na promoção NÃO rebaixa o estado.** Um `401` não significa "não aceitou",
significa "não deu para saber": a licença continua `INVITED` e a próxima rodada
tenta de novo. Rebaixar para `FAILED` faria a lista de pendências acusar o
comprador por um problema do nosso token. Já na fase de **convite**, a falha vira
`FAILED` com motivo legível — *"reembolsado que continua colaborador"* é a falha
que custa dinheiro, e não pode viver só no log.

**Sem username não é falha.** É pendência humana, contada em campo próprio
(`aguardandoUsername`). Marcar `FAILED` misturaria o silêncio do comprador com
defeito nosso, e a coluna de falhas do admin perderia o significado.

**Uma falha não interrompe a fila.** Cada licença é tratada num `try` próprio; uma
rodada que morresse na primeira falha deixaria todas as seguintes sem convite, e o
sintoma seria *"o job roda e ninguém é convidado"*.

**Sem agendador, e registrado como pendência de infra.** Não há
`@nestjs/schedule` nem `repeat` de BullMQ no repo, e a spec diz "job diário" sem
dizer como dispara — mesmo tratamento do job de `EXPIRED` da SPEC-038. O método é
chamável, testável, e o PR-5 dá o botão ao admin. **Nada de acesso depende de ele
rodar na hora**: atraso adia um convite, não concede nem revoga nada.

**`CryptoService` passou a ser exportado do `identity`.** A alternativa era
duplicar AES-256-GCM no `licensing` — dois lugares para a mesma primitiva, com o
risco de os formatos divergirem em silêncio. Não abre o `identity`: é cifra pura,
sem Prisma e sem estado.

### PR-3 — verificação

**Uma vulnerabilidade real, achada pelo teste que escrevi para procurá-la.** O
`sourceAccessError` é **exibido na tela do admin**, e o código gravava ali a
mensagem de qualquer erro — inclusive a de um `fetch` que arrasta o header
`Authorization`. O teste montou um erro com `Bearer <pat>` no texto e provou o
vazamento: quem abrisse a página de pendências sairia com
`administration:write` no repositório privado.

Agora **só mensagem curada** chega ao banco (construída a partir do *status*,
nunca do corpo ou dos headers); erro desconhecido vira texto fixo apontando para
o log. E o log **redige o `Bearer`** — log não é superfície pública, mas também
não é lugar de segredo. Dois testes ancoram as duas metades.

**Suíte**: regras **1931** (+35), banco 240, tela 579 — **2171 verdes** na API.
Build nos três apps, lint 0 erros (3 warnings pré-existentes).

**Pendente**: o convite real nunca saiu — exige PAT fine-grained configurado, que
é do PR-5. A revogação (`DELETE /invitations/:id` × `DELETE /collaborators/:user`)
é o PR-4.

---

### PR-4 — a revogação, e a chamada que não pode ser a errada

- [x] `GithubSourceClient.cancelInvitation` (`DELETE /invitations/:id`) e
      `.removeCollaborator` (`DELETE /collaborators/:username`)
- [x] `SourceRevokeService.revoke(tenantId, licenseId, motivo)` — escolhe a
      chamada pelo `sourceAccess`, grava `REMOVED`, trilha
      `source_access_removed`
- [x] Ligado no `WebhookProcessorService.revogar` (reembolso e chargeback)
- [x] `FAILED` retentável, com `githubUsername`/`githubInvitationId` preservados
- [x] +43 testes de regra

**A fatia inteira converge para uma escolha, e ela é binária:**

| estado | chamada | por quê |
|---|---|---|
| `INVITED` **com** `githubInvitationId` | `DELETE /repos/:repo/invitations/:id` | o convite existe e não foi aceito; não há assento de colaborador |
| `ACTIVE` (ou `INVITED`/`FAILED` sem id) | `DELETE /repos/:repo/collaborators/:username` | o convite foi aceito; não há mais invitation |

**Chamar a errada é no-op silencioso — nos dois sentidos.**
`DELETE /collaborators` devolve `204` para quem *nunca* foi colaborador, e o
convite pendente continua de pé esperando ser aceito. Nada aparece em log,
ninguém é notificado, e o reembolsado fica com o código-fonte. É por isso que o
`sourceInvited: Boolean` da SPEC-036 morreu no PR-1: ele não sabia distinguir
esses dois estados, e a revogação depende exatamente da diferença. Os dois
caminhos têm testes **separados** (critério de aceite) — um teste que aceitasse
qualquer das duas chamadas passaria com a implementação errada.

**`404` do `cancelInvitation` é sucesso; do `removeCollaborator`, não.** No
convite, `404` significa que ele já não existe (o comprador aceitou entre a nossa
leitura e a chamada, ou alguém cancelou pela interface) — tratar como erro poria a
licença em `FAILED` e faria o admin retentar para sempre uma remoção sem nada para
remover; o caso "aceitou no meio do caminho" volta pela reconciliação, e aí é o
`removeCollaborator` que resolve. Na remoção de colaborador, o `204` já cobre "não
era colaborador", então um `404` só pode ser repositório não encontrado — problema
de PAT ou configuração, e passar isso como sucesso seria o silêncio que custa
dinheiro.

**O fallback é `removeCollaborator`, e a assimetria é deliberada.** Sem
`githubInvitationId` (o `201` do GitHub veio sem `id`, ou a licença veio de
`FAILED`) não há o que cancelar — `cancelInvitation` exige o id. E
`removeCollaborator` é *seguro no estado errado*: devolve `204` para quem não é
colaborador. O inverso não vale, então a ordem só pode ser esta.

**A remoção vem DEPOIS da escrita do `REVOKED`, e há teste de ordem.** O
`status = REVOKED` no banco é o que corta a validação (`/activate`,
`/heartbeat`) — não pode depender de o GitHub responder. Invertida, a ordem faria
uma API fora do ar impedir a revogação da licença; nesta, o pior caso é
`sourceAccess = FAILED` na lista de pendências, com a licença já cortada.

**A reentrega retenta a remoção mesmo com a licença já `REVOKED`.** O caminho
idempotente do `revogar` (que não reescreve data nem manda 2º e-mail) passou a
chamar a revogação de acesso *antes* de sair. A 1ª revogação pode ter gravado
`REVOKED` e falhado no GitHub; sair antes descartaria a reentrega da plataforma —
a chance grátis de consertar — e o reembolsado continuaria colaborador. O service
é idempotente por estado: se o acesso já morreu, devolve `nothing_to_do` sem falar
com o GitHub.

**Falha do GitHub não contamina o carimbo do evento.** A remoção roda dentro de um
`try` no `webhook-processor`: uma exceção subindo faria o evento virar `FAILED`, e
o admin, ao reprocessar, repetiria o e-mail de revogação — pior, um erro do PAT
apareceria como "falha no webhook", mandando investigar a Kiwify. A pendência
pertence à **licença** (`sourceAccess = FAILED` + `sourceAccessError` legível), que
é onde o PR-5 a retenta.

**`FAILED` preserva o que a retentativa precisa.** `githubUsername` e
`githubInvitationId` ficam intactos — sem eles, a retentativa não saberia qual das
duas chamadas fazer, e o `FAILED` seria pendência visível e insolúvel. Pelo mesmo
motivo `FAILED` **não** entra na lista de "nada a fazer": é justamente o estado que
precisa de nova tentativa, e incluí-lo faria a retentativa do admin responder
sucesso sem remover ninguém.

**Ausência de PAT aqui é `FAILED`, não silêncio — ao contrário do job de convite.**
Lá, PAT ausente é pendência de configuração e nada acontece (marcar as licenças
encheria a lista de linhas com uma causa só). Aqui o silêncio custa dinheiro: o
reembolsado continua com acesso e ninguém saberia. Mesmo tratamento para repo
ausente e cifra ilegível.

**`githubInvitationId` é limpo no sucesso; `githubUsername`, não.** O id aponta
para uma invitation que já não existe, e mantê-lo faria uma retentativa futura
cancelar convite inexistente em vez de remover o colaborador de uma recompra. O
username fica: é a trilha de quem teve acesso, e quem o apaga é a exclusão a
pedido (LGPD, §7 do MVP4).

**O que a remoção NÃO entrega, e está no código para nenhuma tela dizer o
contrário:** ela não recupera o que já foi clonado. O que acaba são os *updates* —
o mecanismo real do produto é contratual (§8 do MVP4). Por isso o desfecho
devolvido nomeia a chamada feita (`invitation_canceled` / `collaborator_removed`),
gravado em `payload.via` da trilha, e não um "acesso recuperado" que não existe.

**A leitura de configuração foi duplicada, não extraída.** São três linhas de
consulta compartilhadas com o `SourceInviteService`, e o que um helper economizaria
não paga o acoplamento: os dois tratam a ausência de PAT de formas **opostas**
(pendência lá, `FAILED` aqui), e um helper comum convidaria a unificar isso.

### PR-4 — verificação

- **2793 testes verdes** (1974 regras · 240 banco · 579 tela) — **+43** sobre os
  2750 do PR-3, todos em regras.
- Os dois caminhos de revogação em `describe` **separados**, cada um afirmando que
  a outra chamada **não** aconteceu (`not.toHaveBeenCalled`) — é o que um teste
  frouxo deixaria passar.
- **O PAT não vaza** nem em `sourceAccessError` nem no log: os dois testes do PR-3
  replicados para este caminho (mensagem curada no banco, `Bearer` redigido no
  log).
- Ordem `update → revoke` verificada por array de sequência, não por suposição.
- Arch-specs verdes: o caminho da revogação **não** chama `.installationToken(`
  (ADR-015) — são credenciais de propósitos diferentes, e misturá-las reabriria o
  ADR por acidente.
- `build` nos três apps, `lint` **0 erros** (3 warnings pré-existentes),
  `test:report:check` OK.

**Pendente**: a revogação real nunca rodou contra o GitHub — exige PAT
fine-grained configurado, que é o PR-5, junto da lista de pendências e do botão de
retentar.

---

### PR-5 — o admin, e os três estados que pedem gente

- [x] `SourceAdminService`: `pending`, `setUsername`, `reinvite`, `removeAccess`,
      `settings`, `setPat`, `testConnection`
- [x] 7 rotas no `LicensingAdminController` (`source-pending`,
      `licenses/:id/github-username`, `licenses/:id/source-invite`,
      `licenses/:id/source-access`, `source-settings`, `source-settings/pat`,
      `source-settings/test`)
- [x] `SourceOpsPanel` + `sourceOpsView` na tela de licenças
- [x] +34 testes de regra · +39 de tela

**Os PRs 3 e 4 gravam três estados que não se resolvem sozinhos**, e sem esta tela
os três são informação no banco que ninguém alcança — o mesmo beco que o
`LicensingOpsService` tirou do webhook na SPEC-038. Aqui é mais caro: a edição com
código-fonte é a mais cara do catálogo, e *"comprou e não recebeu"* vira ticket com
o cliente já pago.

| estado | o que houve | o que o admin faz |
|---|---|---|
| `PENDING` sem username, prazo vencido | o comprador não respondeu ao e-mail | grava o username por ele |
| `INVITED` parado | o convite saiu e não foi aceito | nada, a menos que o username esteja errado |
| `FAILED` | o GitHub recusou (PAT expirado, 403, rede) | conserta a causa e reemite |

**`PENDING` no prazo fica FORA da lista, de propósito.** Quem comprou hoje está no
prazo legal de arrependimento — não é pendência, é o processo andando. Incluí-lo
encheria a lista de linhas sem o que fazer, e ela perderia o significado de *"aqui
há trabalho"*.

**Quem classifica o motivo é o servidor, não a tela.** O `reason`
(`awaiting_username` / `invited_not_accepted` / `failed`) vem pronto da API. Uma
tela que o deduzisse do enum duplicaria a regra, e as duas divergiriam na primeira
mudança.

**Trocar o username cancela o acesso anterior — e a ordem importa.** Se a licença
está `INVITED`/`ACTIVE`, o `SourceRevokeService` roda **antes** da gravação. Sem
isso o convite antigo continuaria de pé: o username errado seguiria podendo
aceitar, e o certo nunca receberia convite — os dois erros ao mesmo tempo, nenhum
visível.

**E se a remoção falhar, o username novo NÃO é gravado.** O acesso antigo continua
de pé, e sobrescrever o `githubUsername` perderia a informação de **quem** ainda
tem acesso — é justamente esse campo que a remoção usa. Gravar assim mesmo deixaria
um colaborador no repositório privado sem registro de quem é. O admin vê a falha na
pendência, conserta a causa e repete.

**Reemitir roda a reconciliação do tenant, não uma chamada avulsa.** É o mesmo
caminho do job: mesmas guardas, mesma idempotência, mesma trilha. Duplicar a lógica
de convite aqui criaria um segundo lugar que precisa acertar o estado, e o modo de
errar é o silencioso — dois convites, ou `INVITED` com id nulo. O efeito colateral
é deliberado e **dito na tela**: o toast resume a rodada inteira (*"2 convidado(s) ·
1 falha"*), porque prometer "convite reemitido" esconderia que outras licenças
também foram tocadas.

**`FAILED` volta a `PENDING` antes da rodada.** Sem essa linha o botão rodaria a
reconciliação e a licença em `FAILED` seria ignorada (o job busca `PENDING`) — o
sintoma seria *"cliquei em reemitir e nada aconteceu"*.

**Botão que não faz nada não aparece.** `Reemitir` só em `failed` **com** username
(sem username o servidor recusa com `422`, e um botão que sempre falha ensina a
ignorar erro) e **não** em `invited_not_accepted` (o convite já está de pé; a rodada
não acharia a licença). `Remover acesso` só em `INVITED`/`ACTIVE` — oferecê-lo sem
convite emitido sugeriria que existe acesso, e quem clicasse sairia com a impressão
de ter revogado algo.

**A tela não promete o que a remoção não faz.** O §Objetivo da spec é explícito:
*"painel que sugira 'acesso revogado = código recuperado' mente para o operador"*.
O texto de sucesso nomeia a chamada feita e diz, com estas palavras, que *"o que já
foi clonado continua com ele — o mecanismo é contratual"*. E `outcome: 'failed'`
usa **toast de erro**, dizendo que o acesso **CONTINUA de pé**: é sucesso HTTP com
fracasso real, e um toast verde ali seria o fechamento frágil que este produto
existe para detectar.

**O PAT é cifrado; o `webhookSecret` não é — e não é inconsistência.** O segredo do
webhook é comparado por HMAC a cada entrega, precisa estar legível no caminho da
request. O PAT **concede escrita num repositório privado**: cifrá-lo com o
`TOKEN_ENCRYPTION_KEY` que já existe (decisão PI #2) faz um dump do banco não virar
acesso ao código-fonte.

**"Configurado" não é "funciona", e a tela nunca afirma que está tudo bem.** PAT
fine-grained **expira** — limite do GitHub, não escolha nossa. Uma expiração
silenciosa pararia os convites sem nenhum erro visível: o job roda, falha em cada
licença, e o comprador espera. O par que resolve é *teste de conexão* (antecipa) +
*pendência `FAILED`* (acusa). Por isso o texto do estado configurado aponta para o
teste em vez de dar um "ok" verde.

**O teste pergunta pela PERMISSÃO, não só pela existência do repo.** Um PAT
só-leitura enxerga o repositório e não convida ninguém; sem checar
`permissions.admin`, o teste passaria e o convite falharia — o pior desfecho,
porque o operador teria uma confirmação verde. E ele **nunca lança**: `ok: false`
com motivo legível é o resultado, não uma exceção. Um `500` diria *"o ProPlan
quebrou"* sobre um teste cuja resposta é *"seu token está errado"*.

**~~Salvar o PAT exige a linha de settings já criada.~~ Revertido no FIX #212** —
ver abaixo. O raciocínio (não gravar `webhookSecret: ''`) estava certo; a conclusão
(exigir o webhook antes) estava errada.

### FIX #212 — a guarda que bloqueava o próprio dogfooding

**Achado ao tentar salvar o PAT pela primeira vez**, num tenant com `lic_settings`
vazia: `422 "Configure o segredo do webhook antes do PAT do GitHub"`. Não havia
caminho pela interface para o que a SPEC-039 §Configuração por tenant define como
configurável no admin.

**A guarda foi copiada do `updateSettings` da SPEC-038 sem eu checar se a razão se
aplicava.** Lá ela é correta: gravar *tolerância* sem segredo deixaria a linha
inválida para o webhook. Aqui não — o PAT do source e o segredo da Kiwify são
**configurações independentes**: uma convida ao repositório privado, a outra recebe
vendas. Amarrá-las obriga quem quer só o source a cadastrar um webhook que talvez
nem use.

`LicSettings.webhookSecret` virou `String?` (decisão PI, 2026-07-30) e o `setPat`
faz `upsert` sem tocá-lo.

**A segurança do webhook não mudou, e essa é a parte que importa conferir.**
Ausente continua significando *"não configurou webhook"*, com toda entrega recusada
por `401` no intake — exatamente o desfecho de quando faltava a linha inteira. O
que mudou é só *quando a linha pode nascer*. Duas consequências foram tratadas:

- **A guarda do intake virou `!settings?.webhookSecret`.** Sem essa metade, um
  tenant com linha e sem segredo verificaria a assinatura contra `null`, e o
  desfecho seria decidido dentro do `verifySignature` em vez de por regra
  explícita. Há teste para `null` e para `''`.
- **`updateSettings` segue recusando string vazia.** Opcional no schema ≠ apagável
  pela tela: gravar `''` num tenant que já recebe entregas faria todas passarem a
  falhar, com sintoma indistinguível de ataque.

**O segundo bloqueio veio no mesmo caminho: `sourceRepo` não tinha tela.** A coluna
nasceu no PR-1 desta fatia; o cadastro de produtos é da SPEC-036 e não a conhecia.
Mesmo com o PAT salvo, o teste de conexão responderia *"nenhum produto tem
repositório de código-fonte configurado"* — e o operador descobriria isso só depois
de cadastrar o token.

Agora há `PATCH /products/:id/source-repo` e um campo por produto. **O formato é
validado no servidor** (`owner/name`, recusando URL colada inteira e barra a mais):
um valor torto produziria `404` no momento do convite, que a lista de pendências
mostraria como *"repositório não encontrado"* — mandando o operador procurar
problema de permissão num erro de digitação. **String vazia limpa**, porque
desconfigurar é ação legítima (o produto deixou de vender código-fonte) e não pode
exigir SQL.

**A migration é `DROP NOT NULL`, sem migração de dados** — ampliação de domínio:
toda linha existente continua válida, nenhuma tem `NULL` hoje, e `''` continua
sendo recusado na verificação de assinatura como sempre foi.

**Verificação**: +11 regras · +3 tela (regras 2019 · banco 240 · tela 621 —
**2880 verdes**); `INSERT` sem `webhook_secret` confirmado direto no Postgres (o
CHECK `length(btrim(webhook_secret)) > 0` não barra `NULL`, e eu conferi em vez de
supor); build e lint verdes.

**Validado em produção (2026-07-30)**: PAT salvo, `sourceRepo` gravado e teste de
conexão respondendo *"Conexão OK — o PAT administra RodReis/war-room"*. O par
`checkRepoAccess` + `permissions.admin` fez o que existe para fazer — confirmou o
escopo **antes** de qualquer venda.

### FIX #214 — a terceira coluna sem caminho, e uma tela que se contradizia

**Dois achados do mesmo dogfooding, ambos na tela de licenças.**

**1. `grantsSourceAccess` não tinha caminho — nem API, nem tela.** A coluna nasceu
no PR-1 desta fatia e é *lida* pelo `webhook-processor` para decidir se a compra
agenda o convite. Mas nada a escrevia: `CreateEditionInput` não a aceitava, não
havia rota de update, e o formulário não a mostrava. Uma edição criada pela tela
nascia com `false` e não havia como mudar sem SQL.

**Consequência: não existia caminho para vender código-fonte pela interface.** A
venda chegaria, `grantsSourceAccess` seria `false`, a licença sairia sem
`sourceInviteAt` — e o comprador da edição mais cara do catálogo nunca receberia o
convite, **sem erro em lugar nenhum**.

É a **terceira ocorrência do mesmo padrão** nesta fatia (depois de `sourceRepo` no
#212, e do próprio `githubPat` que o PR-5 expôs): coluna criada no schema,
consumida pelo backend, sem caminho para o operador preencher. O padrão tem uma
causa comum — o PR de schema semeia, e o PR de tela seguinte só cobre o que a spec
listou como contrato, não o que o schema ganhou.

`grantsSourceAccess` **é alterável**, ao contrário de `slug` e `billingModel`:
aqueles viajam no license file já emitido ou mudam o significado de `expiresAt`
numa licença viva; este só decide o que acontece nas compras **futuras**, e licença
já emitida carrega o próprio `sourceInviteAt`.

**Só `true` literal concede.** `'true'`, `1` e `'sim'` são recusados — uma string
`'false'` é truthy em JS, e aceitar coerção faria um formulário mal ligado dar
código-fonte a quem comprou a edição fechada. No update, porém, `false` **explícito
desliga**: confundi-lo com ausente tornaria impossível desmarcar pela tela.

**2. A frase do PAT contradizia o teste de conexão logo abaixo.** Depois de salvar o
repositório e testar com sucesso, a tela mostrava as duas ao mesmo tempo:

> PAT salvo, **mas nenhum produto tem repositório de código-fonte configurado**.
>
> Conexão OK — o PAT administra RodReis/war-room.

`testar()` não chamava `onMudou()`, então `settings.sourceRepo` ficava com o valor
de quando o painel montou (`null`) — o repositório é salvo no bloco de produtos,
que recarrega o catálogo, e os dois painéis não se falavam. **Das duas afirmações
contraditórias, a assustadora era a falsa** — e é assim que uma tela ensina a ser
ignorada.

**Verificação**: +11 regras · +3 tela (regras 2030 · banco 240 · tela 624 —
**2894 verdes**), build e lint verdes, entrega carimbada no histórico (ADR-019).

### PR-5 — verificação

- **2866 testes verdes** (2008 regras · 240 banco · 618 tela) — **+73** sobre os
  2793 do PR-4 (+34 regras, +39 tela).
- **O PAT não vaza em nenhuma superfície**: não sai no `GET` (só `githubPatSet`),
  não vai para o log ao ser salvo, e a mensagem do teste de conexão é **fixa** —
  a de um `fetch` pode arrastar o header `Authorization`, e essa resposta é
  exibida na tela.
- Sintaxe do username validada **antes** da rede, com os mesmos cinco casos de
  path traversal do PR-2 (`../../admin` seria interpolado em `GET /users/:username`).
- Os textos da tela têm teste próprio (`sourceOpsView.test.ts`), incluindo o que a
  spec proíbe afirmar: há teste exigindo que o sucesso da remoção contenha
  *"já foi clonado continua"* e *"contratual"*.
- `build` nos três apps, `lint` **0 erros** (3 warnings pré-existentes),
  `test:report:check` OK.

**Pendente: dogfooding.** Nem convite nem revogação rodaram contra o GitHub real —
agora é possível (o PAT tem onde ser cadastrado), mas exige um PAT fine-grained
emitido pelo PI e um repositório de produto configurado. É o último passo da fatia,
e ele é do PI: o token dá `administration:write` num repositório privado dele.

## Fatia 29 (SPEC-040) — Licensing: painel do tenant, métricas honestas e exclusão a pedido — `código entregue · dogfooding pendente`

Issue **#196** (spec `aprovada-pi` 2026-07-29). **5ª e última fatia do MVP4.**
Licenciamento deixa de ser quatro telas mínimas espalhadas por quatro fatias e
vira **uma área onde o operador resolve o caso de um cliente sem abrir o banco**.

**Quatro PRs empilhados**, todos com base `main`:

1. **PR-1 — busca ampliada e detalhe agregado** (`feito`, PR #219)
2. **PR-2 — estender e excluir a pedido** (`feito`, PR #220)
3. **PR-3 — métricas em contagem** (`feito`, PR #221)
4. **PR-4 — a área em quatro seções** (este)

### PR-1 — a heurística do `@` era o bug

- [x] `GET /licenses?q=&status=` casando cinco colunas
- [x] `GET /licenses/:id` com source, e-mails e trilha na mesma resposta

**Um campo, cinco colunas — e o que existia antes falhava em silêncio.** A tela
decidia entre `?email=` e `?key=` pela presença do arroba. Quem colasse o **nome
do comprador** ou o **`saleRef`** caía no ramo "chave": o hash não casava, e a
resposta era **lista vazia — indistinguível de "esse cliente não existe"**.
Escolher a coluna nunca foi trabalho da tela.

**A chave entra no `OR` por hash exato; as outras quatro, por `contains`.** Hash
não tem prefixo em comum com nada, então `contains` sobre `keyHash` só acharia
por acidente. O hash do termo é somado ao `OR` sempre — uma busca que não seja a
chave produz um hash que não casa com linha nenhuma, ao custo de uma comparação
de índice. **Há teste afirmando que a chave em claro não aparece no `where`**: se
aparecesse, entraria no log de query do Postgres — o mesmo vazamento que a
decisão de não persistir a chave existe para impedir, por um caminho que ninguém
olharia.

**`?status=` inválido é recusado, nunca ignorado.** Ignorar faria uma lista
completa passar por lista filtrada: o operador pediria as revogadas, receberia
todas, e concluiria que não há revogada nenhuma quando só errou o valor.

**O detalhe agregado responde numa tela só.** Antes, *"ele recebeu a chave?"* e
*"ele tem acesso ao código?"* exigiam outras duas telas — e a de pendências de
source só mostra quem está **travado**, então licença saudável não aparecia em
lugar nenhum.

### PR-2 — anonimizar não é deletar

- [x] `POST /licenses/:id/extend` com autor, motivo e **valor anterior**
- [x] `POST /licenses/:id/anonymize` com allowlist no payload
- [x] `LicensePrivacyService` + `domain/anonymize.ts`

**A extensão assume que o webhook vence depois.** `expiresAt` tem uma autoridade
— a plataforma, desde a SPEC-038. Duas autoridades permanentes sobre a mesma
data significam divergência que só aparece quando alguém for cobrado errado. O
que torna a extensão administrável é o aviso na tela e o **valor anterior
gravado no evento**: sem ele a trilha diz que a data mudou e não diz de quê.

**Revogada não é estendida** (o `/activate` responde `410` pelo `status`, não
pela data), e **encurtar é permitido de propósito** — o caso real é desfazer uma
extensão digitada errada, e proibir obrigaria a mexer no banco para consertar um
erro cometido na mesma tela.

**A redação do payload é ALLOWLIST, e é a decisão que mais importa da fatia.**
Uma denylist apagaria os campos pessoais **que conhecemos hoje**. O payload é da
plataforma, não nosso: no dia em que a Kiwify acrescentar `customer_document` —
ou em que o adapter da Hotmart entrar (a coluna `platform` existe para isso) —,
o campo novo **sobreviveria à anonimização em silêncio**. O titular teria pedido
a exclusão, o ProPlan teria respondido que fez, e o CPF continuaria no banco. Há
teste com campo pessoal inventado provando o descarte.

**O preço não está na allowlist, e é deliberado**: é o único dado do payload que
a §Métricas manda não usar para número nenhum.

**O acesso ao repo source NÃO é revogado.** Excluir dado pessoal não desfaz a
compra: quem comprou o código-fonte continua com direito a ele. Amarrar as duas
coisas faria um pedido de LGPD virar cancelamento de um produto pago.

**Tudo numa transação, e o carimbo é a última escrita.** Metade feita é o pior
desfecho — o titular recebe a confirmação e o e-mail dele continua no payload
porque a segunda escrita falhou. E criar o evento junto do `update` exigiria
adivinhar os números antes de executar: diria "3 entregas redigidas" num caso em
que só duas foram.

### PR-3 — métricas honestas

- [x] `licensing-summary.service.ts` — **a promessa do MVP4 §3, cumprida**
- [x] `GET /summary?period=` · `domain/period.ts` próprio · 5 regras na arch-spec

**Receita fica de fora, e a prova é em três camadas**: o tipo não tem campo de
valor, um teste varre a resposta por onze nomes de dinheiro, e a arch-spec varre
o arquivo. Preço vive no `payload`, sem coluna tipada nem moeda normalizada — um
total derivado dali seria plausível e **indefensável**.

**Métrica é contagem sobre coluna tipada.** Vendas/reembolsos/chargebacks saem
de `LicWebhookEvent.eventType`. Duas consequências: **reembolso e chargeback
ficam distintos** (o `LicEvent` grava os dois como `webhook_revoked`, e a
distinção só sobrevive ali), e **a anonimização não mexe em número nenhum** —
`eventType` está na allowlist, o que faz *"as métricas antes e depois são
idênticas"* ser garantia e não coincidência.

**O que erraria em cada número:** licenças por status filtradas por período
diriam "0 revogadas" numa semana sem revogação nova; inadimplente contado pelo
`status` daria zero sempre (atraso não muda status, SPEC-038); assinatura sem o
filtro de `billingModel` incluiria licença perpétua.

**`everSold` viaja fora do recorte de período** — responde *"já houve alguma
vez"*, que nenhuma janela responde. Sem ele a tela mostraria "0 vendas" para
quem nunca vendeu, e o operador leria como **queda**.

**O dia é o de São Paulo, e o `GROUP BY` do Postgres não serve**: um
`date_trunc` cortaria em UTC e uma ativação às 22 h apareceria na barra do dia
seguinte. Testes de virada de mês **e de ano**.

**`period.ts` é cópia, não import.** Importar do `dashboard` criaria a
dependência de módulo-irmão que a **primeira regra da própria arch-spec** existe
para impedir — por 60 linhas sem estado.

**Um erro meu, achado por sabotagem deliberada:** escrevi o teste do período
inválido com `await expect(...).rejects`, mas a rota lança **antes** de devolver
a Promise — o `expect` não observava nada e passaria por qualquer implementação.
Corrigido para a forma síncrona; aproveitei e sabotei a guarda do PR-1 para
confirmar que aquele teste falha quando deve.

### PR-4 — a área, e a regra da spec que não se sustentou

- [x] Quatro seções (Licenças · Métricas · Pendências · Configurações)
- [x] `MetricsPanel` + `licensingMetrics.ts` (funções puras, testadas)
- [x] `LicenseDangerActions` — estender e excluir, com os avisos antes
- [x] Estado vazio que ensina, no lugar de esconder o item do menu

**As telas mínimas foram absorvidas, não reimplementadas.** `WebhookOpsPanel` e
`SourceOpsPanel` já eram componentes independentes: viraram o conteúdo de
*Pendências* sem mudança interna. O cadastro de produtos virou *Configurações*.
Nenhum service novo para o que já existia.

**A chave em claro fica FORA das abas.** Trocar de aba com ela na tela a perderia
para sempre, e ela não tem segunda via.

**O aviso de sobrescrita aparece antes da confirmação** (decisão PI #2), e a
exclusão declara os três efeitos antes do campo: sem e-mail futuro, sem
reemissão de chave, **e o acesso ao código continua**. Confirmação por digitação
do e-mail do titular, que aceita caixa trocada — a confirmação existe para dar
uma pausa, não para testar datilografia.

**Licença já anonimizada não oferece nenhuma das duas ações**: o marcador não é
destinatário de nada, e "excluir de novo" não tem o que excluir.

**O gráfico não mente por compressão.** O servidor não devolve os dias vazios (a
janela `current_month` tem tamanho variável, e só a tela sabe quantas barras
cabem), então a lacuna se preenche na tela — sem isso, três ativações em dias
alternados apareceriam coladas, sugerindo atividade contínua. E a escala é pelo
**maior valor**, não por um teto fixo: um pico de 3 num painel calibrado para 100
pareceria irrelevante, e 3 é a ordem de grandeza do piloto.

**`NONE` não aparece no bloco de source**: é o estado de toda licença que não
vende código-fonte, ou seja, a maioria. Exibi-lo faria o bloco dizer "247 sem
acesso" sobre licenças que nunca deveriam ter acesso nenhum.

#### A regra do "some" caiu, e o motivo é um impasse que a spec não previu

A SPEC-040 §A área pedia que o item **Licenças sumisse do menu** quando o tenant
não tivesse `LicProduct` — precedente do §2.12 da SPEC-035, onde o Dashboard some
sem cliente nenhum.

**Isso deixaria o licenciamento inalcançável em todo tenant novo.** O menu é o
único caminho para a área, e é *dentro* dela que se cadastra o primeiro produto.
Sem produto → item some → não há como cadastrar → nunca haverá produto. O
Dashboard não tem esse problema porque cliente se cria noutra tela.

Cheguei a implementar `GET /licensing/nav` + `hasProducts` para o menu decidir, e
**removi** ao ver o impasse: rota sem consumidor é código morto. Também não serve
pendurar a entrada na `/settings` — ela é global, sem tenant.

**Decisão do PI (2026-07-30): item sempre visível, área vazia ensina.** Sem
produto, a área explica o que é licenciamento, oferece o cadastro e — na última
linha — **diz para ignorar quem não vende software**. É essa frase que faz o
trabalho que a regra original queria: o ruído passa a custar uma visita, não um
item permanente no menu.

#### Dois defeitos meus, achados por teste

1. **Botão ambíguo**: o que *abre* o formulário de extensão e o que *confirma*
   tinham o mesmo nome. O teste falhou com *"Found multiple elements with the
   role button and name Estender validade"* — que é exatamente o que um leitor
   de tela encontraria. Virou *"Confirmar extensão"*.
2. **Recarga pela metade**: `abrirGaveta` e `desativarMaquina` duplicavam a
   leitura de detalhe + trilha. Extraí `recarregarGaveta` porque **toda** ação da
   gaveta precisa das duas — recarregar só uma deixaria a tela metade velha, e a
   metade velha é a que o operador lê como "não funcionou".

### O que a Fatia 29 NÃO entrega

**O dogfooding do painel com dado real.** As métricas foram testadas com dobras;
nenhuma contagem rodou contra um banco com vendas de verdade — que dependem do
mesmo webhook da Kiwify que a Fatia 28 ainda espera. **A exclusão a pedido nunca
rodou em produção**, e não deve rodar como teste: ela é irreversível por
construção.

**Receita, ticket médio e qualquer valor em moeda** ficam fora por decisão
(§Fora de escopo). O caminho de volta está registrado: emenda datada na SPEC-038
extraindo valor e moeda para coluna tipada **no recebimento** — nunca lendo o
payload na hora de renderizar.

**Revisão jurídica dos termos** continua pendente (ressalva do MVP4 §7): esta
fatia entrega o **mecanismo** de exclusão a pedido; se o texto dos termos e a
política de retenção estão corretos é parecer de advogado, não critério de
aceite de software.

## Fatia 30 (SPEC-041) — Licensing: releases autorizadas por licença — `entregue`

Issue **#203** (spec `aprovada-pi` 2026-07-29, **emendada em 2026-07-30**). **6ª
fatia do MVP4** e a peça que falta para o `war-room update` do piloto: a máquina
licenciada descobre e baixa a versão a que **tem direito**, sem link manual e sem
um byte do instalador atravessar a API.

**A fatia nasceu bloqueada e foi destravada pelo PI antes do 1º PR.** A versão
original pedia **exceção estreita ao ADR-015** para ler o asset com *installation
token*. A emenda de 2026-07-30 retirou a exceção: a credencial já existe —
`LicSettings.githubPat` (SPEC-039), por tenant, cifrada, apontando para o mesmo
repo. Com isso **some o Risco #1 original** (se o installation token alcança asset
de release privada) e o ADR-028 fica com **uma** decisão, não duas.

**Quatro PRs empilhados**, todos com base `main`:

1. **PR-1 — ADR-028, modelo e os dois escopos do PAT**
2. **PR-2 — `releases/check`**
3. **PR-4 — tela do admin** (feito antes do PR-3, ver abaixo)
4. **PR-3 — `releases/download`** (este, o último)

### PR-1 — o ponteiro, e o escopo que falharia calado

- [x] **ADR-028** — artefato de release fora do Postgres. **Não emenda o ADR-025:
      é o gatilho dele disparando**, no cenário que ele mesmo pré-escreveu
      (*"disparado o gatilho, nasce ADR novo escolhendo object storage"*). Um
      instalador de ~80 MB aciona **dois** gatilhos ao mesmo tempo: *arquivo acima
      de 10 MB* e *segundo caso de uso de binário*.

      O que separa este caso do ADR-025 é o **dono do arquivo**. Lá o binário é
      dado de cliente, nasce de upload e não existe em outro lugar — o critério
      foi isolamento. Aqui é **produto do próprio vendedor**, que já vive num
      repositório privado que ele administra, e o ProPlan nunca chega a possuí-lo.
      Guardá-lo em `bytea` seria pagar dump e memória por uma cópia de um arquivo
      que já está hospedado de graça. **O ADR-025 não é tocado**: anexo de briefing
      continua em `bytea` com teto de 10 MB.

- [x] **`LicRelease` / `lic_releases`** — ponteiro, não arquivo: `assetId`,
      `sha256`, `version`, `os`, `releasedAt`, `published`.

      **Raiz de tenancy, ao contrário de `LicEdition`.** A edição corta por JOIN
      no produto porque nada a busca direto; esta é procurada pelo caminho
      **público** (`check`/`download`) via `(licença → produto, versão)`, sem
      nenhum id de linha vindo do cliente. Um `where` esquecido ali serviria
      release de outro tenant — a policy de linha fecha isso sem depender de eu
      lembrar.

      **`releasedAt` é informado pelo admin, não `now()`**: registrar uma release
      antiga com a data de hoje a tornaria indevidamente autorizada para quem já
      tem a janela vencida — o oposto exato da promessa da licença perpétua.

      **`@@unique([productId, version, os])`** — sem ele, `1.2.0/win-x64`
      registrado duas vezes daria duas respostas possíveis ao `check`, e a
      escolhida seria a que o banco devolvesse primeiro.

      **CHECK de `sha256` no banco** (64 hex): o hash é conferido pela máquina do
      cliente **depois** de baixar. Um valor malformado só falharia lá, após 80 MB
      transferidos, e o operador leria como *"download corrompido"*.

- [x] **Teste de conexão do admin valida os DOIS escopos** —
      `administration:write` (convite, SPEC-039) **e** `contents:read` (download do
      asset, esta fatia). Mesmo token, mesmo repo, capacidades independentes na
      configuração do PAT.

      **É o item mais importante do PR, e o motivo é o modo de errar.** O convite
      que falha produz pendência `FAILED` visível no admin. O download que falha
      **não produz nada**: a máquina do cliente para de receber update, não há
      venda travada, não há erro, ninguém no admin fica sabendo. Descobre-se pela
      *ausência* de reclamação. Um `false` no teste de conexão é barato; esse
      silêncio é caro.

      Objeção que considerei e descartei: `admin: true` quase sempre implica
      `pull: true`, então o check pareceria redundante. Mas o que se testa aqui
      não é a álgebra das permissões do GitHub — é o que a **resposta afirma**. A
      redundância custa uma linha; a suposição custa o silêncio acima. O motivo
      nomeia **qual** escopo falta, senão o operador reemite o token com o mesmo
      erro.

- [x] **`docs/DEPLOY.md` §3.7 — rotação do PAT.** A spec dizia *"a rotação do PAT
      no `docs/DEPLOY.md` (SPEC-039) ganha a menção ao novo escopo"*, mas **essa
      seção não existia**: a SPEC-039 documentou o PAT no `DEVELOPMENT.md`, não no
      runbook. Criada agora, com a tabela dos dois escopos e a ordem da rotação —
      **gravar o novo antes de revogar o antigo**, porque o inverso abre uma janela
      em que convite e download falham juntos.

- [x] `build`, `lint` e suíte verdes; `reports/TESTS.md` regenerado (ADR-019)

### PR-2 — a promessa da licença perpétua vira código

- [x] **`resolve_license` passa a devolver `product_id`.** A licença conhece a
      edição, a edição conhece o produto, e `lic_releases` pendura no produto —
      sem essa coluna a rota não tem por onde começar a busca.

      **Segunda consulta não era alternativa**: o `check` roda **sem sessão**, e
      ler `lic_editions` fora de contexto devolve vazio (RLS fail-closed). O
      sintoma seria a rota respondendo *"nenhuma atualização"* para toda licença
      válida — a máquina do cliente nunca mais recebe update e nada aparece em
      log. É o irmão exato do defeito que a SPEC-038 (PR-4) fechou com
      `past_due_at`.

      A saída continua **estreita**: `product_id` é atributo da *licença*, não do
      comprador. Nada de e-mail, nome ou `saleRef` — a função roda com privilégio
      de owner numa rota pública, e é a estreiteza que mantém isso defensável.

- [x] **`latestAuthorized` / `latestOverall`** — a autorização em função pura.

      **O `updatesUntil` é o DA LICENÇA, nunca o da edição**, e o motivo é
      comercial: `LicEdition.updatesMonths` é a política *vigente* do catálogo e
      ela muda; `License.updatesUntil` é o que **aquele comprador** levou,
      copiado na emissão. Ler a política da edição faria uma mudança de preço de
      hoje **encurtar a janela de quem comprou ano passado** — e ninguém
      perceberia até um cliente reclamar que perdeu acesso a um update que já
      tinha. A função **nem recebe a edição**: o parâmetro que não existe não
      pode ser lido por engano.

      **`>=`, não `>`**: release publicada no instante exato do vencimento está
      autorizada. O contrário puniria o cliente por um empate de timestamp.

      **Janela vencida devolve a última autorizada, não `null`** — é o critério
      que prova a promessa da licença perpétua, e é por isso que o artefato nunca
      é apagado (decisão 3 do PI). Devolver a corrente daria de graça o que não
      foi comprado; devolver `null` tiraria o que já era dele.

- [x] **`LicenseReleaseService.check`** — não escreve nada: nenhum `lastSeenAt`,
      nenhum `LicEvent`. Perguntar se há atualização **não é sinal de vida** (o
      heartbeat governa isso) e **não é download** (o `LicEvent` de auditoria
      nasce no PR-3). Registrar aqui encheria a trilha de "perguntou" e afogaria
      os "baixou", que são os que respondem *quem levou o quê*.

      **`published` é filtrado na consulta, não na decisão**: uma release
      retirada por defeito não pode virar resposta nem sequer como
      `last-authorized`.

      **`reason: current | last-authorized`** existe para o cliente oferecer
      renovação sem mentir — sem ele, *"você está atualizado"* sairia para quem
      na verdade parou de receber versões.

- [x] **O gate de status é o mesmo do `/heartbeat`, não uma cópia.** Nasceu o
      `licencaParaUpdate` no `LicenseActivationService`, que reusa o
      `licencaUtilizavel` (404/410) e a checagem de fingerprint ativo (409).
      Recriar o gate no serviço de releases seria a cópia divergente que o
      próprio comentário do `licencaUtilizavel` alerta — e aqui a divergência
      teria efeito comercial: **uma rota servindo update para licença revogada é
      o reembolsado continuando a receber versões novas**.

- [x] **Bug meu, achado antes de escrever a rota:** o `enforce` do controller lia
      só `body.key`, e o contrato destas rotas é **`licenseKey`** (assim o
      `war-room update` foi especificado). A rota nasceria com **metade da
      tranca** — o limite por IP valeria, o por chave não —, e a falha seria
      muda: nada em log, e a varredura de chaves a partir de IPs variados
      passaria pela porta que o teto de 5/min existe para fechar. Passou a ler
      `key` **ou** `licenseKey`, com teste provando que a janela por chave é
      **compartilhada com o `/activate`** (alternar entre rotas não dobra a cota
      de quem está varrendo).

- [x] **Int-spec contra Postgres real** (8 casos) — porque três coisas desta rota
      só existem no banco e um mock afirmaria cada uma sem provar nenhuma: o
      `product_id` vindo da função `SECURITY DEFINER`, o `GRANT EXECUTE` que o
      `DROP` da migration leva junto, e a busca sob RLS. Inclui o caso do
      **isolamento**: a release de outro tenant nunca aparece.

      **Erro meu que o banco pegou**: escrevi o teste de revogação com `UPDATE
      status = 'REVOKED'` sem `revoked_at`, e o CHECK `licenses_revoked_coherent`
      recusou. A guarda estava certa — é a mesma classe do FIX #216.

- [x] `build`, `lint` e suíte verdes; `reports/TESTS.md` carimbado

### PR-4 — a tela que registra o ponteiro

Feito **antes do PR-3**, e de propósito: a tela não depende do PAT, então adianta
a fatia enquanto a validação do Risco #1 espera o PI.

- [x] **`ReleaseAdminService`** — `GET/POST releases`, `POST releases/:id/unpublish`
      e `.../publish`.

      **Toda validação acontece no servidor, antes do banco** — e não porque os
      CHECKs do PR-1 não bastem: eles são a última linha. O ponto é o *desfecho*.
      Uma violação de CHECK sobe como `23514` e vira **`500` na tela**, dizendo
      *"o ProPlan quebrou"* sobre um erro que é *"você digitou o hash errado"*.
      Foi exatamente o FIX #216.

      **`releasedAt` é obrigatório e informado** — nunca `now()` por omissão.
      Registrar uma release antiga com a data de hoje a tornaria indevidamente
      autorizada para quem já tem a janela vencida.

      **Versão duplicada é recusada nomeando qual**: o `@@unique` recusaria de
      todo modo, mas com `P2002` — erro genérico na tela. Nomear é o que permite
      ao operador entender que já registrou aquela versão.

      **`publish` existe além do `unpublish`.** Despublicar por engano é o erro
      provável de um botão ao lado da lista, e sem volta o operador teria de
      registrar a mesma versão de novo — que o `@@unique` recusa.

- [x] **`ReleasesPanel`** na aba **Configurações**.

      **Decisão de escopo que a spec não resolve**: o §Escopo item 2 diz *"tela no
      admin"* sem nomear a seção. Escolhi Configurações, junto de produtos e
      edições, porque release **pendura no produto** e separá-los obrigaria a ir e
      voltar entre abas para registrar uma versão do produto recém-criado. Uma 5ª
      aba seria escopo que ninguém aprovou. **Ressalva registrada**: Configurações
      é descrita na F29 como *"o que se cadastra uma vez na vida"*, e release é o
      oposto — entra a cada versão. Se a frequência de publicação crescer, é a aba
      própria que se justifica.

      **A lista vazia explica a consequência**, não diz só "vazio": sem release
      registrada o `update` responde *"não há atualização"* **mesmo havendo
      release no GitHub**. É o estado que parece funcionar e não funciona.

      **"Despublicada" nunca é escrita como "removida"**, e há teste afirmando
      isso. A linha continua, o artefato segue no GitHub, e o que mudou é que ela
      sumiu do `check` e do `download` — chamar de remoção seria a mesma classe de
      mentira que o painel de source é proibido de contar sobre o clone que
      permanece.

      **O `sha256` é validado na tela e no servidor**, e o aviso aparece enquanto
      se digita. Hash torto aceito pelos dois lados só apareceria na máquina do
      cliente, depois de 80 MB baixados, como *"download corrompido"* — mandando o
      operador caçar problema de rede num erro de digitação.

      **O hash completo vai no `title`** apesar de abreviado na lista: conferir
      hash é comparar caractere a caractere, e uma tela que só mostra 12 deles
      torna a conferência impossível.

- [x] **`TENANT_SCOPED_PREFIXES`**: nenhuma linha nova foi necessária — o prefixo
      `'/licensing/'` da SPEC-036 já cobre as rotas de release. **Mas é
      exatamente esse tipo de presunção que produziu o FIX #166**, então entrou
      teste afirmando a cobertura das três rotas novas em vez de supô-la.

- [x] `build`, `lint` e suíte verdes; `reports/TESTS.md` carimbado

### PR-3 — a URL que o ProPlan cunha sem tocar nos bytes

**Destravado pelo PI em 2026-07-30, e o motivo é que o Risco #1 mudou de
natureza.** O bloqueio escrito no PR-1 (*"não escrever antes da validação"*)
protegia contra uma pergunta de **arquitetura**: se o installation token não
alcançasse asset privado, o plano B era decisão do PI e a fatia mudaria de forma.
Com o PAT da SPEC-039 essa pergunta não se coloca — o que resta é uma pergunta de
**configuração** (*o token tem `contents:read`?*), e ela já tem desfecho definido
em critério de aceite: erro explícito e pendência no admin. A fatia não muda de
forma por causa da resposta, então esperar por ela só segurava a entrega.

- [x] **`GithubSourceClient.assetDownloadUrl`** — `redirect: 'manual'` é a linha
      que faz a fatia inteira valer.

      Com o `follow` padrão do `fetch`, o Node seguiria o `302` e baixaria os
      ~80 MB **para dentro da API** — e o critério *"nenhum byte do artefato passa
      pela API"* deixaria de valer **sem nada quebrar**: a rota continuaria
      respondendo, só que gorda. É por isso que a asserção do `init.redirect`
      existe como teste próprio, e não como detalhe de outro caso.

      `Accept: application/octet-stream` é o par obrigatório: sem ele a API
      devolve o JSON de metadados, não o redirect, e o método entregaria a
      descrição do arquivo achando que é o arquivo.

      **Tabela de motivos separada da do convite** (`motivoAsset`). O mesmo `403`
      significa coisas diferentes nos dois caminhos: lá é administração, aqui é
      `contents:read`. Reaproveitar a mensagem mandaria o operador reemitir o
      token com a permissão errada — e o sintoma (update que não chega) é mudo,
      então ele não descobriria pelo uso.

- [x] **`LicenseReleaseService.download`** — reautoriza, nunca confia no `check`.

      **A versão vem do corpo, e quem manda o corpo é um binário na máquina de
      outra pessoa.** Nada o obriga a devolver a versão que o `check` respondeu;
      confiar nisso deixaria qualquer um baixar o que a janela não cobre trocando
      um campo. A autorização é refeita do zero, com a mesma comparação (`>=`
      contra o `updatesUntil` **da licença**).

      **Despublicada responde `404`, não `403`**: quem despublicou por defeito não
      deve informar a quem pergunta que a versão existe.

      **O repo vem do produto DA RELEASE**, não do primeiro produto do tenant com
      `sourceRepo`. O caminho do convite (SPEC-039) resolve por tenant porque o
      piloto tem um produto só; aqui existe `productId` na mão, e usar o do
      tenant baixaria o asset do repo errado no dia em que houver dois — com o PAT
      alcançando os dois, sem erro nenhum.

      **Nada de configuração vira `500`, e nada do GitHub vira status nosso.** PAT
      ausente, ilegível ou sem escopo respondem `503` com motivo legível. Traduzir
      o `404` do GitHub (asset fora do alcance do token) num `404` nosso diria ao
      comprador *"essa release não existe"* sobre uma que existe e está registrada
      — ele reportaria versão inexistente enquanto o defeito é o escopo do token.

- [x] **`LicEvent` depois da URL cunhada, e só no caminho autorizado.** Registrar
      antes marcaria como baixado o download que o GitHub recusou, e a trilha
      passaria a mentir exatamente sobre a pergunta que existe para responder
      (*quem levou o quê*). **A URL não entra no payload**: ela morre em segundos
      e guardá-la encheria a trilha de segredo de vida curta.

- [x] **Bug meu, e foi o Postgres que pegou:** escrevi a leitura do PAT **fora**
      do `runInTenantContext`. `lic_settings` tem RLS, a rota é pública e sem
      sessão, então o `findUnique` devolve `null` **sem erro** (fail-closed). O
      sintoma em produção seria todo download respondendo *"o servidor não tem
      acesso ao repositório"* **com o PAT gravado e correto** — e o operador
      conferindo repetidamente uma configuração que está certa. O mock unitário
      passou (o `runInTenantContext` dobrado é passthrough); só o banco real
      reprovou. É a mesma classe do defeito que o `check` já tratava na busca de
      releases, e a razão de o int-spec existir.

- [x] **Int-spec estendido (20 casos)** — o `download` toca **duas tabelas a mais
      sob RLS** que nenhum mock prova: `lic_settings` (o PAT) e `lic_events` (a
      trilha). Cobre os dois critérios de aceite da emenda: **tenant B não baixa
      com o PAT do tenant A** (cada tenant semeado com seu PAT cifrado pelo
      `CryptoService` real, e o cliente do GitHub registra com qual credencial foi
      chamado) e **dois `download` seguidos devolvem URLs diferentes**.

- [x] **Falha herdada consertada:** a suíte **já estava vermelha na `main`** — o
      PR-4 acrescentou `ReleaseAdminService` ao construtor do
      `LicensingAdminController` e não atualizou o `.spec.ts`, que parou de
      compilar. Uma linha; sem ela nenhum PR desta fatia passaria no CI.

- [x] `build`, `lint` e suíte verdes (2426 API + 677 web); `reports/TESTS.md`
      carimbado

### Dogfooding (2026-07-31) — o Risco #1 morreu contra a rede real

O PI ampliou o PAT para `contents:read` no mesmo repo e criou a Release. Com
isso, a fatia foi exercitada **pela rota pública, contra o GitHub real, sem nada
dobrado**.

- [x] **Teste de conexão do admin verde** — é ele que fecha o Risco #1: confirma
      os **dois** escopos no mesmo PAT fine-grained. Era a pergunta que segurou o
      PR-3 desde o PR-1, e a resposta é sim.

- [x] **Release `v1.0.0`** em `RodReis/war-room` com o instalador real
      (`war-room-setup-1.0.0-win-x64.exe`, 35 MB, `assetId 496635571`), **a custo
      zero**: release asset é grátis e ilimitado em repo privado, e **não passa
      por Packages nem Git LFS** — o que cobraria seria `git add` no binário, que
      é exatamente o que o ADR-028 evita.

- [x] **`activate → check → download → GET url`**: 35.498.457 bytes baixados,
      **SHA256 idêntico ao registrado**. Os 35 MB vieram de
      `release-assets.githubusercontent.com` — *"nenhum byte pela API"* verificado
      no tráfego, não afirmado.

- [x] **Os nove critérios de aceite, um a um**: `403` para versão fora da janela ·
      `409` para fingerprint inativo · `404` para chave, versão e plataforma
      inexistentes · `429` por chave · URLs diferentes a cada chamada ·
      despublicada some das duas rotas · `LicEvent` por download.

- [x] **O rate limit apareceu sem ser chamado.** Três casos negativos voltaram
      `429` em vez do código esperado, porque eu tinha gasto a cota de **5/min por
      chave** com os downloads anteriores — e a janela é **compartilhada entre as
      quatro rotas**. É o defeito que o PR-2 corrigiu (o `enforce` lia só `key`,
      não `licenseKey`) confirmado no tráfego: alternar entre `check` e `download`
      não dobra a cota de quem varre chaves. Esperada a janela, os três
      responderam certo.

- [x] **A trilha confirmou o desenho**: `check` chamado 3× gravou **zero linhas**,
      a URL **não** entra no payload, e a recusa por `403` **não** gerou evento — a
      contagem seguiu em 2 depois do teste da janela vencida.

### O que o dogfooding encontrou — `[FIX] #228`

A tela registrou `30/07/2026`; o banco gravou **`2026-07-31`**. O
`<input type="date">` devolve `YYYY-MM-DD` sem fuso, e a conversão para `Date` o
lê como meia-noite UTC — num servidor em UTC−3, o dia anda.

**Não é cosmético.** `releasedAt` é o lado direito de
`updatesUntil >= releasedAt`: um dia a mais pode deixar **fora da janela** quem
tinha direito à versão. O PR-1 se preocupou com o lado de conceder demais
(*"registrar release antiga com a data de hoje a tornaria indevidamente
autorizada"*); este bug **nega de menos**, que é o lado que gera reclamação de
cliente pagante. E **a tela mostra a data certa** — quem confere pela interface
não vê discrepância; o erro só aparece no banco ou na reclamação.

Comportamento correto já documentado (SPEC-041 §Contratos + os dois trechos do
`releasedAt` acima), então é `[FIX]` com issue própria, não fatia.

## `[FIX] #230` — o menu perdia o Dashboard, e o login não caía nele

Dois sintomas relatados pelo PI no dogfooding de 2026-07-31, entregues juntos
porque a causa do primeiro é pré-requisito do segundo.

### O item sumia porque a tela global não tinha tenant

Clicar em **ProPlan** (Catálogo) fazia o **Dashboard** desaparecer do menu;
voltar para Clientes ou Licenças o trazia de volta.

O menu não tinha defeito nenhum. O item só renderiza com `hasClients`, que vem
de `getDashboard()` — e essa chamada é escopada por tenant em
`withTenantPrefix()`. Quem fixa o `activeTenant` é o `ClientsRoute` (ou o
`ResolveRoute`), e as telas **globais** — Catálogo e Configuração — desenham o
menu pelo `AppShell`, que **não passa por nenhum dos dois**. Sem tenant ativo,
`/dashboard` sai sem o prefixo `/t/:tenant`, a API devolve **404**, e o `catch`
do `useDashboardNav` mantém `hasClients` em `false`.

**É a terceira ocorrência da mesma armadilha** — a segunda está anotada dentro
do próprio `api.ts` (FIX #166, `/artifacts/` na SPEC-032). A falha é sempre
muda: nada quebra, a tela só mostra menos. E nenhum teste pega, porque todos
mockam a camada de API, que é justamente onde `withTenantPrefix` vive.

O que torna **esta** ocorrência pior que as anteriores é o disfarce: sumir é um
estado **previsto**. A SPEC-035 §2.12 manda o item sumir quando o tenant não tem
cliente nenhum — *"uma tela de retomada sem nada a retomar não é informação, é
ruído no menu"*. Um bug cujo sintoma é indistinguível de uma regra escrita não
se denuncia; ele passa por comportamento correto até alguém reparar que o item
volta ao mudar de tela.

**Correção:** o `AppShell` fixa o tenant da sessão enquanto está montado e o
solta ao desmontar — a mesma disciplina do `ClientsRoute`, pelo mesmo motivo
(tenant fixo depois de sair faria uma chamada global seguinte sair escopada por
engano).

### O destino do login não estava escrito, então foi ao PI

O segundo pedido — *"ao fazer login, exibir o Dashboard"* — **não tinha
comportamento correto documentado**. A SPEC-035 define quando o Dashboard
existe, não para onde o login vai. Pelo CLAUDE.md isso é decisão de produto, e
foi ao PI antes de qualquer linha de código.

**Decisão do PI (2026-07-31): opção A** — Dashboard, **mas só quando o tenant
tem cliente**; sem cliente, Catálogo. Mandar todo mundo ao dashboard
contradiria a §2.12: a pessoa cairia numa tela que o próprio menu esconde.

A rota `/entrar` existe para isso e nada mais — pergunta ao servidor, escolhe o
destino e sai de cena. **Não** é um redirect dentro do Catálogo: mandar para o
dashboard todo mundo que abre `/` tornaria o Catálogo inalcançável pelo menu.
Falha na chamada, ou tenant sem cliente, cai no Catálogo — que funciona em
qualquer estado, inclusive com o GitHub desconectado.

### O callback do GitHub serve a dois fluxos, e só um é login

`github/callback` é a volta do **login** e também a volta da **conexão** do
GitHub numa sessão que já existia (SPEC-025). Apontar os dois para `/entrar`
teria criado um bug novo no lugar do corrigido: quem saiu do Catálogo para
conectar espera **voltar para lá**, não ser despejado no dashboard no meio do
fluxo. Só quem chega **sem sessão** está entrando — `userId ? '/' : '/entrar'`.

O `frontendUrl()` normaliza a barra final do `FRONTEND_URL`: com ela, o destino
sairia `//entrar`, que não casa com rota nenhuma do React Router — o login
morreria numa tela em branco por causa de uma barra numa variável de ambiente.

### Verificação

- [x] **API 2430/2430**, **web 689/689**, `build` e `lint` verdes (0 erros).
- [x] **+18 testes**: 6 na API (destino por fluxo, incluindo a barra final) e 12
      na web — `EntryRoute` (com cliente → dashboard; sem cliente e falha →
      catálogo; tenant fixado antes da chamada e solto depois) e `AppShell`
      (item aparece no Catálogo; **continua sumindo sem cliente**, provando que
      a regra da §2.12 não foi afrouxada junto).
- [x] O teste do `AppShell` fixa o **contrato do bug**: sem tenant ativo, nada
      de chamada; com tenant, o item aparece. É a guarda que faltava nas duas
      ocorrências anteriores da mesma armadilha.
