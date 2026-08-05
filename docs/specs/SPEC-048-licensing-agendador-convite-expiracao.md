---
proplan: v1
spec: SPEC-048
fatia: 37
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovado pelo PI em 2026-08-05
updated: 2026-08-05 # emendada 2026-08-05 (§A enumeração de tenants)
---
# SPEC-048 — Licensing: o convite ao repo e a expiração deixam de depender de alguém clicar

> Nasce do preparo do dogfooding da compra **source** do War Room (2026-08-05).
> Ao conferir o caminho antes de comprar, apareceu que o convite ao repositório
> **não sai sozinho em momento nenhum**: `SourceInviteService.reconcile` só roda
> por botão do admin, e o botão **não fura o prazo de 8 dias** — ele chama a
> mesma rodada, que filtra `sourceInviteAt <= agora`. Comprar hoje significa que,
> no 8º dia, alguém precisa lembrar de clicar. O mesmo vale para o
> `LicenseExpirySweepService`: existe, é testado, e **nenhum código o chama**.

## Objetivo

O comprador da edição com código-fonte entra no repositório sem que ninguém no
ProPlan precise lembrar de nada — respeitado o prazo de arrependimento — e a
lista do admin para de mostrar `ACTIVE` em licença que as rotas já recusam.

## Contexto: o que já existe e por que não basta

O **ADR-029** (Fatia 36) deu ao repo um agendador — BullMQ repeatable, registrado
por `upsertJobScheduler` com id fixo — e o primeiro consumidor foi o sync diário
do catálogo. O próprio ADR delimitou o que **não** decidia:

> *"nem transforma em recorrente o que hoje é acionado por botão. O
> `SourceInviteService` continua como está — passar a agendá-lo é decisão da
> fatia que provar a necessidade, não efeito colateral desta."*

Esta é a fatia que prova a necessidade. Ela **não cria mecanismo nenhum**:
acrescenta dois consumidores ao que a Fatia 36 já entregou e ligou em produção.

### O prazo de 8 dias fica (reafirmação, decisão PI 2026-08-05)

A decisão fundadora #5 do MVP4 — convite no 8º dia, vencido o prazo de
arrependimento do CDC art. 49 — foi **revisitada e mantida** ao especificar esta
fatia. O que motivou revisitar foi a pergunta de por que o convite não é imediato;
o que a manteve foi o custo do contrário: dentro dos 7 dias legais, o comprador
pode clonar o repositório e pedir reembolso, e o reembolso é obrigatório. O
`SourceRevokeService` remove o colaborador — e o próprio código documenta que
isso **não recupera o que já foi clonado**. Os 8 dias são a única barreira real
entre a edição source e "R$ 129,99 com devolução garantida, e o código fica".

**Consequência que a fatia assume:** quem compra hoje só entra no repo em 8 dias,
e isso precisa estar dito no e-mail da compra e no checkout. Não é escopo desta
fatia escrever esses textos — é escopo desta spec registrar que a lacuna existe.

### Convite "na hora da compra" é impossível, não indesejável

Registrado porque a pergunta vai voltar. O webhook da venda traz `customerEmail`.
Convidar no GitHub é `PUT /repos/{owner}/{repo}/collaborators/{username}` — exige
o **username do GitHub**, que a plataforma de venda não tem. Repositório pessoal
não aceita convite por e-mail (isso só existe em organização). O instante em que
o convite se torna **possível** é quando o comprador responde o link de coleta da
SPEC-039 — e ele responde quando quiser.

