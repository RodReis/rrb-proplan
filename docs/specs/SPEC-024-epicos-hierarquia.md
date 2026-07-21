---
proplan: v1
spec: SPEC-024
fatia: 18
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-20
---
# SPEC-024 — Épicos: hierarquia MVP → fatia no board (Fatia 18)

> Promove o item de backlog "sub-issues" (era a **Fatia 12**, prio baixa, sem spec — ver `STATUS.md` linha de-para). Dá ao board uma segunda granularidade — o **épico (MVP)** que agrupa fatias — lendo a relação pai/filho **nativa do GitHub**, sem impor convenção nova ao repo (ADR-014). **`aprovada-pi` 2026-07-20 — a pergunta aberta bloqueante foi resolvida (API de sub-issues confirmada GA; ver Perguntas abertas).**

## Objetivo

O board passa a **exibir e agrupar** fatias sob o épico (MVP) a que pertencem, lendo a relação pai/filho de **GitHub sub-issues** — sem que a fatia deixe de ser a unidade que anda pelas colunas.

## Contexto herdado (já decidido)

- **ADR-011**: o estado do trabalho vive nas Issues; `closes #N` é proibido; fechar é ato do dono. Épico e fatia são Issues — o épico é o **container**, a fatia é a unidade de fluxo. Isto **não muda**.
- **ADR-014**: o ProPlan se adapta ao repo, nunca o contrário. Sub-issue é estrutura **nativa** do GitHub — o ProPlan **lê**, não inventa. Repo sem sub-issues → board se comporta exatamente como hoje (fatias planas).
- **ADR-015**: leitura com **user-to-server token** (respeita visibilidade do usuário). A query de hierarquia usa o mesmo token de leitura.
- **ADR-020 / SPEC-022**: sync roda sob **contexto multi-tenant + RLS**. O novo campo e a nova leitura respeitam o tenant do request — sem vazamento entre tenants.
- **Regra de stack** (CLAUDE.md): GitHub API via **`fetch`**; Octokit v4+ é ESM-only e **proibido**. A leitura GraphQL é um `POST` via `fetch` — **não** reintroduz Octokit.

## Decisão de produto (PI, 2026-07-18)

- **Leitura**: **GraphQL** (`issue.parent` / `issue.subIssues`) — uma query traz issues + hierarquia, evita N+1 e pressão de rate limit. (Alternativa REST `/sub_issues` N+1 rejeitada.)
- **UI**: **swimlane** — o épico é uma **faixa** que agrupa; as fatias-filhas continuam cards que andam `todo→doing→done` por drag-and-drop. O épico **não** é um card no fluxo e **não** tem coluna. (Alternativa "card com filhas aninhadas / coluna agregada" rejeitada: inventava semântica de agregação e quebrava o drag plano.)
- **Definição de épico** (`isEpic`): **estrutural** — é épico toda issue que **tem sub-issues**. Funciona sem rótulo; `proplan:mvp` fica opcional/cosmético. Alinhado ao ADR-014 (lê a estrutura nativa, não exige convenção).
- **Épico fechado** (PI fecha o MVP): a faixa **some das colunas abertas** — as filhas já estão em Finalizado, o board de trabalho fica limpo. (Sem estado "faixa finalizada" no board de colunas abertas.)

## Escopo

1. **Leitura da hierarquia no sync** (ADR-002): via GraphQL, capturar para cada issue o **número do pai** (`parent.number`) — profundidade **2 níveis apenas** (épico → fatia; ver Fora de escopo). Persistir no cache. Repo/issues sem parent → campo nulo, comportamento atual preservado.
2. **Materializar no modelo** (`model Issue`): campo self-referencial `parentNumber Int?` (+ índice), derivado a cada sync (sobrevive ao replace-all do `syncIssues`).
3. **Épico não vira card** (`column-mapping.ts`): uma issue reconhecida como épico (`isEpic` = **tem sub-issues**) é **excluída** da classificação em coluna — não polui `backlog` nem nenhuma outra coluna. Ela alimenta **só** o cabeçalho da swimlane. (Resolve o bug: hoje `columnOf` jogaria uma issue-épico sem `done/doing/todo` em `backlog`.) Épico **fechado** pelo PI → a faixa **não** aparece no board de colunas abertas.
4. **Projeção agrupada** (`getBoard` + `.proplan/STATUS.md`): a `BoardView` devolve as fatias **agrupadas por épico**; fatias sem épico ficam num grupo default ("sem épico"). O espelho Markdown representa a hierarquia (indentação/seção por épico).
5. **UI swimlane** (`KanbanTab`/`KanbanColumn`): renderizar faixas por épico atravessando as colunas; dentro de cada coluna, as fatias-filhas daquele épico. Drag-and-drop de fatia **inalterado**. Faixa "sem épico" para órfãs.

