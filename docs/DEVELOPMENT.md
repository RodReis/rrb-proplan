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

## Fatia 7.5 — Consumo de IA: tokens, custo e teto (SPEC-009, `aprovada-pi`) — `feito` (aguardando aceite runtime do PI)

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

## Fatia 6.1 — Aba Deploy: documento primeiro (SPEC-012, `aprovada-pi`) — `feito` (mergeado PR #38/merge #39; aguardando aceite runtime do PI)

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

## Fatia 13 — Drift de deploy: confronto de fontes (SPEC-013 v2.1, `aprovada-pi`) — `feito` (mergeado PR #40; validado ao vivo; aguardando aceite do PI)

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

**Validação runtime (OK, 2026-07-15):** handoff exportado ao vivo de `RodReis/rrb-escola` (repo gerenciado real, caso deploy `discordam`). Bloco "Projeto + objetivo" recusou honesto ("não sei — ausente/defasado · falta: documento de project", confiança 0%), demais blocos com valor + `inferencia` + confiança + a conta. **Baixar HANDOFF.md** OK (blob local). **Commitar em .proplan/** OK — commit `ccc4db2` `proplan: atualiza HANDOFF.md`, autor `rrb-proplan[bot]`, Verified, em `.proplan/HANDOFF.md` (nunca `docs/`), prefixo `proplan:` (ADR-015 + guarda de path confirmados ao vivo). Aguardando aceite formal do PI (fecha #51 + `proplan:finalizado`).

## Fatia 13.6 — Probe HTTP de URL declarada: o confronto com o mundo (SPEC-013.6, `aprovada-pi`) — `feito` (mergeado PR #43; review de segurança 0 CRITICAL/HIGH; validado ao vivo; aguardando aceite do PI)

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

## Fatia 8 — Multi-tenant — `sem-spec`

Condicionada à decisão do PI de produtizar. Não iniciar.
