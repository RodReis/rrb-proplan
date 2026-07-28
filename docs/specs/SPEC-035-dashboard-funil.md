---
proplan: v1
spec: SPEC-035
fatia: 24
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovado pelo PI em 2026-07-28
updated: 2026-07-28
---
# SPEC-035 — Dashboard: retomada, funil de clientes e Kanban de repos

> **`aprovada-pi` em 2026-07-28.** As decisões do PI de 2026-07-27 (corpo da
> #150) e as 4 de 2026-07-28 (§8) estão incorporadas — **não há pergunta
> aberta**.
>
> **⚠️ Carimbada com a dependência do §4.3 em aberto, por decisão do PI, e aqui
> o risco é real — diferente da SPEC-033.** A `Contract` **não existe em
> código**: a Fatia 23 não foi iniciada, e o §6 desta spec lê essa tabela em
> dois lugares. O Cowork recomendou esperar, com um argumento que já se provou
> uma vez: foi assumir um contrato de dados que só existia no papel
> (`{{duration_days}}`) que quase fez a SPEC-034 nascer com um placeholder
> impossível de preencher — pego só porque a Fatia 22 já estava codificada
> quando a spec foi revisada. Aqui não há esse anteparo.
>
> **O que reler se a `Contract` real divergir do §6 da SPEC-034**: a linha
> *"Esperando você — contrato"* da tabela de fontes (§6), o item 3 do §2.3 e o
> critério de aceite dos 4 itens da lista fechada (§5). **Emenda datada, nunca
> reinterpretação silenciosa.**

## 1. Objetivo

6ª e última fatia do MVP3. Acende o item `Dashboard` que a Fatia 19 deixou
desabilitado com `title="Disponível na Fatia 24"` em `GlobalNav.tsx`.

**Não é um resumo do funil — é uma tela de retomada** (decisão do PI): *o que
andou por aqui*, *o que espera por você*, o funil de clientes e o Kanban de
repos, lado a lado, **sem nenhum número somando os dois domínios** (ADR-023).

**O risco desta fatia não é técnico, é de honestidade.** Dashboard é a tela mais
fácil de encher com número bonito, e o MVP3 §9 proíbe exatamente isso: **ou o
número tem origem rastreável em linhas do banco, ou não existe**. Cada card desta
tela precisa responder *"de qual `SELECT` você saiu?"* — e §5 cobra isso.

## 2. Escopo

**Não é módulo novo.** É **query de composição** sobre services públicos dos
módulos existentes (MVP3 §3), mais uma tela. Nenhuma tabela nova, nenhuma
entidade nova — o dashboard **não guarda nada**.

1. **Composição por services públicos**, um resumo por módulo (`clients`,
   `briefing`, `artifacts`, `estimates`, `contracts`, `ingestion`). Latência se
   resolve com índice, **nunca furando a fronteira do ADR-001**. Um
   `dashboard.arch.spec.ts` varre e quebra o build se o agregador importar
   entidade interna ou tocar `prisma` de outro módulo direto.
2. **Bloco "O que andou por aqui"** — retomada. Lê as três trilhas que já
   existem (`client_status_transitions`, `audit_events`, `sync_runs`), **sem
   criar rastreamento novo**. Sem trilha, bloco vazio (§2.7). Rotulado por
   **tenant**, não por usuário — ver §8.1 e §7.1.
3. **Bloco "Esperando você"** — lista fechada de 4 itens (decisão do PI), e é
   **exatamente esta lista** que alimenta o contador do menu:
   - artefatos em `PENDING_REVIEW` (SPEC-032);
   - briefing recebido sem estimativa gerada **ou** estimativa gerada sem
     aprovação (SPEC-031/033);
   - contrato emitido sem aceite registrado (SPEC-034);
   - cards parados há mais de **7 dias** sem mudar de estado (configurável).

   > **Contador = tamanho desta lista, sempre.** Se o número do menu e a lista
   > da tela puderem divergir, o contador vira enfeite — e a pessoa aprende a
   > ignorá-lo, que é pior do que não existir.
4. **Duas frentes, em blocos separados** e **sem total agregado**. O ADR-023
   separa os domínios; um número que some card de repo com card de cliente
   afirmaria uma equivalência que não existe.
5. **Bloco do funil de clientes**: contagem por coluna, no período escolhido.
6. **Bloco do Kanban de repos**: contagem por coluna, **lida ao vivo do GitHub
   no carregamento** (decisão do PI, §8.2), respeitando o ADR-017 — nada
   persistido. Com as 4 salvaguardas obrigatórias do §2.11.
7. **Zero é resultado; ausência é outra coisa.** *"0 contratos"* e *"você ainda
   não emitiu contrato"* são estados diferentes e aparecem diferentes.
   Colapsá-los faz *ainda não usei* parecer *usei e deu zero* — e é o defeito
   mais provável desta tela, porque `COUNT(*)` devolve `0` para os dois.
8. **Períodos 7/30/90 dias e mês corrente, padrão 30**, sem persistir a
   escolha. O período afeta **só** os blocos de contagem — *Esperando você* é
   estado corrente, não janela.
9. **Agregação no fuso `America/Sao_Paulo`, armazenamento em UTC.** Erro de
   virada de mês só aparece ao fechar o mês, quando ninguém está mais olhando o
   código que o causou.
10. **Notificações só dentro do app**: contador no menu, derivado do §2.3.
    **Sem e-mail, sem fornecedor novo, sem tabela de notificação** — tabela
    seria uma segunda verdade sobre o mesmo estado, e as duas divergiriam.
    Atualiza **ao navegar entre telas e ao voltar o foco da aba**; sem polling.
11. **Salvaguardas do bloco de repos** (§8.2), todas obrigatórias:
    - **Falha isolada**: erro ou timeout num repo **não derruba a tela** — o
      bloco mostra "não foi possível carregar" nomeando o repo, e o resto do
      dashboard renderiza normalmente.
    - **Timeout curto por repo** e chamadas em paralelo.
    - **Teto de repos consultados por carga**, com o excedente sob
      "ver todos" — sem isso, um tenant com 40 repos faz 40 chamadas por F5.
    - **Degradação explícita no rate limit**: bloco diz que o limite do GitHub
      foi atingido e quando volta — nunca zero silencioso, que seria
      indistinguível de "board vazio".
12. **O item de menu some quando o tenant não tem cliente nenhum** (decisão do
    PI) — diferente de aparecer vazio.

## 3. Fora de escopo

- **Módulo, tabela ou cache novo.** O dashboard lê; não escreve nada.
- **Notificação fora do app** (e-mail, push, webhook) e **tabela de
  notificação** — §2.10.
- **Persistir a escolha de período** — sem preferência de usuário nesta fatia.
- **Gráfico de série temporal / evolução.** Contagem por coluna e listas; linha
  do tempo pede decisão sobre granularidade e retenção que ninguém pediu.
- **Número que cruze as duas frentes** (ADR-023) — §2.4.
- **Drill-down completo**: depende de listas *cross-project* especificadas nas
  SPEC-032/033/034. O que existir, linka; o que não existir, **não vira link
  morto** (§7.3).
- **`actor_user_id` no `AuditEvent`** — avaliado e adiado, §7.1.

## 4. Pré-requisitos

1. ✅ **SPEC-032 (Fatia 21) aceita** — #147 `proplan:finalizado` em 2026-07-28.
   Fonte de "artefatos em `PENDING_REVIEW`".
2. **SPEC-033 (Fatia 22) entregue** — `Estimate` já existe em código
   (2026-07-28); a fatia segue `proplan:doing`.
3. **SPEC-034 (Fatia 23) entregue** — bloqueia **código**, e o carimbo saiu
   assim mesmo (decisão do PI, ver cabeçalho). `Contract` **não existe em
   código**: um dos 4 itens de *Esperando você* e o bloco de contratos leem uma
   tabela que ainda não foi criada.

   > **A recomendação era esperar, e o argumento tem precedente de um dia**:
   > assumir um campo que só existia no papel (`{{duration_days}}`) quase fez a
   > SPEC-034 nascer com um placeholder impossível de preencher. Aquilo foi
   > pego porque a Fatia 22 já estava codificada quando a spec foi revisada —
   > aqui **não há esse anteparo**, porque a Fatia 23 não começou.
   >
   > **Diferença material em relação à SPEC-033**, que também foi carimbada com
   > dependência aberta: lá o aceite da Fatia 21 veio no mesmo dia e o risco
   > evaporou. Aqui a Fatia 23 não tem uma linha escrita, então o intervalo
   > entre carimbo e verificação é real, não formal.
   >
   > **Consequência aceita**: se a `Contract` real divergir do §6 da SPEC-034,
   > esta spec recebe **emenda datada**. Os três pontos a reler estão no
   > cabeçalho.

4. **Nenhum ADR novo previsto.** Se o bloco de repos ao vivo (§2.6) provocar
   rate limit recorrente, a decisão volta como emenda — não como gambiarra de
   cache, que colidiria com o ADR-017.

## 5. Critérios de aceite

**Honestidade dos números — o núcleo desta fatia**

- [ ] **Todo número da tela tem teste que prova a origem**: para cada card,
      existe teste que monta linhas no banco e afirma a contagem. Número sem
      teste de origem **não entra na tela** (MVP3 §9).
- [ ] *"0 contratos"* (tenant que emitiu e teve zero no período) e *"você ainda
      não emitiu contrato"* (tenant sem nenhum contrato) renderizam **diferente**
      — teste com os dois cenários.
- [ ] Nenhum número da tela soma dado da frente de clientes com dado da frente
      de repos (ADR-023) — auditável por ausência.
- [ ] Contagem do mês corrente vira o mês em `America/Sao_Paulo`, não em UTC:
      linha criada às 22 h de 31/07 (BRT) conta em julho, não em agosto.

**Esperando você / contador**

- [ ] O contador do menu é **exatamente** o tamanho da lista do bloco — teste
      que compara os dois pelo mesmo caminho de dado.
- [ ] Os 4 itens da lista fechada aparecem; nenhum 5º tipo entra sem decisão do
      PI (a lista é constante nomeada, com teste do conteúdo — padrão da
      allowlist da SPEC-033 PR-4).
- [ ] "Parado" usa o limite configurado, não `7` literal espalhado.
- [ ] O contador atualiza ao navegar e ao voltar o foco da aba; **não** há
      polling (auditável por ausência de `setInterval`).

**Bloco de repos ao vivo**

- [ ] Um repo que falha ou estoura o timeout **não derruba a tela**: o bloco
      nomeia o repo e o resto renderiza.
- [ ] Rate limit do GitHub produz mensagem explícita com o horário de
      reposição — **nunca** contagem zero silenciosa.
- [ ] Acima do teto de repos por carga, o excedente fica sob "ver todos" e não
      é consultado.
- [ ] Nada do board é gravado no banco (ADR-017) — auditável por ausência.

**Composição e fronteira**

- [ ] O agregador não importa entidade interna de outro módulo nem chama
      `prisma` de tabela de outro módulo direto — `dashboard.arch.spec.ts`
      quebra o build se acontecer (padrão do `estimates-boundaries.arch.spec.ts`).
- [ ] Nenhuma tabela nova na migração desta fatia.
- [ ] Usuário de outro tenant recebe a mesma resposta de não-encontrado.
- [ ] Item de menu **some** com zero clientes; aparece a partir do primeiro.
- [ ] Sem trilha nenhuma, "O que andou por aqui" mostra estado vazio com texto
      — não uma lista em branco.
- [ ] Todo link de drill-down aponta para tela que existe; item sem destino
      pronto é **texto, não link** (§7.3).

## 6. Contratos

**Nenhum modelo novo. Nenhuma coluna nova.** Esta fatia é leitura.

**Fontes por bloco** — cada linha é a resposta a *"de qual `SELECT` este número
saiu?"*:

| bloco | fonte | módulo |
|---|---|---|
| O que andou por aqui | `client_status_transitions`, `audit_events`, `sync_runs` | `clients`, compartilhado, `ingestion` |
| Esperando você — artefatos | `artifacts` com `state = PENDING_REVIEW` | `artifacts` |
| Esperando você — estimativa | `briefing_versions` sem `Estimate`, ou `Estimate` com `approvedAt IS NULL` | `briefing`, `estimates` |
| Esperando você — contrato | `Contract` com `acceptedAt IS NULL` | `contracts` |
| Esperando você — parados | `client_projects` cuja última `client_status_transition` é anterior ao limite | `clients` |
| Funil | `client_projects` por `state` | `clients` |
| Repos | GitHub Issues **ao vivo** (ADR-017) | `board` |

**Rotas** (autenticadas, sob `withTenant`):

- `GET /t/:tenant/dashboard` — blocos locais (tudo menos repos). Uma chamada,
  não seis: o dashboard é uma tela, e seis requests dariam seis estados de
  carregamento numa página que deveria abrir pronta.
- `GET /t/:tenant/dashboard/pending-count` — só o contador, para o menu.
  Separado de propósito: é chamado a cada navegação e não deve arrastar o
  dashboard inteiro junto.
- `GET /t/:tenant/dashboard/repos` — bloco ao vivo, isolado para que a falha
  dele (§2.11) não contamine a resposta principal.

**Parâmetro de período**: `?period=7|30|90|current_month`, padrão `30`.
Valor fora da lista é **recusado**, não silenciosamente corrigido para o padrão
— corrigir em silêncio faria um erro de front virar dado errado em tela.

**Configuração**: o limite de "parado" (padrão 7 dias) entra em
`TenantSettings`, tabela que a SPEC-033 já usa para parâmetros de workspace, com
a mesma guarda de `owner` (ADR-026). **Não** cria tabela de configuração nova.

## 7. Notas técnicas

### 7.1 "Onde eu parei" não é implementável como escrito — e por que virou "o que andou por aqui"

A #150 diz que o bloco *"lê a trilha existente (`client_status_transitions`,
`audit_events`, `sync_runs`) **filtrada pelo `userId`**"*. Ao conferir o schema
em 2026-07-28: **só `client_status_transitions` tem `actor_user_id`**.
`AuditEvent` tem `tenantId`, `kind`, `subject`, `payload`, `at` — **nenhuma
coluna de ator**. `SyncRun` idem.