## Fora de escopo

- **Profundidade > 2 níveis**: sub-issue de sub-issue é **achatada/ignorada** neste corte (só épico→fatia). Registrar como limite conhecido.
- **Criar/editar hierarquia pela UI** (arrastar fatia para dentro de um épico, criar sub-issue): leitura apenas. Escrita de relação fica para corte posterior.
- **Agregação de estado do épico** (barra de progresso, % de filhas fechadas): não neste corte — a faixa mostra a contagem simples (`fechadas / total`), sem semântica de coluna.
- **GitHub Projects v2 / issue types**: o resto do antigo item de backlog da Fatia 12 continua fora.
- **Reordenação/persistência de ordem** das swimlanes: ordem derivada (ex.: por número do épico), sem drag da própria faixa.

## Critérios de aceite

> Verificáveis um a um: **setup → ação → resultado observável**. "Funciona" não é critério.

**Leitura e persistência (repo com sub-issues)**

- [ ] Setup: repo cujo issue-épico #E tem filhas #A, #B, #C. Após o sync, cada filha no cache tem `parentNumber = E`; o épico tem `parentNumber = null`.
- [ ] A hierarquia é lida via **GraphQL** (`POST`): conferível na aba de rede/logs — **nenhuma** dependência Octokit adicionada.
- [ ] Repo **sem nenhuma** sub-issue → todos `parentNumber = null`; o board renderiza **idêntico** ao comportamento atual (nenhuma faixa, nenhuma regressão).
- [ ] Sub-issue aninhada em 3+ níveis → tratada como 2 níveis (o neto **não** cria faixa própria); limite documentado, sem erro.

**Épico fora das colunas**

- [ ] Setup: issue-épico #E aberta, com/sem `proplan:*`. Após o sync, #E **não** aparece como card em nenhuma coluna (nem `backlog`); aparece **só** como cabeçalho de faixa.
- [ ] As filhas #A/#B/#C **continuam** classificadas normalmente por `columnOf` (label → coluna) e **movíveis** por drag-and-drop, sem alteração de comportamento vs. hoje.

**Swimlane (UI)**

- [ ] O board mostra uma faixa por épico, atravessando as colunas; cada filha aparece na sua coluna real dentro da faixa do seu épico.
- [ ] Fatias **sem** épico aparecem numa faixa "sem épico" — nenhuma fatia órfã some do board.
- [ ] A faixa exibe título do épico + contagem `fechadas / total` das filhas; sem barra de progresso nem rótulo de coluna no épico.
- [ ] Fechar (finalizar/descartar) uma filha a remove das colunas abertas conforme hoje; a contagem da faixa atualiza no próximo sync. Quando **todas** as filhas fecham, a faixa fica vazia nas colunas abertas (o épico só fecha por ato do PI — ADR-011).

**Projeção espelho e multi-tenant**

- [ ] `.proplan/STATUS.md` após o sync representa a hierarquia (fatias sob seu épico); nunca editado à mão (ADR-010).
- [ ] Setup multi-tenant: o `parentNumber` e a projeção respeitam o contexto/RLS (ADR-020) — hierarquia de um tenant não vaza para outro.

**Resiliência (ADR-002)**

- [ ] Abrir o board (`GET`) **não** dispara chamada ao GitHub — a hierarquia vem do cache do último sync.
- [ ] A query de hierarquia falhar (rate limit/5xx) **não derruba** o `syncIssues`: o estado anterior persiste e o board não quebra (tolerante como a leitura de issues atual).

