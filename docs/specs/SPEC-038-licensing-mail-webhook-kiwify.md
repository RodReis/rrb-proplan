---
proplan: v1
spec: SPEC-038
fatia: 27
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-07-29
---
# SPEC-038 — Licensing: módulo `mail`, webhook da Kiwify e ciclo da assinatura

> 3ª fatia do MVP4 (`docs/specs/MVP4.md`). Depende das Fatias 25 (SPEC-036) e 26 (SPEC-037): emissão, ativação, heartbeat e desativação existindo.

## Objetivo

A venda passa a virar licença sem ninguém no meio: a compra na Kiwify emite a chave e a manda por e-mail; reembolso e chargeback revogam; renovação estende a assinatura; inadimplência é registrada sem derrubar quem só teve o cartão recusado.

É a fatia em que `billingModel: SUBSCRIPTION` deixa de ser coluna e vira comportamento.

## Escopo

### Módulo `mail` (novo, compartilhado)

- Interface `MailService.send({ to, subject, template, data })` com adapter **Resend**; o resto do ProPlan passa a ter para onde crescer (MVP3 vai precisar).
- Envio **assíncrono via BullMQ** (fila `mail`), com retry exponencial. Falha de envio **nunca** desfaz o que já foi gravado.
- Registro de cada envio (destinatário, template, status, erro, tentativas) — falha visível no admin, não só no log.
- Templates desta fatia: **chave da licença** (compra aprovada) e **aviso de revogação** (reembolso/chargeback).
- Reenvio manual pelo admin (a chave em claro **não existe** no banco — reenviar significa **emitir chave nova** e revogar a anterior; ver Notas técnicas).

### Webhook da Kiwify