Três saídas, e o PI delegou a escolha ao Cowork:

| saída | avaliação |
|---|---|
| Bloco lê só `client_status_transitions` | honesto e sem migração, mas joga fora sync e tudo que vira `AuditEvent` — some metade da retomada |
| Adicionar `actor_user_id` ao `AuditEvent` | migração + tocar **todos** os call sites que gravam auditoria, para distinguir usuários que **hoje não existem**: o MVP é de usuário único (`CLAUDE.md`) |
| **Atividade do tenant, com rótulo honesto** ✅ | zero migração, usa as três trilhas, e com um usuário por workspace o resultado é o mesmo — muda o **rótulo**, não o conteúdo |

**Escolhida a terceira.** O bloco se chama **"O que andou por aqui"**, não "onde
eu parei" — porque é o que ele mostra. Renomear é mais barato que migrar, e
muito mais barato que manter um título que promete um filtro que não existe.

**Gatilho de revisão**: quando um tenant tiver **2 ou mais membros ativos**, a
distinção passa a existir de verdade e `actor_user_id` no `AuditEvent` volta à
mesa — aí como fatia própria, com backfill nulo (mesmo padrão do `tenantId` no
ledger, ADR-016/F4). Registrado aqui para que a revisão tenha critério, e não
dependa de alguém lembrar.

