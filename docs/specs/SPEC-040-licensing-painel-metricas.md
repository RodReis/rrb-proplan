---
proplan: v1
spec: SPEC-040
fatia: 29
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-29
---
# SPEC-040 — Licensing: painel do tenant, métricas honestas e exclusão a pedido

> 5ª e última fatia do MVP4 (`docs/specs/MVP4.md`). Depende das Fatias 25–28 (SPEC-036 a SPEC-039) — esta fatia **absorve** as telas mínimas que cada uma deixou, não as reimplementa.

## Objetivo

Licenciamento deixa de ser quatro telas mínimas espalhadas por quatro fatias e vira **uma área onde o operador resolve o caso de um cliente sem abrir o banco**: achar a licença, ver o que aconteceu com ela, e agir.

E fecha as duas promessas que o MVP4 fez e nenhuma fatia cumpriu: **métricas** (§6) e **exclusão de dados a pedido** (§7).

**O risco desta fatia não é técnico, é de honestidade** — é a tela mais fácil de encher de número bonito. Vale aqui a regra do MVP3 §9, sem exceção: *todo número tem teste que prova a origem; número sem teste de origem não entra na tela.*

## Escopo

### A área (página de workspace, não gaveta de projeto)

- `/t/:tenant/licensing`, item próprio no `GlobalNav`. Licenciamento é **um por tenant** — abrir pelo projeto A ou B mostraria a mesma coisa, sugerindo uma configuração por projeto que não existe (mesmo raciocínio que pôs perfil e templates de contrato em página própria na SPEC-034).
- **O item some se o tenant não tem `LicProduct`** — some ≠ aparecer vazio, precedente do §2.12 da SPEC-035.
- Seções: **Licenças** · **Pendências** · **Eventos** · **Configurações**.
- As telas mínimas das fatias anteriores são **absorvidas, não duplicadas**: emissão e lista (SPEC-036), eventos de webhook e entregas de e-mail (SPEC-038), pendências de source e PAT (SPEC-039). Nenhum service novo para o que já existe — esta fatia reorganiza superfície e acrescenta o que falta.

### Busca e detalhe

- Busca por **e-mail, nome, chave, `saleRef` e username do GitHub**. A busca por chave hasheia e consulta `keyHash` (já é assim desde a SPEC-036) — a chave em claro continua não existindo no banco.
- **Detalhe da licença responde "o que aconteceu com este cliente" numa tela só**: estado e datas, edição e modelo de cobrança, máquinas ativas e desativadas com `lastSeenAt`, estado do acesso source, entregas de e-mail, e a trilha `LicEvent` completa em ordem.
- Ações no detalhe, todas já definidas nas fatias anteriores exceto as duas últimas: revogar · desativar máquina · reemitir chave · corrigir username, reemitir convite e remover acesso source · **estender** · **excluir dados a pedido**.

### Estender — com carimbo, motivo e aviso na cara

