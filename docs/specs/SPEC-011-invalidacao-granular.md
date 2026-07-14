---
proplan: v1
spec: SPEC-011
fatia: 7.7
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-14
---
# SPEC-011 — Invalidação de inferência por `inputHash`

> **Emenda ao ADR-002.** Não é bug: é mudança da regra de invalidação. O ADR-002 diz *"artefato chaveado por `docs_tree_sha`, regenerado apenas quando o SHA muda"*. Esta fatia troca **a chave**, não o princípio: o artefato passa a ser chaveado pelo **hash do prompt efetivamente enviado ao provedor**. Continua versionado por hash — mas pelo hash **certo**.

## Objetivo

Uma inferência só custa dinheiro quando o que ela **consome** muda — não quando *qualquer coisa* em `docs/` muda.

## O problema, medido

Hoje **qualquer** commit em `docs/` muda o `docs_tree_sha` e enfileira **4 jobs** de IA (`summary`, `edges`, `classify`, `fallback`). Como o Claude Code commita `DEVELOPMENT.md` + `STATUS.md` a **cada entrega**, cada entrega dele dispara a rodada inteira.

O diagnóstico grosso ("nenhuma dessas chamadas ensina nada de novo") **é falso para uma delas**. Olhando o que cada prompt de fato consome:

| job | o prompt consome | um checkmark novo no `DEVELOPMENT.md` muda o input? | veredito |
|---|---|---|---|
| `edges` | `title` + `headings` + `excerpt` de cada doc (`buildEdgesUser`) | **não** | **desperdício** |
| `classify` | só os docs **não resolvidos** (path + headings) | **não** | **desperdício** |
| `fallback` | só roda se `ARCHITECTURE`/`DESIGN` **ausentes** | quase nunca | **desperdício** |
| `summary` | **conteúdo integral** dos docs, via `selectContext` | **sim** — e `ondeParou` é literalmente *"a última coisa concluída"* | **correto — é a feature** |

**Decisão do PI (2026-07-14): o `summary` continua regenerando.** Congelá-lo economizaria a 4ª chamada em troca de um resumo que mente sobre o estado do projeto — o defeito que este produto existe para caçar. **O alvo é 4 chamadas por entrega → 1.**

## Por que não "declarar dependências por inferência"

Era a proposta original no `STATUS.md`. **Não funciona**: `summary` e `edges` dependem honestamente de **todos** os documentos — a declaração viraria `["*"]` nos dois casos e não economizaria nada. O que distingue `edges` de `summary` **não é o conjunto de documentos**; é a **projeção** que cada um extrai deles (headings × conteúdo integral). Só o hash do prompt captura isso — e captura **automaticamente**, sem lista para manter e sem apodrecer quando o prompt mudar.

## Escopo

0. **Rename `Insight.docsTreeSha` → `docsScopeHash`** (mesmo valor, dois nomes — decisão 3 abaixo). Vai na mesma migration.
1. **`Insight.inputHash`** (`String`, indexado com `projectId`+`kind`): SHA-256 dos bytes exatos enviados ao provedor — `system` + `user` renderizados, **mais** `provider` + `model` (trocar de modelo é input novo). Calculado no `insight/domain` (puro, testável).
2. **Gate dentro do job, não no enfileiramento.** O listener de `DocsSynced` **não muda** — continua enfileirando os 4 jobs (o prompt só existe depois de ler os docs). Cada job: monta o prompt → calcula `inputHash` → busca `Insight` do mesmo `(projectId, kind, inputHash)` → **hit ⇒ não chama o provedor**, reaproveita o artefato (só atualiza `docsTreeSha` para o corrente); **miss ⇒ chama, grava artefato novo com os dois hashes**. O custo do gate é uma leitura de banco.
3. **`fallback` hasheia por sub-chamada** (`architecture` e `design` são duas chamadas → dois `inputHash`, um por `InsightKind`).
4. **Painel de Atividade distingue gerado × reaproveitado** — a economia precisa ser visível, senão a fatia não se prova ao vivo (ver *Perguntas abertas*, item 1).
5. **Botão "Regenerar"** (hoje no backlog, cortado da Fatia 7 por falta de teto): com `inputHash`, cache-hit passa a ser o caminho normal, e regenerar **exige `force: true` explícito**. `POST /insights/:kind/regenerate` com `force` → ignora o `inputHash`, chama o provedor, grava linha nova. Protegido pelo teto rígido da 7.5 (ADR-016) + `ConfirmDialog` de custo. É o único caminho para reaplicar um provedor novo sobre um input inalterado (ADR-008).

