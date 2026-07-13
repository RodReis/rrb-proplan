---
proplan: v1
spec: SPEC-009
fatia: 7.5
status: aprovada-pi
updated: 2026-07-12
---
# SPEC-009 — Consumo de IA: ledger de tokens, custo e teto de gasto

> **Fatia 7.5 — última do MVP1** (decisão do PI). Não bloqueia nem é bloqueada por ninguém: toca só o `insight` e o `settings`. Fica por último porque é observabilidade sobre o que já existe — mas **entra ainda no MVP1**, não no MVP2.
>
> ⚠️ **Custo de ficar por último**: as fatias 5, 6 e 7 rodam **sem teto de gasto**. Um bug de loop no job de IA durante esse período queima dinheiro sem freio. Mitigação disponível hoje, de graça: o cap de tokens por execução da SPEC-003 já limita o *tamanho* de cada chamada — o que não limita é a *quantidade* delas. Se você vir a conta subindo durante a Fatia 7 (que é a que mais chama IA), **antecipe esta fatia**.

## Objetivo

Saber **exatamente** quanto o ProPlan gasta de IA — por projeto, por tipo de inferência, por provedor — com um registro que não mente quando algo falha, e com um **teto que impede um bug de queimar a sua conta**.

## Escopo

### 1. Ledger `LlmUsage` (ADR-016)

Uma linha por **chamada ao provedor**. Append-only: nunca `UPDATE`, nunca `DELETE`, nunca chaveada por `docs_tree_sha`.

Registra **toda** chamada, inclusive:

- **falhas** (timeout, 429, 5xx, circuit breaker) — `status: error`, tokens de input contam se o provedor os cobrou
- **retries** (a SPEC-003 tem 1 retry em JSON inválido) — a tentativa descartada é **uma linha própria**, com `attempt: 1`
- **artefatos descartados** — proposta de bootstrap que o usuário não aprovou: o token foi gasto, a linha existe
- **regenerações** — a linha antiga **permanece**; `insights` sobrescreve o artefato, o ledger nunca

`insights` continua sendo o **cache do artefato** (ADR-002). O ledger é o **registro do gasto**. As duas coisas param de se confundir — hoje se confundem, e é por isso que a conta atual subestima.

### 2. Tokens de cache são de primeira classe — e cada provedor conta diferente

Somar tokens de cache como input comum **erra o custo para menos**. Colunas separadas, tarifa separada. Mas o modelo de tarifas **não é uniforme entre provedores** — normalizar é parte do escopo:

| provedor | campo na resposta | cache **write** | cache **read** |
|---|---|---|---|
| **Anthropic** | `cache_creation_input_tokens` · `cache_read_input_tokens` | **cobra a mais** (tarifa própria) | forte desconto |
| **OpenAI** | `prompt_tokens_details.cached_tokens` | **não existe** → grava `0` | desconto |
| **OpenRouter** | varia com o modelo por trás | idem, quando houver | idem |

Provedor que não devolve o campo grava **`0`, nunca `null`** — senão a soma agregada vira `NULL`. Tarifa de cache write ausente na `ModelPrice` (OpenAI) é tratada como `0`, **não** como "usar a de input".

### 3. Custo informado pelo provedor vence a nossa tabela

O **OpenRouter devolve o custo real** da chamada (em créditos) na própria resposta. Nossa `ModelPrice` nunca vai acompanhar o catálogo dele — são centenas de modelos com preço próprio, mudando sozinhos. Manter tabela para isso é fabricar mentira.

Regra: **quando o provedor informa o custo, ele vence.** A linha grava `costSource: provider | table`:

- `provider` — custo veio na resposta (OpenRouter). É **fato**, não conta nossa.
- `table` — custo calculado por nós a partir de `ModelPrice` (Anthropic, OpenAI). É **inferência auditável** — daí o `priceSnapshot`.

Mesmo princípio de evidência do resto do produto: preferir o fato à nossa inferência, e **marcar qual dos dois é**. A tela exibe a origem: totais com custo do provedor não carregam o aviso de "preço pode estar desatualizado"; os nossos, sim.

### 4. Preço configurável, custo congelado

- Tabela `ModelPrice`: `provider`, `model`, `inputPer1M`, `outputPer1M`, `cacheWritePer1M`, `cacheReadPer1M`, `effectiveFrom`, `source` (link/nota de onde o preço veio).
- **Seed** com os modelos em uso (`claude-sonnet-5` etc.), editável na tela de Configurações.
- No momento da chamada: calcula `costUsd` e **grava na linha do ledger**, junto de `priceSnapshot` (JSON com as 4 tarifas usadas) e `pricedAt`. **Nunca recalculado.**
- **Modelo sem preço cadastrado**: a chamada **acontece** (não bloqueia trabalho por falta de cadastro), a linha grava `costUsd = null` e `priceMissing = true`, e a tela de consumo mostra **"N chamadas sem preço cadastrado — o custo real é maior que o exibido"**. Nunca fingir que custou zero.