> Vale notar o precedente: o `LlmUsage.tenant_id` nasceu na Fatia 8 e **nunca
> foi preenchido** por nenhum call site até a Fatia 21 achar o problema. Coluna
> de ator adicionada "para o futuro" e não preenchida no presente é exatamente
> essa armadilha — a coluna existe, os dados não, e a consulta devolve linhas
> sem ator sem nunca falhar.

### 7.2 O bloco de repos ao vivo é a decisão mais cara da tela

O PI escolheu buscar contagem de Issues **no carregamento** (§8.2). O custo,
registrado para que a revisão tenha base: **N chamadas ao GitHub por load**, uma
por repo, no mesmo rate limit que o catálogo e o sync consomem — e a tela fica
refém de um terceiro, que é a forma de falha que fez o IBGE virar seed na
SPEC-031.

As 4 salvaguardas do §2.11 não eliminam isso: elas **contêm o dano** (falha
isolada, timeout, teto de repos, mensagem explícita no rate limit). O que
permanece é a dependência.

**Gatilho de revisão**: rate limit atingido de forma recorrente, ou tempo de
abertura do dashboard degradando de forma perceptível. A saída **não** é cache
silencioso — colidiria com o ADR-017 — e sim voltar ao PI com a opção "ao vivo
sob clique", que já estava na mesa.