## Fora de escopo

- **Qualquer mudança no `selectContext` ou nos prompts.** Tirar `DEVELOPMENT.md` do contexto do `summary` foi **rejeitado pelo PI** — seria economia paga com um resumo desatualizado.
- **Invalidação do `DocumentResolution` e do `DocLink`** — o rebuild determinístico do `ingestion` roda a cada sync, é barato e não chama IA. Não é o problema.
- **Cache de prompt do provedor** (`cache_creation`/`cache_read`). Ortogonal — reduz o preço da chamada; esta fatia **elimina a chamada**. Não confundir.
- **Teto / ledger** — já entregues na 7.5.

## Critérios de aceite

- [ ] **O teste que prova a fatia**: commitar só um checkmark no `docs/DEVELOPMENT.md` → sincronizar → **exatamente 1 linha nova em `llm_usage`** (o `summary`). Antes eram 4. `edges`, `classify` e `fallback` registram cache-hit e **não chamam o provedor**.
- [ ] Editar um **heading** de um doc → `edges` **regenera** (o input dele mudou de verdade). Prova que o gate não é "nunca regenerar".
- [ ] Trocar o modelo em Configurações (mesmo `docs_tree_sha`) → **todas** as inferências regeneram. Prova que `provider`+`model` entram no hash.
- [ ] Dois syncs seguidos sem mudança nenhuma (`noop`) → **zero** linhas em `llm_usage`. (Não regride o comportamento atual.)
- [ ] Painel de Atividade mostra, por sync, o que foi **gerado** e o que foi **reaproveitado** — em linguagem de gente, sem jargão (SPEC-010). Vem de `InsightRun`, não de conta na UI.
- [ ] **Um cache-hit não cria linha em `llm_usage`** (o ledger só registra chamada ao provedor — ADR-016). Conferível no banco.
- [ ] "Regenerar" na Visão Geral com o teto atingido → `ForbiddenException` com os valores (não "forçar"). Com folga → `ConfirmDialog` de custo → chama e grava.
- [ ] Custo mensal do `rrb-proplan` **cai** entre dois ciclos de entrega comparáveis, visível na aba Uso de IA. O número vem do `SUM` do banco, não de conta na UI.

## Contratos

```prisma
model Insight {
  // ...existente
  docsScopeHash String? @map("docs_scope_hash")  // renomeado de docs_tree_sha; vira METADADO histórico
  inputHash     String? @map("input_hash")       // SHA-256(system + user + provider + model) — a CHAVE
  @@index([projectId, kind, inputHash])
}

model InsightRun {
  id        String            @id @default(uuid())
  projectId String            @map("project_id")
  kind      InsightKind
  outcome   InsightRunOutcome // generated | reused | failed
  inputHash String            @map("input_hash")
  createdAt DateTime          @default(now()) @map("created_at")
  project   Project           @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
  @@map("insight_runs")
}
```

`InsightRun` é **append-only** (sem `@updatedAt`, nunca deletada) e entra na projeção de leitura do painel de Atividade (SPEC-010) — sem tabela nova no `activity`, que continua só **projetando**.

- `insight/domain/input-hash.ts` — `computeInputHash({system, user, provider, model}): string`. Puro.
- `InsightService.*` — cada gerador consulta o hash **antes** de `run`/`runParsed`.
- `POST /projects/:id/insights/:kind/regenerate` `{ force: true }` → `202 { operationId }` | `403` (teto).

Migration: `inputHash` nasce **nullable** e é backfillada como `NULL`. Linha antiga = cache-miss ⇒ **uma rodada de regeneração por projeto no primeiro sync** após o deploy, e daí estabiliza. Custo aceito e previsível (≈4 chamadas × N projetos gerenciados). Alternativa (recomputar o hash das linhas antigas na migration) exigiria remontar prompts antigos com código novo — **reconstruir o passado com a lógica de hoje**, exatamente o que o ADR-016 proíbe para dinheiro. Não fazemos.