- `POST /licensing/admin/licenses/:id/extend { until, reason }` → grava `expiresAt` e um `LicEvent` `extended_by_admin` com **autor, motivo e o valor anterior**.
- **`reason` é obrigatório e não vazio.** Extensão sem motivo é a que ninguém consegue explicar seis meses depois, quando o cliente cobra o que foi prometido.
- **A tela avisa, no ato da confirmação, que a próxima renovação da plataforma sobrescreve** (decisão PI #2). A extensão manual é correção pontual — cortesia, suporte, conserto de um caso —, não uma segunda fonte de verdade sobre `expiresAt`. O operador precisa saber disso **antes** de prometer ao cliente, e não descobrir depois que a data voltou sozinha.

### Métricas — contagem, nunca dinheiro

- Blocos: **ativações por dia** na janela escolhida · **licenças por status** · **vendas, reembolsos e chargebacks por período** (contagem de eventos) · **assinaturas ativas × inadimplentes** (`pastDueAt`) · **máquinas ativas** · **acesso source por estado**.
- **Receita fica de fora — e o motivo aparece na tela, não só nesta spec.** Preço não é do ProPlan (decisão #4 do MVP4): ele vive no `payload` do evento de webhook, sem coluna tipada, sem moeda normalizada e sem garantia de formato entre plataformas. Um total derivado disso seria plausível e indefensável — exatamente o número sem origem que o MVP3 §9 barra. No lugar do número, **link para a plataforma**, que é onde dinheiro se confere.
- **Zero é resultado; ausência é outra coisa** (§2.7 da SPEC-035): *"nenhuma venda no período"* e *"nunca vendeu"* são fatos diferentes e renderizam diferente — o sinal de "já houve alguma vez" viaja **fora** do recorte de período.
- **Período fora da lista fechada é recusado, nunca corrigido em silêncio** (§6 da SPEC-035): corrigir caladamente faz erro de front virar contagem plausível de uma janela que ninguém pediu.
- **A virada do dia é `America/Sao_Paulo`, não UTC** — venda às 22h de 31/07 BRT é 01h de 01/08 em UTC, e cortar em UTC faria o mês perder o próprio último dia; erro que só aparece no fechamento, quando ninguém está mais olhando.
- Composição via **`licensing-summary.service.ts`** (regra de fronteira do MVP4 §3): quem compõe lê o service público, nunca tabela de outro módulo.

### Exclusão a pedido (LGPD)

- `POST /licensing/admin/licenses/:id/anonymize { reason }`: substitui `customerEmail`, `customerName` e `githubUsername` por marcadores; `MailDelivery.to` idem; `LicWebhookEvent.payload` tem os **campos pessoais redigidos**, preservando os de conciliação (`externalEventId`, tipo, data).
- **O que não some: a licença, as ativações, a trilha e o `saleRef`.** Exclusão de dado pessoal não apaga a existência da transação — a obrigação fiscal e contratual continua, e apagar a trilha destruiria a capacidade de provar o que aconteceu. **Essa distinção é a ação inteira**; implementar "delete da linha" seria cumprir a letra e destruir o registro.
- **Irreversível, com confirmação por digitação** do e-mail do titular — padrão de ação sem volta, para que ninguém a execute por clique errado numa lista.
- Grava `LicEvent` `anonymized` com autor e motivo: **o evento fica, o dado sai**.
- **Efeitos declarados antes da confirmação**: licença anonimizada não recebe mais e-mail (não há destino) e reemitir chave deixa de funcionar pelo fluxo normal. Descobrir isso depois é transformar o direito do titular em incidente de suporte.

## Fora de escopo

- **Bloco de licenciamento no Dashboard** (SPEC-035) — decisão PI #4. O Dashboard cruza Clientes e Repos sem somar um no outro (ADR-023); um 3º domínio na mesma tela é onde essa disciplina cede primeiro.
- **Receita, ticket médio, qualquer valor em moeda.** Gatilho de revisão: se virar necessidade real, o caminho é emenda datada na SPEC-038 extraindo valor e moeda para coluna tipada **no recebimento** — nunca ler o payload na hora de renderizar.
- Exportação CSV, relatório contábil, portal self-service `GET /portal/:key`.
- Alerta ativo (e-mail ao operador quando um webhook falha) — nesta fatia a pendência é visual.
- Outras plataformas de venda; cliente de licença do War Room.

## Critérios de aceite

- [ ] Tenant **sem `LicProduct`** não vê o item no `GlobalNav`; com produto, a área abre nas quatro seções.
- [ ] Busca pela **chave em claro** encontra a licença — e a chave continua não existindo em nenhuma tabela (a busca hasheia).
- [ ] Busca por e-mail, nome, `saleRef` e username do GitHub encontra a licença correspondente.
- [ ] O **detalhe responde sozinho** *"o que aconteceu com este cliente"*: datas, máquinas (ativas e desativadas), acesso source, e-mails enviados e trilha completa — sem consultar o banco.
- [ ] **Estender sem motivo é recusado**; com motivo, grava `expiresAt` e `LicEvent` contendo autor, motivo e **valor anterior**.
- [ ] A tela de extensão **exibe o aviso de sobrescrita** antes da confirmação, e um evento de renovação da plataforma processado depois **sobrescreve** a data manual (teste ponta a ponta).
- [ ] **Todo número da tela tem teste que prova a origem.** Número sem teste de origem não entra — critério de reprovação, não de estilo.
- [ ] **Nenhum valor monetário aparece em lugar nenhum** — provado por ausência: a resposta do summary não tem campo de valor, e há teste afirmando isso.
- [ ] Período fora da lista fechada → **recusa** (nunca correção silenciosa); contagem de mês vira em `America/Sao_Paulo`, com teste de virada de mês **e** de ano.
- [ ] *"Nenhuma venda no período"* e *"nunca vendeu"* renderizam **diferente**.
- [ ] **Anonimizar**: e-mail, nome e username somem da licença, das entregas de e-mail e do payload dos eventos; **licença, ativações, trilha e `saleRef` permanecem**; `LicEvent` `anonymized` gravado com autor e motivo.
- [ ] A confirmação exige **digitar o e-mail do titular**; a tela declara os efeitos (sem e-mail futuro, sem reemissão de chave) antes.
- [ ] **Anonimizar não altera nenhuma métrica** — as contagens antes e depois são idênticas (é o teste que prova que a trilha foi preservada).
- [ ] Tenant B não enxerga licença, evento, métrica nem configuração do tenant A (RLS por teste).
- [ ] `build`, `lint` e `test` verdes — o `lint` passa a ser exigível: o script existe na raiz desde a [#194](https://github.com/RodReis/rrb-proplan/pull/194) (parte 1/2 da [#190](https://github.com/RodReis/rrb-proplan/issues/190)). Arch-spec de fronteira mantida: quem compõe métrica lê `licensing-summary.service.ts`, não tabela de outro módulo.

## Contratos

### Admin (auth de sessão existente, escopo do tenant)

`GET /licensing/admin/licenses?q=&status=` (busca ampliada) · `GET /licensing/admin/licenses/:id` (detalhe agregado: máquinas, source, e-mails, trilha) · `POST /licensing/admin/licenses/:id/extend { until, reason }` · `POST /licensing/admin/licenses/:id/anonymize { reason }` · `GET /licensing/admin/summary?period=` (contagens; **sem campo de valor**).

As demais rotas já existem nas SPEC-036 a SPEC-039 e não mudam de caminho.

### Modelo (deltas)

Nenhuma tabela nova. `LicEvent.type` ganha `extended_by_admin` e `anonymized`. Marcadores de anonimização gravados nos próprios campos existentes — sem coluna "está anonimizado", porque o estado é derivável da trilha e coluna paralela abriria a possibilidade de os dois discordarem.

## Notas técnicas

- **Por que a extensão manual perde para o webhook**: `expiresAt` tem uma autoridade — a plataforma, desde a SPEC-038. Duas autoridades permanentes sobre a mesma data significam divergência que só aparece quando alguém for cobrado errado. A extensão existe como conserto pontual e **assume** que o próximo evento vence; o que a torna administrável é o aviso na tela e o valor anterior gravado no evento.
- **Por que a anonimização preserva a trilha**: o direito é sobre **dado pessoal**, não sobre o fato da transação. Apagar a linha atenderia ao pedido e destruiria a prova de emissão, ativação e revogação — inclusive a prova de que a exclusão foi feita.
- **Por que nenhuma coluna "anonimizado"**: derivável do `LicEvent`. Coluna paralela cria a chance de o flag dizer uma coisa e o dado dizer outra.
- **Métrica é contagem sobre coluna tipada**, nunca sobre `payload`. Onde só existe payload (valor pago), não há métrica — há link para a plataforma.
- **A tela não usa polling** para contadores: atualiza ao navegar e ao voltar o foco, com `visibilitychange` (precedente do §2.10 da SPEC-035 — clicar de volta numa janela nunca oculta não é *voltar*, e dispararia request a cada alt-tab).
- **Prefixo de rota no cliente web**: as rotas de licensing entram em `TENANT_SCOPED_PREFIXES`. Sem isso a chamada sai sem `/t/:tenant`, a API responde 404 e a tela falha **muda** — é literalmente o FIX #166, e nenhum teste de componente pega, porque todos mockam a camada onde `withTenantPrefix` vive.
- **Revisão jurídica continua pendente** (ressalva do MVP4 §7): esta fatia entrega o **mecanismo** de exclusão a pedido. Se o texto dos termos e a política de retenção estão corretos é parecer de advogado, não critério de aceite de software.

## Decisões do PI (2026-07-29)

Nenhuma pergunta aberta. As quatro que bloqueavam foram resolvidas:

1. **Métricas em contagem, sem receita.** Vendas, reembolsos, chargebacks e assinaturas contam eventos; valor em moeda fica fora, com o motivo escrito na tela e o caminho de volta registrado (emenda na SPEC-038 extraindo valor tipado no recebimento).
2. **Estender existe, e o webhook vence depois.** Com autor, motivo e valor anterior no evento, e aviso de sobrescrita antes da confirmação.
3. **Exclusão a pedido entra nesta fatia**, como ação do painel: anonimiza o dado pessoal, preserva licença, trilha e `saleRef`.
4. **Licenciamento não aparece no Dashboard** — área própria. Preserva o ADR-023.

### Pendências que não bloqueiam esta fatia

- **Domínio do remetente** (herdado da SPEC-038) — bloqueia só o primeiro envio real em produção.
- **`lint` no CI** — o script existe (#194); rodar no workflow é a parte 2/2 da #190.
- **Revisão dos termos com advogado** — herdada do MVP4 §7, fora do escopo de qualquer fatia.
