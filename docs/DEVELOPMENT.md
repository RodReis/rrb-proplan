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

## Fatia 7 — Insight semântico (SPEC-007, `aprovada-pi`) — `feito` (aguardando aceite runtime do PI)

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

## Fatia 7.5 — Consumo de IA: tokens, custo e teto (SPEC-009, `aprovada-pi`) — `a-fazer` `[paralelo]`

**Última fatia do MVP1.** Sem dependência de nenhuma outra — toca só `insight` e `settings`. Marcada `[paralelo]`: pode ser puxada para frente a qualquer momento. **Antecipe se a conta de IA assustar durante a Fatia 7**, que é a que mais chama o provedor.

**O erro que ela corrige** (ADR-016): a tabela `insights` de hoje **não é** um registro de gasto. Ela é cache de artefato chaveado por `docs_tree_sha` — logo, não vê chamadas que falharam, não vê o retry de JSON inválido, não vê proposta de bootstrap descartada, e perde o gasto antigo quando o artefato é regenerado. Somar `insights.inputTokens` produz uma conta que **sempre subestima**.

1. `a-fazer` — Prisma: `LlmUsage` (append-only: sem `@updatedAt`, sem cascade delete — o gasto sobrevive ao projeto) + `ModelPrice` (seed dos modelos em uso) + `Settings.llmAlertUsdMonthly`/`llmHardCapUsdMonthly`; migration.
2. `a-fazer` — `LlmClient` (ADR-008) passa a devolver o **uso bruto** (incl. `cache_creation_input_tokens` / `cache_read_input_tokens`); `LlmUsageRecorder` no `insight/application` grava a linha. Adapters HTTP **não** conhecem preço nem banco.
3. `a-fazer` — Custo em `Decimal` (nunca `Float`), calculado na chamada e **congelado** na linha junto do `priceSnapshot`. Modelo sem preço → chamada acontece, `costUsd = null`, `priceMissing = true`. **Teste-chave**: mudar o preço em Configurações **não altera** custo já registrado.
4. `a-fazer` — Gate do **teto rígido** no ponto de **enfileiramento** (listener de `DocsSynced` + endpoints de regenerar/bootstrap) — barrar antes de gastar, não dentro do client. Sem "forçar mesmo assim".
5. `a-fazer` — Falha ao gravar o ledger é **logada, não propagada** (perder linha de contabilidade é ruim; derrubar o resumo do usuário é pior). Linha é gravada **também em erro** (`status: error`, tokens que o provedor devolveu, ou `0` em timeout puro).
6. `a-fazer` — Web: tela Configurações → **Uso de IA** (mês corrente, barra até alerta/teto, quebra por projeto/tipo/modelo, **taxa de desperdício**, histórico 6 meses, aviso de preço ausente).
7. `a-fazer` — Critérios da SPEC-009 (incl. retry gerando **duas** linhas e regeneração **somando**, não substituindo); atualizar este arquivo + STATUS.md; commitar tudo.

## Fatia 8 — Multi-tenant — `sem-spec`

Condicionada à decisão do PI de produtizar. Não iniciar.
