---
proplan: v1
spec: SPEC-010
fatia: 7.6
status: aprovada-pi
updated: 2026-07-13
---
# SPEC-010 — Operação assíncrona visível + painel de Atividade

## Objetivo

Acabar com o **buraco de silêncio** que toda escrita do ProPlan produz hoje: o usuário aperta um botão, a tela congela por 5–10 segundos, e ele não faz ideia do que está acontecendo — nem se ainda está acontecendo. E dar a ele o registro do que este sistema **andou fazendo no repositório dele**.

## O problema (achado no aceite runtime, 2026-07-13)

O PI promoveu um fallback a documento. Editor com preview funcionou; ao commitar, **a tela ficou idêntica por segundos**, sem sinal nenhum. Ele aguentou porque *sabia* o que rodava por baixo. **Outra pessoa clicaria de novo, ou fecharia.**

**E isso não é bug do promote.** É a forma de **toda escrita síncrona** do ProPlan:

> **ação → commit no GitHub → propagação → sync → recarregar**

Quatro passos, sempre os mesmos, sempre invisíveis, em **três fluxos**: **promote** (Fatia 7), **bootstrap** (Fatia 3) e **salvar mapeamento** `.proplan/config.yml` (Fatia 6). Consertar só o promote é remendar um sintoma de três.

> ⚠️ **Correção de 2026-07-13 — a versão anterior desta spec dizia "quatro fluxos", incluindo a mutação de card do Kanban. Estava errado.** O Kanban **não tem este sintoma**: ele é **otimista** (SPEC-005) — o card muda de coluna na hora, pulsa até confirmar e para em `applied`. Ninguém fica olhando tela congelada arrastando card. Incluí-lo foi generalizar **por simetria, não pelo problema** — abstração antes do segundo consumidor, que este projeto proíbe (regra da SPEC-003). **O `board_mutation` fica como está**: `BoardMutation` + `mutationId` + polling + UI otimista.

**O que decide o desenho**: a operação **continua rodando se o usuário sair da aba**. Ele clica, cansa, vai ver o Kanban — e perde o fio. **Feedback preso ao botão não resolve isso.** Por isso são duas camadas, e as duas são necessárias.

## Escopo

### Camada 1 — `AsyncOperation`: a operação tem passos, e eles têm nome

Um modelo único para toda escrita, no back e no front. Nada de estado ad-hoc por tela.

- **Passos nomeados**, em linguagem de gente — não de log:
  `Commitando docs/ARCHITECTURE.md no repo…` → `Aguardando o GitHub propagar o commit…` → `Sincronizando a documentação…` → `Pronto — a aba agora usa o documento real`
- Cada operação tem: `kind` (**promote · bootstrap · mapping** — **não** `board_mutation`), `steps[]` com estado (`pending|running|done|failed`), `startedAt`, `finishedAt?`, `error?`, e os **artefatos que produziu** (URL do commit, `syncRunId`).
- **Falha é um passo que falha** — com o texto do erro e uma ação (`Tentar de novo` / `Resolver no repo`), nunca um toast que some.
- **Polling do `operationId`**, mesmo padrão do `mutationId` da SPEC-005 e do `sync-run` da Fatia 2. **Sem SSE, sem webhook** (ADR-009) — nenhuma infra nova.
- Os **três fluxos que congelam** migram para ele (promote, bootstrap, mapping). Nenhum mantém feedback próprio.
- **`board_mutation` NÃO migra.** Ele já resolve o silêncio por outro caminho (otimista + `mutationId` + polling), e envolvê-lo em `Operation` criaria **dois registros do mesmo trabalho** — a segunda fonte que o **ADR-017** proíbe. Consolidar só se e quando um **terceiro** mecanismo de "operação em voo" aparecer; mexer no Kanban já entregue, por elegância, é risco de regressão sem ganho visível.

**O passo "aguardando propagação" some quando o sync SHA-aware entrar** (já no backlog): ele deixa de ser tempo cego (`sleep(2500)`) e vira verificação real do commit esperado. Enquanto não entra, o passo **existe e é exibido** — tempo de espera explicado é tolerável; tempo de espera mudo, não.

### Camada 2 — Painel de Atividade (o "console")

Painel lateral, abrível de qualquer tela, **por projeto** (decisão do PI: mostra o que o ProPlan fez **neste repositório** — é a pergunta que o usuário faz; com 5 projetos, um feed global seria ruído). Duas seções:

**Agora** — operações em curso, com os passos da Camada 1. **Sobrevive à navegação**: o usuário sai da aba Arquitetura, vai ao Kanban, e continua vendo o promote andando. É o que o feedback preso ao botão não consegue fazer.

**Histórico** — o que o ProPlan **fez neste repositório**, em ordem reversa:

| quando | o quê | evidência |
|---|---|---|
| há 2 min | commitou `docs/ARCHITECTURE.md` (promote) | link do commit |
| há 2 min | sincronizou — 1 doc alterado | `syncRunId` |
| há 5 min | inferiu Arquitetura por IA — anthropic/claude-sonnet-5 | tokens (custo, quando a Fatia 7.5 entrar) |
| ontem | moveu "Fatia 6" para Em Andamento | link da issue |