### 7.3 Link morto é pior que texto

O drill-down depende de listas *cross-project* que as SPEC-032/033/034
especificam mas que podem não estar todas implementadas quando esta fatia rodar.
A regra: **item cuja tela de destino não existe é texto, não link**. Um link que
leva a 404 ensina a pessoa a desconfiar de todos os outros.

### 7.4 Por que "sem tabela de notificação" é decisão de dado, não de escopo

Uma tabela de notificação guardaria "há 3 coisas te esperando". Mas essa
afirmação **já é derivável** das linhas que a produzem (artefato em
`PENDING_REVIEW`, contrato sem aceite…). Guardá-la cria uma segunda verdade que
precisa ser mantida em sincronia com a primeira — e a primeira vez que alguém
aprovar um artefato por um caminho que esqueceu de atualizar a notificação, o
contador vai mentir. Derivar sempre é mais lento e nunca mente.

### 7.5 Herdado, sem novidade

- Toda query sob `withTenant` (`ARCHITECTURE.md`, regra de 2026-07-22).
- Comunicação entre módulos por service público (ADR-001).
- Board lido ao vivo, nada persistido (ADR-017).
- Funil de clientes e board de repos são domínios separados (ADR-023).
- Nada de IA nesta fatia.
- Rotas novas entram na allowlist do `withTenantPrefix` no cliente web — o FIX
  #166 nasceu de esquecer isso, e nenhum teste pega, porque **todos mockam a
  camada de API**, que é onde a função vive.