## Notas técnicas

- **ADR-002** — emendado, não violado. O princípio ("artefato versionado por hash, IA nunca no render") continua intacto; muda **qual** hash.
- **ADR-016** — o cache-hit **não é uma chamada** e portanto **não entra em `LlmUsage`**. Poluir o ledger com "chamadas que não aconteceram" destruiria a única fonte honesta de gasto que temos. O reaproveitamento é fato de **execução** (`InsightRun`), não de **gasto**.
- **ADR-017** — nenhum fato em dois lugares. `inputHash` é a chave em `Insight`; `InsightRun` registra *execução*, não artefato nem gasto (ver Decisão 1).
- **Risco**: um prompt **não-determinístico** (ex.: incluir data/hora ou ordenação instável de docs) faria o hash mudar sempre e o gate nunca acertaria — silenciosamente, sem erro. Mitigação: teste que roda o builder de cada prompt **duas vezes** sobre os mesmos docs e exige hash idêntico.
- **Risco inverso**: o hash colide com "input igual, mundo diferente" — ex.: a tabela de preços mudou, ou o provedor melhorou. É **exatamente** o caso que o botão "Regenerar" (item 5) existe para cobrir.

## Perguntas abertas

**Nenhuma.** As três que bloqueavam foram resolvidas pelo PI em 2026-07-14 — registradas abaixo.

## Decisões do PI (2026-07-14)

**1. Onde mora o fato "reaproveitou" → tabela `InsightRun` própria** (append-only, uma linha por execução de job de insight: `generated` | `reused` | `failed`, com `projectId`, `kind`, `inputHash`, `createdAt`).

Descartadas: `Insight.lastReusedAt` (o feed é ordenado no tempo; um reuso em T2 numa linha criada em T1 não tem timestamp próprio — mostraria "reaproveitado" sem *quando*) e contadores no `SyncRun` (os jobs de insight rodam **depois** do `SyncRun` fechar — exigiria reabrir a linha).

**Não viola o ADR-017.** O ADR proíbe *duplicar o mesmo fato*; aqui são três fatos distintos e a distinção é a própria tese do produto:

| tabela | responde | mutável? |
|---|---|---|
| `Insight` | *qual é o artefato* | sim (cache) |
| `LlmUsage` | *quanto custou a chamada ao provedor* | não (ledger, ADR-016) |
| **`InsightRun`** | *o que aconteceu quando o job rodou* | não (append-only) |

Um cache-hit **não gera linha em `LlmUsage`** — não houve chamada. Registrar "chamadas que não aconteceram" no ledger destruiria a única fonte honesta de gasto que temos.

**2. Cache-hit NÃO sobrescreve `Insight.docsTreeSha`.** Ele vira metadado histórico ("este artefato foi gerado quando a árvore era X" — insumo do drift no MVP2); a chave passa a ser o `inputHash`.

**Verificado no código antes de decidir**: `docsTreeSha` só é usado como chave de busca dentro do próprio `insight.service.ts` (os 4 `where` de idempotência) — que é justamente o que esta fatia substitui. **Nenhum outro consumidor** (nem UI, nem `board`, nem `activity`) busca `Insight` por `docsTreeSha`. A troca é contida.

**3. `docsScopeHash` × `docs_tree_sha` → unificar agora, para `docsScopeHash`.** São o mesmo valor com dois nomes (`insight.service.ts:70` faz literalmente `const docsTreeSha = project.docsScopeHash`). A migration desta fatia **já vai existir** por causa do `inputHash` — o custo marginal do rename é ~zero, e é a última janela antes de um **terceiro** hash entrar em cena e petrificar a confusão. Renomeia-se o campo do `Insight` (`docs_tree_sha` → `docs_scope_hash`), alinhando com `Project.docsScopeHash`. Toca `insight.service.ts` + schema + migration. As specs antigas e o ADR-002 mantêm o texto original; o `ARCHITECTURE.md` registra a equivalência histórica.
