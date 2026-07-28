---
proplan: v1
spec: SPEC-033
fatia: 22
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovado pelo PI em 2026-07-28
updated: 2026-07-28
---
# SPEC-033 — Estimativa: cálculo determinístico e decomposição por IA

> **`aprovada-pi` em 2026-07-28.** As 7 perguntas abertas do §8 foram fechadas
> com o PI nesta data — não há decisão de produto pendente.
>
> **Aprovada com a dependência do §4 em aberto, por decisão explícita do PI.**
> O Cowork recomendou esperar a Fatia 21 (SPEC-032, issue #147) ser **aceita**
> antes do carimbo, porque o `EffortEstimator` consome a `ArtifactVersion` de
> `kind = requirements` como contrato de entrada, e essa fatia ainda era
> `proplan:doing` naquele momento. O PI decidiu carimbar assim mesmo.
>
> **✅ Dependência resolvida no mesmo dia**: a **issue #147 foi finalizada
> (`proplan:finalizado`) em 2026-07-28** — o PI aceitou a Fatia 21, e o
> contrato de `requirements` estabilizou. A emenda datada que este cabeçalho
> previa **não foi necessária**. O risco existiu e não se materializou;
> o registro fica porque decisão de risco aceita conscientemente é o tipo de
> coisa que se relê depois, não se apaga.
>
> **Emenda de 2026-07-28 — o contrato carrega horas, não dias.** Ver §3.

## 1. Objetivo

4ª fatia do MVP3. Consome os requisitos aprovados da SPEC-032 (`ArtifactVersion`
de `kind = requirements`) e produz uma estimativa versionada e reproduzível:
horas por tarefa, três cenários, custos diretos e de IA, contingência e preço
final em BRL — **cada número mostrando a sua conta**.

A regra que organiza a fatia: **a IA decompõe, o código calcula** (ADR-012
aplicado a dinheiro). Nenhuma multiplicação, soma, cenário ou preço sai de um
modelo de linguagem — erro de aritmética de IA é plausível, e erro de soma numa
estimativa não aparece como falha: aparece como proposta enviada ao cliente.

## 2. Escopo

Módulo novo `estimates` (`presentation/` · `application/` · `domain/` ·
`infrastructure/`), conforme MVP3 §3. Consome o módulo `artifacts` (serviço
público) e o módulo `llm` — nunca o inverso.

1. **Nova capacidade de IA, `EffortEstimator`** (`kind = effort_breakdown`),
   reaproveitando a infraestrutura da SPEC-032 (`Artifact` / `ArtifactVersion` /
   `ArtifactRun`, fila BullMQ, schema obrigatório, ledger, idempotência por
   `inputHash`, aprovar/rejeitar/editar/regenerar). Consome a versão **aprovada**
   de `requirements`; para cada requisito, propõe uma ou mais tarefas com faixa
   de horas (`horasMin` / `horasProvavel` / `horasMax`). **Nunca soma, nunca
   aplica multiplicador, nunca decide preço** — só decompõe.
2. **Gatilho é sob demanda, não automático**: só existe botão "gerar
   decomposição" quando o `ClientProject` já está em `ARTIFACTS_READY` (os 4
   artefatos da SPEC-032 aprovados). Decompor requisito que ainda pode mudar
   seria trabalho descartável.
3. **Grau de acabamento como multiplicador sobre as horas**, antes da
   contingência: `baixa = 0,85` · `media = 1,00` · `alta = 1,30` — lido de
   `BriefingVersion.answers[9].complexity` (SPEC-031/032, valores
   `'baixa'|'media'|'alta'`, sem acento no código).
4. **3 cenários por soma direta das colunas**, nunca por fator fixo global:
   otimista = Σ `horasMin` de todas as tarefas · provável = Σ `horasProvavel` ·
   pessimista = Σ `horasMax`. O multiplicador do item 3 incide sobre os três.
5. **Contingência de 15% sobre o subtotal**, linha própria e visível em cada
   cenário — nunca embutida no valor/hora nem no total sem discriminação.