## Contratos (esboço)

- `board/infrastructure/github-issues.client.ts`: nova leitura GraphQL que devolve, por issue, `parentNumber?: number` (além dos campos atuais de `GithubIssue`). Mantém `fetch`. **O `POST` GraphQL deve enviar o header `GraphQL-Features: sub_issues`** — os campos `Issue.parent`/`Issue.subIssues` são GA mas ainda opt-in por esse header (verificado 2026-07-20). **Fallback:** se o shape GraphQL mudar, a REST `/issues/{n}/sub_issues` é plenamente GA (dez/2024) — cai-se para ela aceitando o N+1, sem re-decisão de produto.
- `prisma/schema.prisma` → `model Issue`: `parentNumber Int? @map("parent_number")` + `@@index([projectId, parentNumber])`. Migração.
- `board/domain/column-mapping.ts`: predicado `isEpic(issue)` e exclusão do épico da classificação de coluna.
- `board.service.ts::getBoard`: `BoardView` passa a expor agrupamento por épico (ex.: `swimlanes: [{ epic|null, columns: [{column, cards}] }]`) — **decisão de shape na implementação**, desde que a UI receba a árvore de 2 níveis.
- `apps/web/src/lib/api.ts`: tipos `BoardView`/`BoardCard` acompanham o agrupamento.

## Notas técnicas

- **Camadas / PRs sugeridos** (os passos vivem no `DEVELOPMENT.md`, não aqui): (1) leitura GraphQL + `GithubIssue.parentNumber`; (2) `model Issue.parentNumber` + migração + persistência no `syncIssues`; (3) `columnOf`/`isEpic` + `getBoard` agrupado + espelho `STATUS.md`; (4) swimlane na UI. Uma fatia, ~4 PRs — como a SPEC-022.
- **GraphQL como caminho novo**: hoje a leitura de issues é REST via `fetch`. A hierarquia introduz um `POST` GraphQL (mesmo token ADR-015). É compatível com a regra de stack (sem Octokit), mas é uma **novidade de infraestrutura** — avaliar se merece nota no `DECISIONS.md` (pergunta aberta).
- **Definição de épico**: ver pergunta aberta — "tem sub-issues" (estrutural) vs. "tem label `proplan:mvp`" (explícito) mudam `isEpic` e o critério 3.

## Perguntas abertas

Nenhuma bloqueia a implementação.

**Resolvida com o PI (2026-07-20):**

1. **Disponibilidade da API de sub-issues** → **GA — aprovada com nota de header.** Verificado em 2026-07-20 (doc/changelog do GitHub + teste vivo nas issues #95/#96 deste repo): sub-issues é GA como produto; a **REST `/sub_issues` é GA desde dez/2024** (limite atual: até 100 filhas por pai); o schema **GraphQL expõe `Issue.parent`, `Issue.subIssues` e `Issue.subIssuesSummary`** + mutação `reprioritizeSubIssue`. **Ressalva fixada em Contratos:** o caminho GraphQL ainda exige o header `GraphQL-Features: sub_issues` (opt-in) — o client tem de enviá-lo; REST `/sub_issues` fica como fallback plenamente GA se o shape GraphQL mudar. Remove o bloqueio sem apagar o risco.

**Resolvidas com o PI (2026-07-18):**

- **Definição de épico** → **estrutural** (tem sub-issues); `proplan:mvp` opcional/cosmético.
- **Épico fechado** → a faixa **some** das colunas abertas.
- **Leitura** → GraphQL. **UI** → swimlane. (Ver "Decisão de produto".)

**Resolvidas por recomendação — reverter se o PI discordar:**

- **Épico é sempre pai, nunca filho** → sim, neste corte (reforça o limite de 2 níveis; épico como sub-issue de outro épico fica fora).
- **GraphQL merece ADR?** → nota no `ARCHITECTURE.md → Resiliência/Integração`, **sem** ADR novo (segue o padrão da SPEC-023 para variação de leitura).
- **Numeração** → `fatia: 18` / SPEC-024 (a "Fatia 12" do backlog era placeholder sem spec).
