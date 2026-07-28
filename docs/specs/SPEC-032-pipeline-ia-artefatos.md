---
proplan: v1
spec: SPEC-032
fatia: 21
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-27
---
# SPEC-032 — Pipeline de IA: artefatos versionados com aprovação humana

> **`aprovada-pi` em 2026-07-27.** Sem perguntas abertas: as 4 decisões da 1ª
> rodada (registradas na #147) e as 8 da 2ª (§8) estão incorporadas no escopo e
> nos critérios de aceite. Liberada para implementação **depois** dos dois
> pré-requisitos do §4, nesta ordem: emenda do teto → ADR do módulo `llm`.

## 1. Objetivo

Dar consumidor ao evento `BriefingSubmitted`, que a SPEC-031 deixou solto de
propósito: uma `BriefingVersion` vira **artefatos versionados, carimbados com o
insumo que os produziu e inúteis até um humano aprovar**.

## 2. Escopo

Módulo novo `artifacts` (`presentation/` · `application/` · `domain/` ·
`infrastructure/`), conforme MVP3 §3.

1. **Gatilho**: consumidor de `BriefingSubmitted` enfileira o job. **Nada de IA
   no caminho da request** (ADR-002) — quem envia o briefing recebe o 201 sem
   esperar geração.
2. **Orquestrador** em job BullMQ (fila própria `artifacts`): carrega **uma
   versão específica** do briefing → valida dados mínimos → executa as
   capacidades em sequência → grava artefato versionado.
3. **Capacidades** (decisão do PI, 2026-07-27): as 4 geradoras —
   `BriefingNormalizer` (`normalize`) → `ScopeAnalyst` (`scope`) →
   `RequirementPrioritizer` (`requirements`) → `SitePromptGenerator`
   (`site_prompt`) — **mais o `ArtifactReviewer`**. `EffortEstimator` e
   `ContractComposer` ficam para SPEC-033/034.
4. **Um modelo só para a frente inteira: Haiku, resolvido do env** (decisão do
   PI, 2026-07-27). **Não existe mapeamento tier→modelo** — a decisão 6 do MVP3
   fica emendada e o **ADR-008 permanece intacto** (provedor configurável,
   Anthropic padrão).
5. **Saída estruturada obrigatória**: cada capacidade declara schema; resposta
   que não valida gera 1 retry (padrão SPEC-003) e, persistindo, o artefato
   falha **explicitamente** (`FAILED` com motivo legível) — nunca artefato pela
   metade, nunca campo inventado para completar o schema.
6. **Ledger e teto**: toda chamada grava linha em `LlmUsage` (ADR-016) com o
   `tenantId` resolvido do briefing. Teto verificado **antes** de enfileirar e
   **antes** de cada capacidade.
7. **Aprovação humana**: cada artefato nasce `PENDING_REVIEW`. O card só chega a
   `ARTIFACTS_READY` **com os 4 artefatos aprovados** (decisão do PI); rejeitado
   deixa o card parado onde está. Nunca por efeito do job.
8. **Reprocessamento idempotente** por (`briefingVersionId`, `kind`,
   `inputHash`), com **serialização canônica** do insumo — mesma armadilha que o
   `contentHash` da SPEC-031 já pagou: a ordem das chaves de um objeto JS segue
   a inserção, e um `JSON.stringify` ingênuo daria hashes diferentes para
   entradas idênticas, matando a idempotência em silêncio.
9. **Revisor anota, nunca bloqueia** (decisão do PI). O parecer do
   `ArtifactReviewer` aparece ao lado do artefato; o botão de aprovar continua
   livre. Bloquear daria à IA poder de veto por via indireta — o oposto do
   MVP3 §6.
10. **Edição humana cria versão nova com autoria registrada** (decisão do PI). O
    prestador pode editar o texto; a edição **nunca** reescreve a versão da IA —
    grava `ArtifactVersion` nova com `author = human` e `parentVersionId`. O
    artefato continua provando o que o modelo gerou, e passa a provar também o
    que o humano mudou. Ver §7.4.
11. **Regenerar sempre cria versão nova, com confirmação de custo** (decisão do
    PI). Mesmo com `inputHash` idêntico: o motivo de existir o botão é *"não
    gostei, tenta de novo"*, e devolver o cache o tornaria decorativo. A tela
    mostra o custo estimado antes de gastar. O `inputHash` continua servindo
    para **idempotência do gatilho automático** (§2.8) — não para o botão.
12. **Leitura no painel**: artefatos do `ClientProject` com estado, versões
    (IA e humanas, na ordem), autoria e o parecer do revisor.

## 3. Fora de escopo

- **Estimativa de esforço** (`EffortEstimator`) → SPEC-033/#148. A aritmética de
  preço é determinística e não é desta fatia: *o LLM decompõe, o código calcula*.
- **Composição de contrato** (`ContractComposer`) → SPEC-034.
- **Complexidade como seletor de modelo.** A decisão 7 do MVP3 fica corrigida:
  `baixa/média/alta` da Etapa 9 é **grau de acabamento**, consumido como fator
  sobre horas na SPEC-033 — não escolhe modelo aqui.
- Dashboard (SPEC-035), notificações, 2º provedor de IA, regeneração automática
  por mudança de prompt.
- **Edição colaborativa / múltiplos editores simultâneos.** A edição do §2.10 é
  de um autor por vez, sem resolução de conflito.

## 4. Pré-requisitos — bloqueiam **código**, não esta spec

Registrados na #147. Ambos são decisão de arquitetura e saem como ADR antes de a
fatia ser codificada. **A ordem correta é: esta spec fecha primeiro, os ADRs
registram as decisões que ela força** — ADR registra decisão tomada, não decisão
a tomar.

1. ✅ **`ADR-026` — teto de IA pertence ao tenant** (escrito e aprovado em
   2026-07-27; emenda o ADR-016 e corrige o fecho do ADR-020). Tabela
   **`TenantSettings` nova**, `capsOf` passa a receber `tenantId`, migração
   **vence o teto do `owner`**, alteração **só pelo `owner`**. `Settings`
   continua existindo como preferência de **usuário**. Ver §7.1 para o
   levantamento que motivou.
2. ✅ **`ADR-027` — módulo `llm` com superfície pública declarada** (escrito e
   aprovado em 2026-07-27). Porta, fábrica, adapters, ledger, preço e gate saem
   do `insight`; a interface pública é `modules/llm/index.ts` e **import
   profundo a partir de fora quebra o build** (lint no CI). **Refatoração pura,
   sem comportamento novo**: nenhuma rota muda e a suíte do `insight` fica verde
   **sem alteração de asserção**. Ver §7.2.

   > **Atenção — mover o diretório não resolve.** Consumidor importando
   > `llm/domain/llm-client` ou `llm/infrastructure/llm-client.factory`
   > reproduz a violação do ADR-001 no endereço novo. O `exports` do `@Module`
   > resolve a injeção; não resolve o import de TypeScript, que é onde o
   > acoplamento mora.

**Sequência obrigatória, não paralela**: o ADR do `llm` depende do ADR-026 — se
o gate deixa de ser `capsOf(userId)` e passa a resolver por tenant, a assinatura
que o `llm` expõe ao `artifacts` muda junto. Escrito antes, o ADR do `llm`
nasceria desenhado em torno de `userId`. Com o ADR-026 já fechado, a porta do
`llm` nasce recebendo `tenantId` — que é o ponto de escrever nesta ordem.

## 5. Critérios de aceite

- [ ] Enviar um briefing (`POST /b/:token/submit`) devolve 201 **sem** esperar
      geração; o job aparece na fila `artifacts`.
- [ ] Concluído o pipeline, o `ClientProject` mostra os 4 artefatos em
      `PENDING_REVIEW` e o card **continua** em `BRIEFING_SUBMITTED`.
- [ ] Aprovar os 4 move o card para `ARTIFACTS_READY` e grava
      `ClientStatusTransition` com o ator (usuário autenticado, **nunca nulo** —
      diferente do briefing, que move o card com ator nulo por ser público).
- [ ] Aprovar 3 de 4 **não** move o card.
- [ ] Rejeitar registra motivo e mantém o card onde está.
- [ ] Disparar o pipeline duas vezes para a mesma `BriefingVersion` **não** cria
      artefato duplicado — a 2ª execução devolve as versões existentes.
- [ ] Duas respostas com as mesmas chaves em ordem diferente produzem **o mesmo**
      `inputHash` (teste direto da serialização canônica).
- [ ] Com teto de gasto estourado, o job **não é enfileirado**; o painel diz por
      quê, em português, e o briefing continua íntegro.
- [ ] Cada chamada ao provedor tem linha em `LlmUsage` com o `tenantId` do
      briefing e o `artifactRunId` — inclusive as que falharam e os retries
      descartados.
- [ ] "Quanto custou este briefing" responde por consulta ao **ledger**, sem
      derivar de `ArtifactVersion`.
- [ ] Resposta do modelo que não valida contra o schema **nunca** vira artefato:
      fica `FAILED` com motivo legível.
- [ ] Teto estourado na 3ª de 5 capacidades: o run fica `FAILED` **e os
      artefatos já gerados continuam visíveis e aprováveis**.
- [ ] Parecer negativo do revisor **não** desabilita o botão de aprovar.
- [ ] Editar um artefato cria versão nova com `author = human` e
      `parentVersionId` apontando para a versão da IA; a versão da IA continua
      legível e inalterada.
- [ ] Regenerar com entrada idêntica cria versão nova (não devolve a anterior) e
      a tela mostra o custo estimado antes de disparar.
- [ ] 429 do provedor: o job retenta **uma vez** com backoff; falhando de novo,
      para e espera clique em regenerar — não fica em loop gastando.
- [ ] `member` (não-`owner`) não consegue alterar o teto de gasto do tenant.
- [ ] Não existe rota que altere `BriefingVersion` nem `ArtifactVersion` (teste
      que lê os metadados de rota do Nest, no padrão do PR-6 da SPEC-031,
      estendido ao módulo novo).
- [ ] Usuário de outro tenant pedindo o artefato recebe a mesma resposta de
      não-encontrado que um id inexistente.
- [ ] Auditoria de RLS no CI cobre as tabelas novas.

## 6. Contratos

**Evento consumido** (já existe, SPEC-031):

```ts
// briefing/application/briefing-submit.service.ts
export const BRIEFING_SUBMITTED = 'briefing.submitted';
export interface BriefingSubmittedEvent {
  clientProjectId: string;
  briefingVersionId: string;
}
```

> O evento **não carrega `tenantId`**, e `ClientProject` **não tem** coluna
> `tenant_id` (é filha de `Client`, que é a raiz de tenancy). O consumidor
> resolve o tenant por lookup próprio e **abre o seu próprio
> `runInTenantContext`** antes de qualquer query — job não tem request para
> carregar contexto. Classe de bug com **5 ocorrências** nesta frente, todas
> passando por teste verde (§7.3).

**Fila**: `ARTIFACTS_QUEUE = 'artifacts'`, registrada no `artifacts.module.ts`
(padrão de `INSIGHT_QUEUE` / `SYNC_QUEUE` / `BOARD_QUEUE`).

**Modelos novos** (assinatura, não implementação):

- `Artifact` — por `ClientProject` + `kind`; estado
  (`PENDING_REVIEW | APPROVED | REJECTED | FAILED`), versão corrente.
- `ArtifactVersion` — **imutável**; `content` (`jsonb` validado por schema),
  `author` (`ai | human`), `parentVersionId` nullable, `inputHash` nullable
  (versão humana não tem), `promptVersion`, `model` nullable, `editedBy`
  nullable, `createdAt`. Único por (`artifactId`, `inputHash`) **apenas quando
  `author = ai`** — índice parcial; sem isso duas edições humanas colidiriam em
  `NULL` ou exigiriam hash falso.
- `ArtifactRun` — execução do pipeline sobre uma `BriefingVersion`: capacidades
  executadas, duração, tentativas, status. **O custo não mora aqui** — mora no
  ledger (ADR-016).
- `ReviewVerdict` — parecer do `ArtifactReviewer` sobre uma `ArtifactVersion`:
  veredito, justificativa, versão do prompt. **Nunca consultado como gate de
  aprovação** — é conteúdo de tela.
- `TenantSettings` — teto e alerta de gasto **por tenant** (§4.1). Substitui as
  colunas homônimas de `Settings`.

**Alteração em modelo existente**:

- `LlmUsage` ganha **`artifactRunId` nullable**. Sem isso, *"quanto custou este
  briefing"* é impossível de consultar; e derivar o custo de `ArtifactVersion` é
  exatamente o que o ADR-016 proíbe (o ledger é a fonte, o artefato é cache).
  Nullable porque o ledger é append-only e anterior a esta fatia.

**Rotas** (autenticadas, sob `withTenant`):

- `GET  /t/:tenant/client-projects/:id/artifacts` — lista com estado e versões.
- `GET  /t/:tenant/artifacts/:id/versions/:versionId` — conteúdo de uma versão.
- `POST /t/:tenant/artifacts/:id/approve`
- `POST /t/:tenant/artifacts/:id/reject` — com motivo.
- `POST /t/:tenant/artifacts/:id/versions` — cria versão **humana** a partir de
  uma existente (edição, §2.10). Não é `PATCH`: nada é alterado no lugar.
- `POST /t/:tenant/client-projects/:id/artifacts/regenerate` — sempre versão
  nova; devolve o custo estimado no `GET` correspondente antes de disparar.

## 7. Notas técnicas — o que está quebrado hoje

Levantado no código em 2026-07-27. É isto que dá forma aos dois ADRs do §4.

### 7.1 O teto de IA não é chamável a partir deste gatilho

`UsageService` (`insight/application/usage.service.ts`) chama
`settings.capsOf(userId)`, e `SettingsService.capsOf` resolve
`personalTenantId(userId)` — que faz `membership.findFirst({ where: { userId },
orderBy: { role: 'asc' } })`. Três consequências:

1. **Não há `userId` neste caminho.** O pipeline dispara do envio de um briefing
   por cliente **anônimo**. O gate atual é inalcançável daqui.
2. **O teto é por usuário, não por tenant.** `Settings.userId` é `@unique`; a
   coluna `tenantId` é acompanhante, não chave. Um tenant com dois membros tem
   **dois tetos** e nenhuma regra de desempate. Mover o teto para o tenant é
   **migração de dados**, não ajuste de configuração — é o miolo da emenda
   (decisões 5a/5b/5c em §8).
3. **`canSpend(projectId)` recebe o `Project` errado.** É o `Project` = repo do
   GitHub, não `ClientProject`. Reusar a assinatura não é opção.

**Drift documental a ratificar junto**: o texto do ADR-016 nunca diz "por
tenant" — o item 6 dele diz *"teto é global, nunca por provedor"*, que é sobre
**provedores**. Quem afirma "por tenant" são o comentário do schema, o
`usage.service.ts` e a linha de fecho do ADR-020 (*"Complementa … ADR-016 (teto
de IA por tenant)"*). A emenda é, portanto, **metade ratificação do que já foi
entregue na Fatia 8, metade decisão nova** (o caso multi-membro). Vale dizer isso
na cara no ADR em vez de fingir que sempre foi assim.

### 7.2 `artifacts` não pode falar com o `insight`

A porta `LlmClient` vive em `insight/domain/llm-client.ts`; o `LlmUsageRecorder`
em `insight/application/`; a fábrica e os adapters em `insight/infrastructure/`.
O ADR-001 é explícito: módulos se comunicam por **interfaces públicas
exportadas**, nunca importando entidade interna de outro módulo. `artifacts`
importando `insight/domain/llm-client` é **violação direta e greppável** — não é
questão de gosto arquitetural.

Daí o módulo `llm`: porta + recorder + fábrica + adapters + preço saem do
`insight`, que passa a ser **cliente** deles como qualquer outro módulo. O
`insight` continua dono do que é dele (prompts de resumo, `input-hash`,
orçamento de contexto).

### 7.3 Contexto de tenant dentro de job

`ClientProject` não tem `tenant_id`; a raiz é `Client`. O job resolve
`briefingVersionId → clientProject → client → tenantId` e **abre o contexto
explicitamente**. Somar ou ler sem contexto sob RLS *fail-closed* não dá erro —
dá **zero linhas**, que é a forma silenciosa de errar. A frente do briefing
acumulou 5 ocorrências desta classe; duas só apareceram no dogfooding, com a
suíte verde.

### 7.4 A edição humana muda três coisas de lugar

A decisão de deixar o prestador editar (§2.10) não é uma tela a mais — ela toca
o modelo em três pontos, e é melhor dizer agora do que descobrir no PR:

1. **A imutabilidade continua, o significado muda.** `ArtifactVersion` segue
   imutável; editar **cria** versão. O que deixa de ser verdade é *"artefato =
   saída da IA"* — passa a ser *"artefato = linhagem, cada elo com autor"*.
   Por isso `author` e `parentVersionId` não são metadado opcional: sem eles a
   linhagem some e ninguém mais sabe o que o modelo produziu.
2. **A idempotência para de valer para versão humana.** O único
   (`artifactId`, `inputHash`) precisa virar **índice parcial** (`WHERE author =
   'ai'`). Deixar como está obrigaria a inventar um hash para texto escrito à
   mão — hash que não hasheia nada é mentira com cara de chave.
3. **O revisor não revisa edição humana.** O `ArtifactReviewer` roda sobre a
   saída do modelo, dentro do run. Versão humana entra depois e **não** dispara
   revisão: IA opinando sobre texto do dono é ruído, e rodá-la ali gastaria
   dinheiro num parecer que ninguém pediu.

### 7.5 Herdado, sem novidade

- IA nunca no caminho de renderização de request (ADR-002).
- Toda query sob `withTenant` (`ARCHITECTURE.md`, regra de 2026-07-22).
- Nada de Kafka (ADR-004): BullMQ.
- Respostas humanas **nunca** alteradas por geração de IA (MVP3 §9). A
  normalização produz artefato **novo**; a `BriefingVersion` é imutável.

## 8. Decisões do PI — 2026-07-27 (2ª rodada)

As decisões da 1ª rodada (capacidades, modelo único Haiku, complexidade como
grau de acabamento, regra dos 4 aprovados) estão na #147 e entraram em §2/§3.
Esta rodada fecha o que faltava. **Não há pergunta aberta.**

| # | pergunta | decisão | onde entrou |
|---|---|---|---|
| 1 | Parecer do `ArtifactReviewer` | **Anota, nunca bloqueia** | §2.9, §6 (`ReviewVerdict`) |
| 2 | Prestador pode editar o artefato | **Sim, com registro de autoria** | §2.10, §6, §7.4 |
| 3 | Regenerar com a mesma entrada | **Sempre versão nova, com confirmação de custo** | §2.11, §6 |
| 4 | Teto estoura no meio do pipeline | **Guarda o parcial como `FAILED`** | §5 |
| 5a | Onde mora o teto por tenant | **`TenantSettings` novo** | §4.1, §6 |
| 5b | Migração dos valores por usuário | **Vence o teto do `owner`** | §4.1 |
| 5c | Quem altera o teto | **Só `owner`** | §4.1, §5 |
| 6 | 429 / provedor indisponível | **Backoff automático, 1 retentativa; falhando, para e espera clique em regenerar** | §5 |

**Consequência da #2 que vale reler**: era a decisão mais barata de dizer "sim" e
a mais cara de implementar. Ela transforma o artefato de *saída da IA* em
*linhagem com autores*, e arrasta o índice de idempotência, o escopo do revisor e
a leitura do painel junto (§7.4). Se a fatia inchar demais na implementação, esta
é a primeira coisa a cortar para uma fatia própria — não as outras sete.

**Consequência da #6**: "backoff automático, 1 vez" é deliberadamente menos do
que o padrão de fila. Uma retentativa cobre o 429 passageiro; a segunda já seria
gastar dinheiro repetidamente numa falha que pode ser estrutural, e aí a decisão
volta a ser humana.

## 9. Nota de processo

Esta spec foi escrita em 2026-07-27, **depois** da issue #147, que já dizia
`aprovada-pi 2026-07-27` apontando para este arquivo quando ele ainda não
existia. Mesmo padrão em #148/#149/#150 (SPEC-033/034/035).

O que **não** estava errado: as decisões. Elas existem, estão datadas e ficaram
registradas no corpo dos cards — esta spec as absorve em §2, §3 e §5. O que
estava errado é o **ponteiro**: o board afirmava a existência de um documento
aprovado que não estava no disco, e o `CLAUDE.md` manda a issue nascer **quando**
a spec vira `aprovada-pi`, não antes. O Claude Code recusou codificar por isso, e
recusou certo.

Fica registrado aqui porque estado forjado no board é exatamente o que este
produto existe para detectar. Deixar passar dentro de casa seria a pior espécie
de dogfooding.