Moeda: **USD**. Sem conversão para BRL — exigiria câmbio (API externa que envelhece, ou taxa fixa que mente). Os provedores cobram em USD.

### 5. Alerta e teto rígido — **globais, somando todos os provedores**

Em `Settings` (mesma tabela da SPEC-003):

- `llmAlertUsdMonthly` — padrão **5 USD**. Ultrapassado: faixa âmbar na tela de consumo e na Visão Geral.
- `llmHardCapUsdMonthly` — padrão **20 USD**. Ultrapassado: **nenhum job de IA é enfileirado**. A UI mostra "Teto de gasto de IA atingido (X/Y USD este mês) — ajuste em Configurações". `0` desliga o teto.
- O gate é no **enfileiramento**, não na chamada: barrar antes de gastar. Verificação = `SUM(costUsd)` do mês corrente, **de todos os provedores juntos**.
- **Regenerar manual respeita o teto** — não existe "forçar mesmo assim" escondido; para gastar acima, o usuário sobe o teto conscientemente em Configurações.

**Teto é global, não por provedor** (decisão do PI, 2026-07-12). O bolso é um só, e o ADR-008 garante que **só um provedor está ativo por vez** (é config da tela de Configurações) — logo, o gasto flui todo pelo selecionado. Um teto de 20 USD *por provedor* × 3 provedores seria **60 USD de exposição real**, com cara de 20. Teto por provedor é teatro de controle.

A **quebra por provedor/modelo existe na tela**, onde é útil (comparar o custo do mesmo resumo em Sonnet vs GPT). No **gate**, é uma soma só.

**Chamadas sem preço (`priceMissing`) não entram na soma do teto** — e é por isso que o aviso "o custo real é maior que o exibido" **não pode ser escondido**: com preço faltando, o teto protege menos do que promete. A tela mostra o aviso ao lado da barra do teto, não só no rodapé.

**Por que teto rígido e não só alerta**: o ProPlan enfileira job de IA **por evento** (`DocsSynced`). Um loop de sync, um retry mal configurado ou um bug de idempotência viram gasto contínuo sem ninguém olhando. Alerta não protege de nada às 3h da manhã. O teto protege.

### 6. Tela de Consumo (Configurações → Uso de IA)

- **Mês corrente**: total USD, barra até o alerta/teto, total de tokens, nº de chamadas.
- **Quebra por**: projeto · tipo (`summary`, `status_bootstrap`, futuros) · provedor/modelo · status (ok/erro).
- **Taxa de desperdício**: % do custo gasto em chamadas `error` ou `discarded`. É o número que denuncia bug — se subir, tem coisa errada.
- **Histórico**: últimos 6 meses, por mês.
- **Aviso de preço ausente**, quando houver.

## Fora de escopo

Conversão para BRL. Previsão/orçamento futuro. Teto por projeto (só global — com 5 projetos, teto por projeto é cerimônia). Alerta por e-mail/notificação (não temos canal; a faixa na UI basta). Contabilizar tokens do **Claude Code** ou de agentes externos — o ProPlan não os invoca e não os enxerga; registrar só o que **ele mesmo** chama.

## Critérios de aceite

- [ ] Toda chamada de IA gera **uma linha** em `LlmUsage` — inclusive as que falharam.
- [ ] Retry por JSON inválido gera **duas** linhas (`attempt: 1` descartada + `attempt: 2` ok), não uma.
- [ ] Proposta de bootstrap **não aprovada** aparece no ledger com o custo gasto.
- [ ] **Regenerar** um resumo mantém a linha antiga no ledger; o total do mês **soma** as duas.
- [ ] **Anthropic**: chamada com cache grava `cacheCreation`/`cacheRead` em colunas próprias, e o custo usa a tarifa certa de **cada** uma (write ≠ read ≠ input). `costSource: table`.
- [ ] **OpenAI**: `prompt_tokens_details.cached_tokens` é mapeado para `cacheReadTokens`; `cacheCreationTokens = 0` e **nenhum custo de cache write é cobrado** (o erro clássico seria reusar a tarifa da Anthropic). `costSource: table`.
- [ ] **OpenRouter**: o custo devolvido pelo provedor é usado, `costSource: provider`, e **a `ModelPrice` é ignorada** — mesmo que exista uma linha cadastrada para aquele modelo.
- [ ] Mudar o preço de um modelo em Configurações **não altera** o custo de nenhuma chamada já registrada (teste explícito — é a razão de existir o `priceSnapshot`).
- [ ] Modelo sem preço cadastrado: a chamada acontece, `costUsd = null`, `costSource: none`, e a tela avisa "custo real é maior que o exibido" **ao lado da barra do teto**, não escondido no rodapé.
- [ ] Passar do **alerta**: faixa âmbar aparece; nada é bloqueado.
- [ ] Passar do **teto**: nenhum job de IA é enfileirado (nem por evento, nem por "Regenerar"); a UI explica com o valor atual e o teto; subir o teto destrava sem reiniciar nada.
- [ ] **Teto é global**: gasto em Anthropic + OpenAI + OpenRouter **soma no mesmo teto**; trocar de provedor **não zera** o contador do mês. (Teste: gastar metade do teto num provedor, trocar, e confirmar que o restante disponível é o que sobrou — não o teto inteiro.)
- [ ] Teto `0` desliga o bloqueio.
- [ ] Tela de Consumo bate com a soma bruta do banco (`SELECT SUM(cost_usd)` do mês) — a UI não pode ter uma conta própria.
- [ ] Taxa de desperdício é exibida e é > 0 num cenário com falha simulada.