6. **Parâmetros por workspace, só o `owner` altera** (mesma regra do ADR-026):
   valor/hora (padrão R$ 200,00), % de contingência (padrão 15%), taxa de
   câmbio USD→BRL **digitada manualmente com data** — sem API externa (mesmo
   motivo do IBGE virar seed na SPEC-031: fonte de terceiro no caminho da conta
   trava a estimativa quando o terceiro cai). Sem taxa informada, o custo de IA
   aparece em USD, rotulado, e **fora** do total em BRL do cenário.
7. **Custos diretos**: digitação livre por item nesta fatia (`label` +
   `valorBrl`) — **sem catálogo**. Catálogo reutilizável vira fatia própria se
   doer (decisão confirmada — reverte a escolha inicial depois de discutido o
   inchaço de escopo).
8. **Custo de IA em duas linhas separadas**:
   - **Consumido** — fato, consulta ao ledger (`LlmUsage` via `artifactRunId`)
     dos runs deste `ClientProject`. Nunca derivado de `ArtifactVersion`
     (ADR-016).
   - **Previsto** — projeção. **Calculada automaticamente a partir da média de
     custo (soma de `LlmUsage.costUsd`) por `ArtifactRun` concluído
     (`status = COMPLETED`) do tenant, quando há ao menos 3 runs concluídos**;
     abaixo desse mínimo, cai para uma linha digitada manualmente, rotulada
     *"projeção não calculada — histórico insuficiente"*. Nunca mostrada com a
     mesma confiança de um número medido, mesmo quando calculada — leva o
     rótulo *"projeção"* em ambos os casos.

     > **Assunção explícita** (sinalizar se não for isso que o PI quis dizer):
     > "execuções do tenant" foi lido como `ArtifactRun`, não `ClientProject` —
     > um projeto pode gerar mais de um run (pipeline original + decomposição +
     > regenerações), e é o run que tem custo no ledger.
9. **Decomposição em MVPs**: agrupamento das tarefas propostas em MVP1/MVP2/…
   com subtotal de horas e custo por grupo — **só dado**, exibido no painel.
   **Não cria issue nem toca GitHub** — mantém a fronteira que o MVP3 §3 já
   declara para esta frente ("`clients` não fala com GitHub"). Criar issues de
   verdade no repositório do cliente é decisão de arquitetura nova, fora desta
   spec (§3).
10. **`Estimate` é entidade versionada e imutável por versão** (mesmo padrão de
    `BriefingVersion`/`ArtifactVersion`): reestimar cria linha nova, nunca
    sobrescreve.
11. **Aprovar a estimativa** (não o `effort_breakdown` — ver nota técnica §7.1)
    move o card `ARTIFACTS_READY → CONTRACT_PENDING`, com
    `ClientStatusTransition` e ator **nunca nulo**. A SPEC-034 não repete esse
    movimento.
12. **Reestimar depois de aprovada não move o card de volta** — a nova versão
    fica disponível para quem monta o contrato decidir qual usar; o funil segue
    de onde estava.
13. **O cliente não vê a estimativa** — o número chega a ele pelo contrato
    (SPEC-034).

## 3. Fora de escopo

- **Catálogo reutilizável de custos diretos** → fatia própria, se doer.
- **Criação de issues reais no GitHub do repo do cliente.** A decomposição em
  MVPs (§2.9) é só dado; escrever no GitHub muda a fronteira declarada no
  MVP3 §3 e pede ADR próprio antes de virar spec — não é um item de escopo a
  mais, é decisão de arquitetura.
- **Referência de mercado** sem fonte + região + data (MVP3 §9): sem isso, o
  rótulo obrigatório é *"referência não verificada"*, e referência que precisa
  desse rótulo não ajuda a decidir — não entra.