É essa imprevisibilidade que fez a SPEC-039 desenhar reconciliação (*"quem tem
direito e ainda não tem?"*) em vez de gatilho por data. Esta fatia preserva esse
desenho inteiro; só liga o motor.

## Escopo

1. **`SourceInviteService.reconcile` passa a rodar sozinho**, por dois caminhos
   que se cobrem:
   - **Recorrente diário** (rede de segurança). É o que atende o caso mais comum
     de todos: quem compra e informa o username **no dia 0**. Nesse caso não há
     evento nenhum no dia 8 — só o relógio. Sem a rodada diária, essa compra fica
     órfã para sempre.
   - **Por evento, ao gravar o username** — tanto no link público
     (`SourceLinkService.setUsername`) quanto no admin
     (`SourceAdminService.setUsername`). Se o 8º dia já passou, o convite sai em
     segundos em vez de até 24 h depois. Se ainda não passou, a rodada não
     encontra nada e não faz nada — o filtro `sourceInviteAt <= agora` já garante
     isso, e é ele que mantém o prazo intacto por construção.
2. **`LicenseExpirySweepService` passa a rodar sozinho**, recorrente diário.
3. **Ambos entram pelo mecanismo do ADR-029** — repeatable na fila `licensing`,
   roteado por `job.name`, registro idempotente por chave estável.
4. **A enumeração de tenants de cada rodada** — ver §*A enumeração de tenants*.
   Não é detalhe de implementação: sem ela as duas rodadas varrem zero tenants.

## Fora de escopo

- **Alterar o prazo de 8 dias.** Reafirmado nesta fatia; mudá-lo é ADR novo.
- **Assinatura, e o fim do acesso ao source quando ela acaba.** O produto de
  assinatura é **outro produto**, não o War Room (decisão PI, 2026-08-05) — não
  misturar. O buraco conhecido (`cancelar()` grava o evento e o colaborador
  permanece) fica **registrado como lacuna** no `PRODUTOS-LICENCIADOS.md`, e volta
  como fatia própria se e quando algum produto vender source por assinatura.
- **Retentativa automática de `FAILED`** (decisão PI 2026-08-05). A causa de
  `FAILED` é quase sempre configuração — PAT expirado, `sourceRepo` errado.
  Retentar sozinho martelaria o GitHub a cada rodada, sempre falhando, e
  esvaziaria de sentido a lista de pendências do admin, que existe justamente
  para pedir a ação humana que resolve. O botão *reemitir* continua sendo o
  caminho, e ele já devolve `FAILED → PENDING`.
- **Notificar o comprador** de que o convite saiu. O GitHub já manda o e-mail do
  convite; um segundo e-mail nosso é fatia própria, se a operação sentir falta.
- **O purge de 90 dias da SPEC-043** — já é `[FIX]` próprio (#271), destravado
  pelo mesmo ADR-029. Não entra aqui para não empacotar duas coisas num card.
- **Frequência do sync do catálogo** — é da SPEC-047 e não se altera.
- **Consertar a enumeração do próprio sync do catálogo** — é `[FIX]` do Code
  (comportamento documentado no ADR-029 decisão 4), e é **pré-requisito** desta
  fatia. Ver §*A enumeração de tenants*.

## A enumeração de tenants (emenda de 2026-08-05)

**A frase original desta spec estava errada e é minha.** Ela dizia *"o mecanismo
é o do ADR-029, sem variação"* e apontava o `CatalogSyncScheduler` como modelo
inteiro. O modelo serve para o **agendamento**; **não serve para a enumeração**,
e copiá-la produziria duas rodadas que não fazem nada.

### O defeito do modelo

`CatalogSyncService.tenantsConfigurados()` faz `prisma.licSettings.findMany`
**fora** de `runInTenantContext` — o `LicensingWorker` só abre contexto dentro do
laço, depois da lista pronta. E a política de `lic_settings` é:

```sql
CREATE POLICY "tenant_isolation" ON "lic_settings"
  USING ("tenant_id" = ANY (NULLIF(current_setting('app.tenant_ids', true), '')::text[]));
```

Sem contexto, `current_setting(..., true)` devolve `NULL`, `x = ANY(NULL)` é
`NULL`, e a linha não passa. **Zero linhas, sem erro** — e `proplan_app` não
escapa: o `bootstrap-app-role.mjs` cria a role `NOSUPERUSER` e **falha
explicitamente** se `rolbypassrls` estiver ligado.

É exatamente a decisão 4 do ADR-029 sendo violada pelo seu primeiro consumidor.

**Consequência fora desta fatia:** o sync diário do catálogo (Fatia 36) enumera
zero tenants e não sincroniza nada. É `[FIX]` do Code — comportamento correto já
documentado (ADR-029 decisão 4 e o comentário do próprio `LicensingWorker`) — e é
**pré-requisito desta fatia**: sem ele, a Fatia 37 nasce sobre um mecanismo que
não roda.

### A decisão

Enumerar tenants exige **sair do RLS de propósito**, e o repo já tem o padrão:
funções `SECURITY DEFINER` com `search_path` fixo, `REVOKE ALL ... FROM PUBLIC` e
`GRANT EXECUTE` só para `proplan_app` — `resolve_license`,
`resolve_past_due_tolerance`, `resolve_source_link`, `resolve_briefing_link`,
`resolve_contract_link`, `resolve_briefing_draft`.

**Esta é diferente de todas elas, e a diferença precisa ser dita.** As seis
existentes recebem uma chave que o chamador **já tem** e devolvem **uma** linha.
As duas novas recebem nada e devolvem um **conjunto**. É a primeira vez que o
repo enumera atravessando o RLS.

| função | devolve | usada por |
|---|---|---|
| `lic_tenants_with_source_pat()` | `tenant_id` de `lic_settings` com `github_pat IS NOT NULL` | `source-reconcile` |
| `lic_tenants_with_expiring_licenses()` | `tenant_id` distinto de `licenses` com `status = 'ACTIVE'` e `expires_at IS NOT NULL` | `expiry-sweep` |

Regras que valem para as duas:

- **Devolvem `tenant_id` e nada mais.** Nunca `github_pat`, nunca
  `kiwify_client_secret`, nunca `webhook_secret`. É a mesma regra que o
  comentário da `resolve_past_due_tolerance` já fixou: *"uma função com
  privilégio de owner que devolvesse o segredo daria a qualquer chamador o poder
  de forjar entrega assinada"*.
- **O RLS das tabelas não muda.** `proplan_app` continua sem enxergar
  `lic_settings` e `licenses` fora de contexto; a função é o único caminho.
- **O filtro é economia, não regra.** A guarda de verdade continua no service:
  `reconcile` sai cedo sem PAT ou sem `sourceRepo`, e o `updateMany` do sweep é
  inócuo num tenant sem licença vencida. Um filtro errado desperdiça uma volta de
  laço; ele **não** pode ser a razão pela qual um convite sai ou não sai.
- **Cada tenant roda dentro do seu `runInTenantContext`**, com `try/catch`
  próprio — a enumeração cruza a fronteira, o trabalho não.

### Por que isto não reabre o ADR-020

O que sai da fronteira é a **existência de um tenant e o fato de ele ter
configuração**, não dado de tenant. Nenhuma licença, nenhum comprador, nenhum
segredo. É a informação mínima para o processo saber a quem servir — e é a mesma
natureza do que o operador já vê ao administrar a instalação.

**Ainda assim é alargamento, e alargamento não entra em silêncio.** Se o Code
julgar que a primeira função enumerante do repo é decisão estrutural, ela vira
**ADR próprio, redigido no PR-1** — mesmo caminho dos ADR-026/027/028/029.

### O filtro de cada rodada, e por que não é o do catálogo

`tenantsConfigurados()` filtra pelas três credenciais da Kiwify. Nenhuma das duas
rodadas novas pode herdar esse filtro:

- **`source-reconcile`** precisa de `githubPat`, não de Kiwify. Um tenant com
  Kiwify e sem PAT seria varrido à toa; **um com PAT e sem Kiwify seria pulado, e
  o convite nunca sairia** — falha muda, do tipo que esta fatia existe para
  acabar.
- **`expiry-sweep`** não precisa de credencial nenhuma: é `updateMany` local.
  Filtrar por qualquer credencial deixaria licença vencida aparecendo como
  `ACTIVE` no admin de todo tenant sem Kiwify.

## Critérios de aceite

Prazo e automatismo:

- [ ] Compra da edição source e username informado **no dia 0**: nenhum convite é
      emitido antes do 8º dia, mesmo com a rodada diária tendo executado.
- [ ] No 8º dia, **sem ninguém clicar em nada**, o convite é emitido e a licença
      vai para `INVITED`.
- [ ] Username informado **depois** do 8º dia: o convite sai na mesma operação
      (segundos), sem esperar a rodada seguinte.
- [ ] O botão *reemitir convite* do admin continua funcionando e continua **não**
      furando o prazo — antes do 8º dia ele não convida ninguém.

Idempotência e resiliência (ADR-029, decisões 3 e 4):

- [ ] Reiniciar a API, ou subir uma segunda instância, **não** duplica o
      agendamento nem emite dois convites para a mesma licença.
- [ ] Redis indisponível no boot **não derruba a API** — o registro falha, o log
      conta, e o boot seguinte registra.
- [ ] Um tenant cujo PAT está quebrado **não impede** a rodada dos demais.
- [ ] Toda a execução recorrente roda dentro de `runInTenantContext` — sem ele o
      RLS fail-closed devolveria zero linhas **sem erro**, e a rodada reportaria
      sucesso tendo feito nada.

Enumeração (emenda de 2026-08-05):

- [ ] **Teste de banco contra Postgres real** (`int-spec`, nunca mock de Prisma)
      provando que cada função de enumeração devolve os tenants esperados
      **sem** `app.tenant_ids` definido. Mock de Prisma não tem RLS — foi o que
      deixou o `tenantsConfigurados()` passar, e é a mesma lição do FIX #216.
- [ ] Cada função devolve **somente** `tenant_id`; nenhum teste consegue extrair
      `github_pat`, `webhook_secret` ou credencial da Kiwify por ela.
- [ ] `REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE` só para `proplan_app`, como
      as seis `resolve_*` existentes.
- [ ] Um tenant com `githubPat` e **sem** credenciais da Kiwify **é varrido** pelo
      `source-reconcile` (o caso que o filtro do catálogo pularia).

Expiração:

- [ ] Licença `ACTIVE` com `expiresAt` no passado aparece como `EXPIRED` na lista
      do admin **sem ninguém clicar**, na rodada seguinte.
- [ ] O sweep continua **não decidindo nada**: uma licença vencida já responde
      `410` em `/activate` e `/heartbeat` **antes** de a rodada executar, e a
      rodada não altera esse comportamento em nenhum sentido.

Pendências:

- [ ] Licença em `FAILED` **não** é retentada pela rodada — continua na lista com
      o botão, e o número de chamadas ao GitHub por rodada não cresce com o
      número de `FAILED` acumulados.

## Contratos

**Sem delta de schema, sem migration.** Nenhuma coluna nova, nenhuma rota nova,
nenhuma mudança em payload de API ou de license file. A fatia é agendamento e
gatilho.

Constantes novas na mesma família das existentes
(`licensing.constants.ts`, ao lado de `CATALOG_SYNC_JOB` / `CATALOG_SYNC_CRON`):

| constante | valor proposto | por quê |
|---|---|---|
| `SOURCE_RECONCILE_JOB` | `source-reconcile` | roteamento por `job.name` na fila `licensing` |
| `SOURCE_RECONCILE_CRON` | `0 4 * * *` | uma hora depois do sync do catálogo (`0 3`), para o log de cada rodada ser legível isolado |
| `EXPIRY_SWEEP_JOB` | `expiry-sweep` | idem |
| `EXPIRY_SWEEP_CRON` | `0 5 * * *` | idem |

Os horários são proposta, não requisito — o que a spec exige é que **não
coincidam** entre si nem com o sync. O `concurrency: 1` da fila já serializa, mas
serialização não é o ponto: horários distintos são o que permite ler *"a rodada
das 4 h falhou"* sem desembaraçar três execuções no mesmo minuto.

## Notas técnicas

**O mecanismo é o do ADR-029, sem variação.** O `CatalogSyncScheduler`
(`infrastructure/catalog-sync.scheduler.ts`) é o modelo: provider com
`OnModuleInit` que chama `upsertJobScheduler` com id fixo, `try/catch` que loga e
**não derruba o boot**, e nenhum conhecimento sobre o que o job faz. Manter a
forma importa por um motivo verificável: quem perguntar *"o que roda sozinho
neste repo?"* precisa achar a resposta procurando por `upsertJobScheduler`, e não
por um `repeat:` escondido dentro de um service de negócio.

**A execução vai para o `LicensingWorker`**, roteada por `job.name` como o sync do
catálogo já é. Fila nova custaria conexão Redis e worker a mais para rodar uma
vez por dia.

**O gatilho por evento não é um segundo mecanismo de agendamento** e não
conflita com o ADR-029 — ele não agenda nada. É um `add` comum na fila (ou a
chamada direta do service, à escolha do Code), disparado por uma ação do usuário,
exatamente como o webhook já dispara o processamento. O que o ADR-029 proíbe é um
segundo jeito de dizer *"rode isto de tempos em tempos"*, e isto aqui não diz.

**O gatilho por evento não pode derrubar a gravação do username.** Se a fila
estiver fora do ar, o username tem de ficar gravado assim mesmo — a rodada diária
o pega depois. Falhar a gravação por causa do gatilho transformaria uma
indisponibilidade de Redis em "o comprador não consegue informar o username", que
é pior do que esperar até a próxima rodada.

**O filtro `sourceInviteAt <= agora` é a guarda do prazo, e é a única.** Nenhum
dos dois gatilhos pode contorná-lo — nem o evento, nem uma chamada de admin. É o
que faz "o prazo fica" ser verdade por construção, e não por disciplina de quem
chama.

**A transição `PENDING → INVITED` continua sendo a guarda de idempotência.** Duas
rodadas no mesmo dia, ou uma rodada concorrendo com o gatilho por evento, não
emitem dois convites: a segunda não encontra mais a licença em `PENDING`.

ADRs aplicáveis: **ADR-029** (o agendador), **ADR-004** (BullMQ), **ADR-020**
(RLS nas `lic_*`), **ADR-015** (o PAT do source é dedicado, fora do GitHub App).

Specs refinadas: **SPEC-039** (convite e revogação — o comportamento não muda,
só passa a disparar) e **SPEC-038** (o `EXPIRED` que ela especificou passa a ser
materializado).

## Riscos conhecidos

- **Redis passa a ser dependência de correção também aqui.** É a consequência que
  o ADR-029 já registrou. Assimetria aceita: Redis fora do ar por dias atrasa um
  convite; **não concede nem revoga acesso nenhum**, porque o que decide acesso
  mora na validação. O pior caso é um comprador esperando.
- **O 8º dia vira promessa operacional.** Hoje o atraso é invisível porque não há
  promessa; a partir daqui, "sai no dia 8" é o comportamento esperado, e um job
  parado por uma semana é uma falha percebida pelo cliente. Mitigação dentro do
  escopo: a lista de pendências do admin já mostra `PENDING` vencido — ela deixa
  de ser o único caminho e passa a ser o alarme.

## Perguntas abertas

Nenhuma. As quatro decisões que bloqueavam esta spec foram resolvidas pelo PI em
2026-08-05:

1. **Prazo de 8 dias** → **fica** (reafirma a decisão #5 do MVP4).
2. **Gatilho do convite** → recorrente diário **e** por evento ao gravar o
   username.
3. **`expiry-sweep`** → **mesma fatia**.
4. **`FAILED`** → **sem** retentativa automática; continua exigindo ação humana.