## Contratos

- Prisma novo:
  - `LlmUsage { id, projectId?, kind, provider, model, attempt Int, status ok|error|discarded, inputTokens Int, outputTokens Int, cacheCreationTokens Int @default(0), cacheReadTokens Int @default(0), costUsd Decimal?, costSource provider|table|none, priceMissing Boolean @default(false), priceSnapshot Json?, pricedAt DateTime?, errorCode String?, latencyMs Int?, createdAt }` — **sem `@updatedAt`, sem cascade delete de projeto** (o gasto sobrevive ao projeto ser removido; `projectId` vira `null`). `costSource: none` ⇔ `priceMissing = true`.
  - `ModelPrice { id, provider, model, inputPer1M, outputPer1M, cacheWritePer1M, cacheReadPer1M, effectiveFrom, source String?, @@unique([provider, model, effectiveFrom]) }` — seed com os modelos em uso.
- Prisma alterado: `Settings` ganha `llmAlertUsdMonthly Decimal @default(5)` e `llmHardCapUsdMonthly Decimal @default(20)`.
- API: `GET /usage/llm?from&to` → totais + quebras · `GET /usage/llm/current-month` → `{ costUsd, alertUsd, capUsd, blocked: boolean }` · `GET/PUT /settings/model-prices`.
- `insight`: o `LlmClient` (interface do ADR-008) passa a **devolver o uso bruto normalizado** junto da resposta — `{ inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, providerCostUsd? }`. **A normalização entre provedores é responsabilidade de cada adapter** (é ele que conhece o formato): o `AnthropicClient` mapeia `cache_creation_input_tokens`/`cache_read_input_tokens`; o `OpenAiCompatClient` mapeia `prompt_tokens_details.cached_tokens` → `cacheReadTokens` e força `cacheCreationTokens = 0`; no OpenRouter, preenche `providerCostUsd` a partir do custo devolvido. Quem grava o ledger e decide `costSource` é o `LlmUsageRecorder` no `insight/application` — os adapters **não conhecem preço nem banco**.
- **Gate do teto** vive no ponto de enfileiramento (`insight` ao tratar `DocsSynced` e nos endpoints de regenerar/bootstrap) — não dentro do client.

## Notas técnicas

- **`Decimal`, não `Float`.** Dinheiro em ponto flutuante acumula erro de arredondamento; com milhares de chamadas de fração de centavo, a soma sai errada. Prisma `Decimal` → Postgres `numeric`.
- **Custo por token é fração minúscula** — calcular em `Decimal` a partir de `preço por 1M ÷ 1_000_000 × tokens`, sem passar por `number` no meio.
- **O ledger não pode derrubar a chamada**: falha ao gravar `LlmUsage` é logada, não propagada. Perder uma linha de contabilidade é ruim; perder o resumo que o usuário pediu é pior.
- **Escrever a linha mesmo em erro**: o `try/catch` do client precisa capturar os tokens que o provedor devolveu antes de falhar (a Anthropic devolve `usage` em respostas parciais; em timeout puro não há usage → grava `0` com `status: error`, que ainda serve para a taxa de desperdício).
- **Verificação do teto é uma query agregada por mês** — indexar `LlmUsage(createdAt)` e `(projectId, createdAt)`.
- Fonte de preço: cadastro manual, com o campo `source` para você anotar de onde tirou. **Não buscar preço de API do provedor** — nem todos expõem, e criaria dependência externa para um dado que muda duas vezes por ano.

## Perguntas abertas

Nenhuma. Decidido com o PI em 2026-07-12: custo em **USD com preço congelado na chamada** (tabela editável; histórico nunca reescrito) ✔ · **alerta + teto rígido** configuráveis, com o gate no enfileiramento ✔ · **teto global somando os três provedores**, quebra por provedor só na tela ✔ · **custo informado pelo provedor vence a nossa tabela** (OpenRouter), com `costSource` na linha ✔ · normalização de tokens de cache é responsabilidade de cada adapter ✔