**Por padrão, só escrita e inferência** (decisão do PI): commits, promotes, mutações de card, chamadas de IA. **Toggle "mostrar syncs"** revela os syncs — inclusive os `noop`. Sem o toggle, o feed encheria de *"sincronizou — nada mudou"* e o sinal se perderia; **com** ele, o `noop` fica acessível — e o `noop` é exatamente o sintoma do bug de tree-sha obsoleto (ver `ARCHITECTURE.md` → Resiliência). Feed limpo por padrão, verdade completa a um clique.

**Isto não inventa dado nenhum** — `SyncRun` e `Insight` já existem; `LlmUsage` (com custo) chega na Fatia 7.5; as mutações de board já são auditadas em `BoardMutation`. O painel **compõe o que já está no banco**.

**Por que isso é mais que conforto**: o ProPlan **escreve no repositório do usuário**. Um sistema que faz isso tem obrigação de responder *"o que você andou fazendo lá?"* — com link, data e evidência. É a tese do produto aplicada a si mesmo.

## Fora de escopo

Log técnico / stack trace / payload de request (é painel de **atividade**, não console de debug — se virar isso, ninguém olha). SSE ou websocket (polling basta — ADR-009). Notificação fora da aba. Cancelar operação em curso (commit já foi; cancelar é mentira). Filtro e busca no histórico (só ordem reversa + paginação). Retenção configurável — histórico segue a vida do projeto.

## Critérios de aceite

- [ ] **Promote**: ao commitar, os passos aparecem **imediatamente**, um a um, com o texto correto; ao terminar, **a aba recarrega sozinha** e o badge âmbar some. **Em nenhum momento a tela fica igual e muda.**
- [ ] **Os três fluxos que congelam** (promote, bootstrap, salvar mapeamento) usam o **mesmo** componente. Nenhum tem feedback próprio.
- [ ] **O Kanban não muda**: arrastar card continua otimista (`BoardMutation` + `mutationId`), **não** cria `Operation`, e **não regride**. Teste de regressão explícito.
- [ ] **Mutação de card aparece no histórico do painel** mesmo sem `Operation` — via projeção de leitura sobre `BoardMutation`.
- [ ] **Sair da aba não perde o fio**: iniciar um promote, navegar para o Kanban, e a operação continua visível no painel de Atividade, avançando.
- [ ] **Falha é visível e acionável**: simular erro de commit (409) → o passo falha com o motivo e um botão de ação. Nada some sozinho.
- [ ] **Histórico bate com o banco**: cada commit feito pelo ProPlan aparece com link clicável que abre o commit real no GitHub.
- [ ] Recarregar a página **no meio de uma operação** volta mostrando o estado atual dela (o estado é do servidor, não da tela).
- [ ] Nenhum passo mostra jargão: nada de `202`, `docsTreeSha`, `enqueueSync` na cara do usuário.
- [ ] **Feed limpo por padrão**: com 10 syncs `noop` e 1 commit no banco, o histórico mostra **1 item**. Ligar o toggle "mostrar syncs" revela os 11.
- [ ] **Painel é por projeto**: atividade do `landpage` não aparece no painel do `rrb-proplan`.

## Contratos

- Prisma: `Operation { id, projectId, kind promote|bootstrap|mapping, status, steps Json, error?, commitUrl?, syncRunId?, startedAt, finishedAt? }`. As tabelas existentes (`SyncRun`, `Insight`, `BoardMutation`, e `LlmUsage` da 7.5) **continuam sendo a fonte** — `Operation` amarra os passos de uma ação do usuário; o **histórico é composto por leitura de todas**, nunca duplicado. **`BoardMutation` permanece intacto** e alimenta o histórico direto.
- API: `POST` dos **três** fluxos passa a devolver `{ operationId }` · `GET /operations/:id` (estado + passos) · `GET /projects/:id/activity?cursor=&includeSyncs=` (histórico paginado). **`POST /board/mutations` não muda** — continua devolvendo `{ mutationId }`.
- Web: `useOperation(operationId)` (polling) + `<OperationSteps/>` (inline) + `<ActivityPanel/>` (global, no rail).

## Notas técnicas

- **Texto dos passos é conteúdo, não detalhe.** Escrever em português, na voz de quem está explicando a um humano o que está acontecendo com **o repositório dele**. Um passo que diz "Sincronizando…" e nada mais é quase tão ruim quanto o silêncio.
- **Estado mora no servidor.** F5 no meio da operação tem que voltar mostrando o passo atual — se o estado só existir no React, o problema volta disfarçado.
- O histórico **não é uma tabela nova de eventos**: é uma **projeção de leitura** sobre `SyncRun` + `Insight` + `BoardMutation` + `LlmUsage`. Duplicar evento em tabela própria criaria duas fontes do mesmo fato (ADR-017, aplicado internamente).

## Perguntas abertas

Nenhuma. Decidido com o PI em 2026-07-13: painel **por projeto** ✔ · histórico mostra **só escrita e inferência** por padrão, com **toggle "mostrar syncs"** para revelar os `noop` ✔