- **Cronograma com datas de início.** Nenhuma fatia do MVP3 produz data.
- **Duração em dias.** ~~A fatia produz duração em dias~~ → **removido por
  emenda do PI em 2026-07-28**. Os cenários entregam **horas e dinheiro**
  (`horasBrutas`, `horas`, `subtotalBrl`, `totalBrl`) e nada mais; a conversão
  horas→dias não existe em lugar nenhum do MVP3.

  > **Por que a emenda**: a decisão do PI de 2026-07-27 (#149) dizia que o
  > contrato carregaria duração em dias, e esta spec repetia isso. A
  > implementação da fatia (PRs de 2026-07-28) **não** produziu o campo — o
  > `ScenarioResult` de `estimates/domain/calculation.ts` confirma: horas e
  > BRL, sem dias. Confrontado com a lacuna, o PI **revisou a decisão de
  > 27/07**: o contrato carrega **horas**. O texto acompanha o código, em vez
  > de exigir retrabalho por causa de um papel escrito antes dele.
  >
  > O que sai junto: o divisor de horas produtivas por dia (o *"nominal 10h/dia
  > e realista 6-8h produtivas"* do MVP3 §3) **não é implementado em fatia
  > nenhuma**. Se voltar a ser desejado, é fatia própria — não um `/6` escondido
  > numa tela.
- Valor/hora por tipo de tarefa, senioridade ou cliente.
- Parecer do `ArtifactReviewer` sobre a estimativa **calculada** — o revisor
  (SPEC-032 §2.9) se estende à saída do `EffortEstimator` (mesma regra: anota,
  nunca bloqueia), mas não tem o que opinar sobre soma e multiplicação, que são
  determinísticas e auditáveis por construção.

## 4. Pré-requisitos — todos resolvidos

1. ✅ **Fatia 21 (SPEC-032) aceita** — issue **#147 `proplan:finalizado` em
   2026-07-28**. O `EffortEstimator` consome `ArtifactVersion` de
   `kind = requirements`, contrato agora estável.

   > **Histórico, porque o processo importa mais que o desfecho**: o carimbo
   > desta spec foi dado **antes** do aceite, por decisão do PI, contra a
   > recomendação do Cowork — que era esperar, porque o dogfooding da Fatia 21
   > já havia corrigido comportamento depois de suíte verde mais de uma vez. O
   > aceite veio no mesmo dia e o risco não se materializou. Isso **não**
   > transforma "carimbar antes do aceite" em prática recomendada: a decisão
   > deu certo, o raciocínio que a desaconselhava continua de pé.

2. ✅ **ADR-026 (teto por tenant)** e ✅ **ADR-027 (módulo `llm`)** — já
   entregues na Fatia 21, reaproveitados sem mudança.

## 5. Critérios de aceite

- [ ] Com o `ClientProject` em `ARTIFACTS_READY`, o botão "gerar decomposição"
      dispara job na fila; antes disso, a rota recusa com motivo legível.
- [ ] O `effort_breakdown` gerado tem 1+ tarefas por requisito priorizado, cada
      uma com `horasMin ≤ horasProvavel ≤ horasMax`; resposta fora dessa ordem
      **nunca** vira artefato (mesma regra de schema obrigatório da SPEC-032).
- [ ] Editar uma tarefa do `effort_breakdown` cria versão `human` com
      `parentVersionId`, mesmo contrato do §2.10 da SPEC-032 — nenhuma rota nova
      necessária para isso.
- [ ] Gerar a `Estimate` **sem** a versão corrente do `effort_breakdown`
      aprovada é recusado com motivo legível.
- [ ] Os 3 cenários batem com a soma direta das colunas mín/provável/máx ×
      multiplicador do grau de acabamento, **antes** da contingência.
- [ ] A contingência de 15% aparece como linha própria em cada cenário, nunca
      embutida sem discriminação.
- [ ] Sem taxa de câmbio informada, o custo de IA aparece em USD, rotulado, e
      **fora** do total em BRL — o total não finge incluir o que não converteu.
- [ ] Custo de IA **consumido** bate com a soma do ledger (`LlmUsage.costUsd`
      via `artifactRunId`) para os runs deste `ClientProject` — nunca derivado
      de `ArtifactVersion`.
- [ ] Com <3 `ArtifactRun` concluídos no tenant, o custo de IA **previsto** cai
      para o campo manual rotulado *"histórico insuficiente"*; com ≥3, é
      calculado e ainda assim rotulado *"projeção"*.
- [ ] `member` (não-`owner`) não consegue alterar valor/hora, % de
      contingência nem taxa de câmbio do tenant.
- [ ] Aprovar a `Estimate` move o card para `CONTRACT_PENDING` com
      `ClientStatusTransition` e ator **nunca nulo**.
- [ ] Reestimar depois de aprovada cria versão nova de `Estimate` e **não**
      move o card de volta.
- [ ] A decomposição em MVPs some subtotal de horas/custo por grupo e bate com
      a soma das tarefas atribuídas àquele grupo — nenhuma chamada ao GitHub
      neste caminho (auditável por ausência, mesmo padrão do §7.1 da SPEC-032:
      teste afirmando que o módulo não importa cliente de GitHub).
- [ ] Cliente (rota pública) não tem acesso a nenhuma rota de `estimates`.
- [ ] Auditoria de RLS no CI cobre as tabelas novas.

## 6. Contratos

**Consome** (já existe, SPEC-032):

```ts
// artifacts — ArtifactVersion.content quando kind = 'requirements'
{ requisitos: Array<{ titulo: string; descricao: string; prioridade: 'essencial' | 'importante' | 'desejavel' }> }
```

**Extensão de enum existente**:

- `ArtifactKind` ganha `effort_breakdown`. **Não entra** em `ARTIFACT_KINDS` /
  `REQUIRED_ARTIFACT_COUNT` (`artifacts/domain/artifact-kind.ts`) — esse array
  continua exatamente os 4 da SPEC-032, porque é o que gate a transição para
  `ARTIFACTS_READY`. `effort_breakdown` só passa a existir **depois** desse
  estado; incluí-lo ali exigiria 5 aprovações para um estado que hoje exige 4,
  quebrando o critério de aceite já aceito da Fatia 21.

**Modelos novos** (assinatura, não implementação):

- `Estimate` — por `ClientProject`, **imutável por versão** (reestimar cria
  linha nova): `version`, `hourlyRateBrl`, `contingencyPercent`,
  `exchangeRate` nullable, `exchangeRateAt` nullable (data digitada),
  `directCosts` (`jsonb`: `{label, valueBrl}[]`), `aiCostIncurredUsd`
  (snapshot do ledger no instante de gerar), `aiCostProjected` (`jsonb`:
  `{valueUsd, isCalculated: boolean}`), `scenarios` (`jsonb`:
  `{otimista, provavel, pessimista}`, cada um com horas e total em BRL),
  `mvpBreakdown` (`jsonb`), `approvedAt` nullable, `approvedBy` nullable,
  `createdAt`.

**Extensão de modelo existente**:

- `TenantSettings` ganha `hourlyRateBrl` (padrão 200,00), `contingencyPercent`
  (padrão 15), `exchangeRateUsdBrl` nullable, `exchangeRateAt` nullable —
  reaproveita a tabela do ADR-026 (já por tenant, já só-`owner`) em vez de criar
  uma 2ª tabela de configuração.

**Rotas** (autenticadas, sob `withTenant`; nenhuma rota pública):

- `POST /t/:tenant/client-projects/:id/effort-breakdown/generate` — exige
  `ARTIFACTS_READY`; reaproveita o pipeline genérico de artefatos.
- `GET  /t/:tenant/client-projects/:id/effort-breakdown` — leitura, mesmo
  contrato de leitura da SPEC-032 (§2.12), kind fixo.
- `POST /t/:tenant/artifacts/:id/versions` — já existe (SPEC-032); cobre a
  edição humana do `effort_breakdown` sem rota nova.
- `POST /t/:tenant/client-projects/:id/estimates/generate` — computa a partir
  da versão **aprovada** do `effort_breakdown` + `TenantSettings`; sempre cria
  versão nova.
- `GET  /t/:tenant/client-projects/:id/estimates` — lista versões, mais
  recente primeiro.
- `POST /t/:tenant/estimates/:id/approve` — só aqui o card se move (§2.11).
- `PATCH /t/:tenant/tenant-settings` — já existe conceitualmente (ADR-026);
  ganha os 4 campos novos, mesma guarda de `owner`.

## 7. Notas técnicas

### 7.1 Duas aprovações, dois significados

"Aprovar" aparece duas vezes nesta fatia e **não é o mesmo botão**:

1. Aprovar o `effort_breakdown` — igual a qualquer artefato da SPEC-032:
   confirma que a decomposição em tarefas está correta. **Não move o card.**
2. Aprovar a `Estimate` — confirma o cálculo (parâmetros, cenários, custos).
   **Só este segundo move** `ARTIFACTS_READY → CONTRACT_PENDING` (decisão do
   PI, #148). Se os dois botões acabarem parecendo o mesmo na tela, a decisão
   do PI vira ambígua na prática — vale um rótulo explícito nas duas telas
   (ex.: "aprovar decomposição" vs. "aprovar estimativa").

### 7.2 `effort_breakdown` é gatilho sob demanda, não parte do pipeline original

O `ArtifactRun` da SPEC-032 nasce do evento `BriefingSubmitted` e roda as 4
capacidades em sequência. O `effort_breakdown` **não pertence a esse run** —
nasce de um `ArtifactRun` novo, aberto sob demanda depois de `ARTIFACTS_READY`,
com `completedKinds: ['effort_breakdown']`. A chave de idempotência
(`briefingVersionId`, `kind`, `inputHash`) continua válida porque
`briefingVersionId` não muda; o que muda é apenas *quando* o run é aberto.

### 7.3 Herdado, sem novidade

- IA nunca no caminho de renderização de request (ADR-002).
- Toda query sob `withTenant` (`ARCHITECTURE.md`, regra de 2026-07-22).
- Respostas humanas nunca alteradas por geração de IA (MVP3 §9).
- `TenantSettings` só o `owner` altera (ADR-026) — mesma guarda, campos novos.

## 8. Decisões do PI — 2026-07-28 (fecha as 7 perguntas abertas de #148)

| # | pergunta | decisão | onde entrou |
|---|---|---|---|
| 1 | Multiplicadores do grau de acabamento | `0,85 / 1,00 / 1,30`, antes da contingência | §2.3 |
| 2 | Origem dos 3 cenários | Soma direta das colunas mín/provável/máx por tarefa | §2.4 |
| 3 | Quem altera valor/hora, câmbio, % contingência | Só `owner` (regra do ADR-026) | §2.6, §6 |
| 4 | Custos diretos: catálogo ou digitação | **Digitação livre no 1º corte** — cogitado catálogo, revertido ao discutir que ampliaria a fatia sem necessidade agora | §2.7, §3 |
| 5 | Custo de IA previsto | **Calculado automaticamente** pela média de `ArtifactRun` concluídos do tenant, com piso de 3 runs; abaixo disso, campo manual rotulado | §2.8 |
| 6 | Planejamento de MVPs/issues entra aqui | **Entra, mas só como decomposição em MVPs com subtotal — sem tocar GitHub** (criar issues reais ficou fora, por mudar a fronteira do MVP3 §3) | §2.9, §3 |
| 7 | Reestimar move o card de volta | Não | §2.12 |

**Não há pergunta aberta.**

**Decisão adicional do PI, 2026-07-28**: carimbar `aprovada-pi` **sem esperar**
a aceitação da Fatia 21, contra a recomendação do Cowork. Registrada aqui e no
§4 com a consequência aceita — se o contrato de `requirements` mudar, a spec
recebe emenda datada.

## 9. Nota de processo

Igual ao registrado na SPEC-032 §9: o corpo da issue #148 apontava para este
arquivo como se já existisse (`docs/specs/SPEC-033-estimativa.md`, "escrita em
2026-07-27") quando ele só existia como texto no corpo do card — o mesmo
"ponteiro sem arquivo" que a SPEC-032 já havia sinalizado para #147. Esta spec
materializa o arquivo e o corpo da issue passa a apontar para ele de verdade.

Diferença desta vez: o corpo de #148 registrava que o carimbo esperaria a
aceitação da Fatia 21, e o Cowork manteve essa recomendação ao materializar o
arquivo. **O PI decidiu carimbar mesmo assim, em 2026-07-28** — decisão dele,
registrada em três lugares (cabeçalho, §4 e §8) em vez de aplicada em silêncio.

O que **não** aconteceu, e vale dizer: nenhuma issue foi fechada, nenhum PR foi
mergeado e nada foi declarado pronto. O carimbo é aprovação de escopo, não
aceite de entrega — a distinção que o ADR-011 protege continua intacta.