## 8. Decisões do PI

**2026-07-27** (registradas na #150, incorporadas em §2/§3): composição por
services públicos · duas frentes em blocos separados · item de menu some sem
clientes · notificação só dentro do app, sem tabela · "parado" = 7 dias
configurável · períodos 7/30/90 + mês corrente, padrão 30, sem persistir.

**2026-07-28** (esta rodada):

| # | pergunta | decisão | onde entrou |
|---|---|---|---|
| 1 | Trilha de "onde eu parei" sem `actor_user_id` | **Delegada ao Cowork** → atividade do **tenant**, com rótulo honesto ("O que andou por aqui"), zero migração; gatilho de revisão em 2+ membros | §2.2, §7.1 |
| 2 | Bloco de repos: ao vivo ou local | **Ao vivo no carregamento**, com 4 salvaguardas obrigatórias | §2.6, §2.11, §7.2 |
| 3 | O que entra em "Esperando você" | **Os 4**: artefatos `PENDING_REVIEW` · briefing/estimativa pendente · contrato sem aceite · cards parados >7 dias | §2.3 |
| 4 | Contador do menu | **Ao navegar e ao voltar o foco da aba**; sem polling | §2.10 |

**Sobre a decisão 2, dito uma vez e registrado**: o Cowork apontou o custo (N
chamadas por load, rate limit compartilhado, tela refém de terceiro) e ofereceu
duas alternativas — dado local, ou ao vivo sob clique. O PI escolheu ao vivo no
carregamento. As salvaguardas do §2.11 e o gatilho do §7.2 existem para que essa
decisão possa ser revista com dado, e não com discussão.

**Decisão adicional do PI, 2026-07-28**: carimbar `aprovada-pi` **sem esperar** a
entrega da Fatia 23, contra a recomendação do Cowork. Registrada no cabeçalho e
no §4.3, com os pontos a reler e a diferença material em relação ao caso da
SPEC-033.

**Não há pergunta aberta.**

## 9. Nota de processo

Última das quatro issues placeholder (#147–#150) a ganhar arquivo. Como a #149,
o corpo da #150 **já havia sido corrigido em 2026-07-27** e dizia com todas as
letras que o documento não existia — o ponteiro deixa de ser promessa aqui.

**Segundo descompasso papel↔código encontrado nesta série**, e o mesmo método
achou os dois: ler o schema antes de escrever a spec. O primeiro foi
`{{duration_days}}` na SPEC-034, campo que a `Estimate` não tem. Este é o
`userId` de "onde eu parei", filtro que duas das três trilhas não suportam.
Nenhum dos dois apareceria numa revisão do texto — os dois soavam perfeitamente
razoáveis no papel.

**Fecha o MVP3 no papel**: as quatro issues placeholder (#147–#150) têm arquivo,
e as seis fatias (19–24) estão especificadas. Das seis, três estão carimbadas
com dependência aberta (SPEC-033, SPEC-034, SPEC-035) — a primeira resolveu-se
no mesmo dia, a segunda tinha o código da dependência já escrito, e **esta é a
única cuja dependência não tem uma linha de código**. Se houver retrabalho de
spec no MVP3, o palpite honesto é que começa aqui.