- `POST /licensing/v1/webhooks/kiwify/:tenantSlug` — **uma URL por tenant, com segredo próprio** (decisão PI #1). Valida a assinatura da plataforma, **persiste o evento bruto** e responde `200` imediatamente; o processamento acontece em job.
- Tabela `LicWebhookEvent`: `platform`, `externalEventId`, `eventType`, `payload`, `receivedAt`, `processedAt`, `status` (`PENDING|PROCESSED|FAILED|IGNORED`), `error`, `licenseId?`. Único por (`platform`, `externalEventId`) — **idempotência é do recebimento**, não do processador.
- Eventos tratados: **compra aprovada** → emite licença + enfileira e-mail; **reembolso** e **chargeback** → `REVOKED` com motivo + e-mail; **renovação** (assinatura) → estende `expiresAt` **e limpa `pastDueAt`**; **atraso/inadimplência** → marca `pastDueAt`, mantém acesso (ver *Tolerância de inadimplência*); **cancelamento de assinatura** → acesso até o fim do ciclo pago (decisão PI #2).
- Evento de tipo desconhecido → gravado com `IGNORED`, nunca erro (a plataforma acrescenta tipos sem avisar).
- Evento cuja licença não é encontrada (ordem invertida, venda fora do mapeamento) → `FAILED` com motivo legível, **retentável pelo admin**, e visível na lista de pendências.
- Mapeamento oferta→edição: tabela `LicOfferMapping` (`platform`, `externalProductId`, `externalOfferId?`, `editionId`), gerida no admin. Compra sem mapeamento **não** emite licença — vira `FAILED` com o identificador da oferta na mensagem.

### Ciclo da assinatura

- `License.pastDueAt` (novo, nullable) — inadimplência registrada sem mudar `status`.

**Tolerância de inadimplência (decisão PI #3).** `LicSettings.pastDueToleranceDays` — configurável no admin, **default 15**. Com valor definido, `pastDueAt + N dias < now` faz `/activate` e `/heartbeat` responderem `410`; com `null`, o ProPlan nunca corta por atraso e quem revoga é sempre a plataforma.

- O nome **não é** `graceDays`: esse já existe no license file da SPEC-036 e significa outra coisa (tolerância de heartbeat offline). Dois "grace" com semânticas diferentes seria erro de leitura garantido.
- **Caminho de volta é obrigatório**: evento de pagamento aprovado (renovação/cobrança bem-sucedida) **limpa `pastDueAt`** e restaura o acesso na mesma transação. Sem isso, o cliente que pagou fica travado até alguém mexer no admin — e o corte automático vira fila de suporte.
- O corte por tolerância grava `LicEvent` com tipo próprio, **distinguível** da revogação vinda da plataforma: são causas diferentes e a trilha precisa dizer qual foi.
- A comparação mora na **validação**, como a de `expiresAt` — nunca em job.
- `expiresAt` de `SUBSCRIPTION` é estendido pela renovação; `PERPETUAL` continua com `expiresAt` nulo.
- Expiração é **avaliada na validação** (`/activate`, `/heartbeat` comparam `expiresAt` com `now`), nunca dependente de job. Um job diário apenas **materializa** `status=EXPIRED` para o admin enxergar.
- `sourceInviteAt` é gravado na compra da edição `source` (`compra + 8 dias`); reembolso/chargeback antes disso limpa o agendamento. O convite em si é da SPEC-039.

## Fora de escopo

- Convite ao GitHub e coleta do username do comprador (Fatia 28 / SPEC-039) — aqui só se grava `sourceInviteAt`.
- Outras plataformas (Hotmart, Lemon Squeezy) — o adapter é a fronteira, mas só a Kiwify é implementada.
- Trial (fora do produto, decisão #4 do MVP4).
- Cobrança, checkout, emissão fiscal — a plataforma faz e continua fazendo; **preço não entra no schema**, só no `payload` do evento.
- Painel completo e métricas (Fatia 29 / SPEC-040) — aqui, o mínimo: lista de eventos de webhook com filtro por status e ação de reprocessar.
- E-mails de ciclo de vida além dos dois templates listados (renovação, aviso de expiração, boas-vindas).

## Critérios de aceite

- [ ] Payload de **compra aprovada** (fixture real da Kiwify) processado ponta a ponta: licença emitida com `saleRef` da transação, edição resolvida pelo mapeamento, e-mail enfileirado com a chave em claro.
- [ ] **O mesmo evento entregue duas vezes emite uma licença só** (retry da plataforma é normal) — a 2ª entrega responde `200` e não cria nada.
- [ ] Assinatura inválida ou ausente → `401`, **sem** gravar evento e sem processar.
- [ ] Compra de oferta **sem mapeamento** → evento `FAILED` com o `externalOfferId` na mensagem; nenhuma licença emitida; item aparece na lista de pendências do admin.
- [ ] Cadastrar o mapeamento e **reprocessar** o evento pendente emite a licença — sem precisar da plataforma reenviar.
- [ ] **Reembolso** e **chargeback** revogam a licença com `revokedReason` correspondente; o `/heartbeat` da máquina ativa passa a responder `410` na chamada seguinte.
- [ ] **Renovação** de `SUBSCRIPTION` estende `expiresAt`; renovação repetida (mesmo evento) não estende duas vezes.
- [ ] **Inadimplência** grava `pastDueAt` e **mantém** `status=ACTIVE`: `/heartbeat` continua respondendo `200` e o sinal aparece no admin.
- [ ] Com `pastDueToleranceDays=15`, licença com `pastDueAt` de **14 dias** responde `200` no `/heartbeat`; com **16 dias**, responde `410` — **sem** job ter rodado.
- [ ] Com `pastDueToleranceDays=null`, licença em atraso há **60 dias** continua respondendo `200` (só a plataforma revoga).
- [ ] **Volta do atraso**: licença já cortada pela tolerância volta a responder `200` ao chegar o evento de pagamento aprovado — `pastDueAt` limpo, sem intervenção no admin.
- [ ] O corte por tolerância e a revogação vinda da plataforma geram `LicEvent` de **tipos distintos** — a trilha diz qual causa cortou o acesso.
- [ ] O webhook responde **por tenant**: evento assinado com o segredo do tenant A enviado para a URL do tenant B → `401`, nada gravado.
- [ ] **Cancelamento** de assinatura preserva `expiresAt`; depois dessa data, `/activate` e `/heartbeat` respondem `410` **mesmo que o job diário não tenha rodado**.
- [ ] Compra da edição `source` grava `sourceInviteAt = compra + 8 dias`; reembolso antes do prazo limpa o campo.
- [ ] Falha do Resend não perde a licença: o registro de envio fica `FAILED` com o erro, a licença permanece emitida, e o retry entrega quando o provider voltar.
- [ ] Evento de tipo desconhecido → `IGNORED`, resposta `200`, nada quebra.
- [ ] `build` e `test` verdes (`lint` **quando existir** — não há script de lint no repo; ver [#190](https://github.com/RodReis/rrb-proplan/issues/190)); **CI não depende de túnel nem da Kiwify** (fixtures gravadas); arch-spec de fronteira mantida (`licensing` usa `mail` pelo service público).

## Contratos

### `POST /licensing/v1/webhooks/kiwify/:tenantSlug`

Request: payload da plataforma + assinatura (header/query, conforme documentação da Kiwify), validada contra o `webhookSecret` do tenant da URL.
`200` sempre que a assinatura confere — inclusive para evento duplicado, desconhecido ou que falhará no processamento (o corpo diz `{ received: true }`; o resultado vive no registro, não na resposta).
`401` assinatura inválida/ausente.

### Modelo (deltas)

```prisma
model LicWebhookEvent { id tenantId? platform externalEventId eventType payload receivedAt processedAt? status error? licenseId? @@unique([platform, externalEventId]) }
model LicOfferMapping { id tenantId platform externalProductId externalOfferId? editionId @@unique([platform, externalProductId, externalOfferId]) }
model MailDelivery    { id tenantId to template subject status(PENDING|SENT|FAILED) attempts error? providerMessageId? createdAt sentAt? }
model LicSettings    { id tenantId @unique webhookSecret pastDueToleranceDays Int? @default(15) }
```

`License` ganha `pastDueAt DateTime?`. Nada mais muda no schema da SPEC-036.

### Admin

`GET /licensing/admin/webhook-events?status=` · `POST /licensing/admin/webhook-events/:id/reprocess` · CRUD de `LicOfferMapping` · `GET /licensing/admin/mail-deliveries?status=` · `POST /licensing/admin/licenses/:id/reissue` (revoga a atual e emite chave nova por e-mail) · `GET|PUT /licensing/admin/settings` (segredo do webhook e `pastDueToleranceDays`).

## Notas técnicas

- **Receber ≠ processar.** A rota grava e responde; o job processa. Motivo: plataforma de pagamento tem timeout curto e reenvia o que demora — processar na request transformaria lentidão em enxurrada de duplicatas. O `@@unique([platform, externalEventId])` é o que torna o reenvio inofensivo.
- **Tenant nas rotas de webhook**: a rota é pública e não tem sessão. O tenant sai da **própria URL** (`:tenantSlug`), não do mapeamento → contexto RLS estabelecido antes de qualquer leitura, e **evento de oferta não mapeada continua tendo dono** (é o caso que mais precisa aparecer no admin). A assinatura é validada contra o `webhookSecret` **daquele tenant**: segredo de um tenant não vale na URL de outro.
- **Reenviar e-mail não reenvia a chave.** Ela só existe em claro no instante da emissão (SPEC-036); guardar cópia para reenvio destruiria a decisão de armazenar só o hash. Reemissão é ato explícito, com revogação da anterior e evento na trilha.
- **Inadimplência não revoga na hora** — cartão recusado é rotina, e derrubar o acesso no primeiro atraso pune o cliente por um evento que a própria plataforma vai retentar. O corte só vem depois de `pastDueToleranceDays` (default 15) ou do que a plataforma decidir (cancelamento/reembolso).
- **Risco aceito do default ligado (decisão PI #3, 2026-07-29)**: com 15 dias como padrão, **todo tenant herda** um segundo julgamento sobre "está pago" — o ProPlan pode cortar antes de uma cobrança que a Kiwify ainda concluiria com sucesso. O que mantém isso administrável é o caminho de volta automático (evento de pagamento religa) e o `LicEvent` distinguível. Se o piloto mostrar corte indevido, a mitigação é `null` no admin, sem deploy.
- **Expiração nunca depende do job.** Job diário atrasado ou morto não pode conceder acesso — a comparação `expiresAt < now` mora na validação. O job existe só para o admin ver `EXPIRED` sem calcular.
- **Segredos**: `RESEND_API_KEY` e `MAIL_FROM` — secrets do Railway, documentados em `docs/DEPLOY.md`. O segredo do webhook **não é env var**: vive em `LicSettings.webhookSecret`, por tenant (env var global não escala para o 2º tenant).
- **Remetente (decisão PI #4)**: **subdomínio dedicado de envio** — `MAIL_FROM = nao-responda@mail.<domínio>`. Isola a reputação do transacional do domínio principal. **O domínio concreto ainda não está definido**: é pendência operacional do `docs/DEPLOY.md`, e bloqueia **só o primeiro envio real** — implementação e testes usam fixtures e não dependem dele. SPF/DKIM/DMARC no DNS (Hostinger) são critério de aceite operacional daquele primeiro envio, não desta fatia.
- **Dev**: túnel (cloudflared/ngrok) para exercício manual; **testes usam fixtures gravadas** — o CI nunca depende de túnel nem da plataforma (decisão #1 das perguntas do MVP4).
- Fila `mail` segue o padrão dos módulos existentes (`BullModule.registerQueue`, ADR-004).

## Decisões do PI (2026-07-29)

Nenhuma pergunta aberta. As quatro que bloqueavam foram resolvidas:

1. **URL do webhook — por tenant, com segredo próprio.** `/licensing/v1/webhooks/kiwify/:tenantSlug`, assinatura validada contra `LicSettings.webhookSecret` daquele tenant. Um 2º tenant passa a vender sem tocar em configuração global, e evento de oferta não mapeada continua tendo dono.
2. **Cancelamento — acesso até o fim do ciclo pago.** `expiresAt` preservado; corte imediato fica só para reembolso e chargeback, onde o dinheiro voltou.
3. **Tolerância de inadimplência — configurável, default 15 dias.** `LicSettings.pastDueToleranceDays`; `null` desliga. Exige o caminho de volta automático e o `LicEvent` distinguível (ver Escopo → Tolerância de inadimplência). Risco aceito registrado nas Notas técnicas.
4. **Remetente — subdomínio dedicado de envio.** `nao-responda@mail.<domínio>`. O domínio concreto fica pendente no `docs/DEPLOY.md` e bloqueia apenas o primeiro envio real.

### Pendências que não bloqueiam esta fatia

- **Domínio do remetente** — decidir antes do primeiro envio real em produção (`docs/DEPLOY.md`).
- **`lint` não existe no repo** ([#190](https://github.com/RodReis/rrb-proplan/issues/190)) — o critério de aceite foi ajustado para não exigir o incumprível.
