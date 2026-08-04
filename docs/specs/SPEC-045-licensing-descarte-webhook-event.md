---
proplan: v1
spec: SPEC-045
fatia: 34
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-08-04
---
# SPEC-045 — Licensing: descartar evento de webhook sem apagar a trilha

> Refina a SPEC-038 (Fatia 27, finalizada). Nasce do dogfooding de 2026-08-04,
> registrado na issue [#257](https://github.com/RodReis/rrb-proplan/issues/257).
> **Não é `[FIX]`**: cria estado novo no domínio e superfície nova no admin —
> não há comportamento correto já documentado a restaurar.

## Objetivo

A lista de pendências volta a significar *"tem coisa para fazer"*. O operador tira
da lista a entrega que **nunca** terá conserto, sem apagar a linha nem o payload
que explicam por que aquela venda não virou licença.

## O problema, medido

A aba **Pendências → Oferta → edição** acumulou **6 ofertas sem mapeamento**,
todas de disparos do botão *"Testar Webhook"* da Kiwify. Cada disparo manda um
`product_id` fictício **e diferente** (`764cd7eb`, `38316019`, `d972678b`,
`307974cd`, …). Nenhum corresponde a produto real, e nenhum jamais terá
mapeamento.

O badge laranja é permanente e **não tem conserto possível**: quem abre o admin vê
seis vendas paradas e não tem ação que as resolva. Mapear seria pior — emitiria
licença real para venda fictícia.

Duas saídas foram descartadas antes desta spec, e ficam registradas para não
voltarem:

1. **`DELETE` direto no Postgres.** O `LicWebhookEvent` guarda o payload bruto
   justamente para responder *"por que esta venda não virou licença"*. Apagar
   para a tela ficar limpa é o oposto do que este produto verifica.
2. **Rota de delete no admin.** Mesma objeção, e o `CLAUDE.md` já fixa o
   princípio no board (*"issue nunca é deletada"*) — registro de licenciamento
   segue a mesma lógica.

## Escopo

### Estado `DISCARDED`

- `LicWebhookStatus` ganha **`DISCARDED`** (hoje: `PENDING | PROCESSED | FAILED |
  IGNORED`, `schema.prisma:1780`). Evento descartado **sai da lista de pendências
  e do badge**; a linha, o payload e o `error` original permanecem intactos.
- **`DISCARDED` é desfecho, não espera.** Carimba `processedAt` como
  `PROCESSED`/`FAILED`/`IGNORED` já carimbam — ver *Notas técnicas → A armadilha
  do CHECK*.
- **`error` não é sobrescrito.** O motivo da falha original é o que responde
  *"por que parou"*; o motivo do descarte responde *"por que desistimos"*. São
  duas perguntas, e uma não pode comer a outra.

### Carimbo: quem descartou, quando e por quê

Quatro colunas novas em `LicWebhookEvent` — `discardedAt`, `discardedBy`,
`discardedReason`, `reopenedAt`. **Não é `LicEvent`**: aquele exige
`licenseId NOT NULL` (`schema.prisma:1762`), e o caso que originou a fatia é
exatamente o evento **sem licença nenhuma**.

- `discardedReason` é **obrigatório e não-vazio** para descartar. Descarte sem
  motivo é o mesmo item ilegível que a lista de pendências já produzia, só que
  escondido.
- `discardedBy` é o `req.userId` da sessão — mesmo carimbo de autor que
  `LicensePrivacyService.extend` já usa.

### Ações no admin

- **Descartar** — botão na linha, ao lado de *Reprocessar*, **com confirmação e
  motivo**. Uma linha por vez (ver *Decisões do PI* #2).
- **Reabrir** — devolve o evento a `PENDING`, com carimbo próprio (`reopenedAt`).
  Só aparece em linha `DISCARDED`. Enfileira o processamento pelo mesmo caminho
  do `reprocess` — quem decide o desfecho é o job, nunca a rota.
- **Reprocessar não ressuscita.** Em linha `DISCARDED` o botão *Reprocessar* não
  existe; o caminho de volta é o *Reabrir*. Descartar e reabrir são **dois atos
  deliberados**, cada um com seu carimbo — simétrico ao Finalizado/Descartado do
  board.
- **Filtro `Descartadas`** na barra de status do painel, ao lado de *Falhas*.
  O filtro inicial continua `FAILED`.

### Agrupamento *Oferta → edição*

- `listSeenOffers` passa a **ignorar eventos `DISCARDED`** ao agregar. A oferta
  cujos eventos foram todos descartados **some da lista e do badge** — o
  agrupamento é derivado, e nada de estado novo nasce na oferta.
- Se um evento novo do mesmo `externalProductId` chegar, **a oferta reaparece
  sozinha**: descartar decide sobre entregas, não sobre produtos.

### Documentação

- `docs/TESTING.md` registra o que o botão *"Testar Webhook"* da Kiwify testa e o
  que não testa: ele exercita **intake e assinatura** (foi ele que provou, na
  sessão de 2026-08-04, que o `401` acabou depois do acerto do Token), **não** o
  fluxo completo — e cada disparo cria uma pendência que só o descarte resolve.

## Fora de escopo

- **Descarte em lote** (seleção múltipla ou por filtro) — decisão #2. Volta se a
  operação real mostrar que uma a uma não escala.
- **Reconhecer evento de teste no intake** — decisão #4. A reincidência do botão
  *Testar Webhook* fica registrada como pendência conhecida: cada teste futuro
  exige um descarte.
- **Estado próprio na oferta** (*"não mapear este produto"*), que faria eventos
  futuros já entrarem descartados. Seria uma segunda tabela de decisão sobre a
  mesma coisa.
- **Histórico completo de descartes/reaberturas.** As colunas guardam o **último**
  ato; um segundo descarte sobrescreve. Auditoria multi-evento é tabela própria,
  e nenhuma necessidade a pediu.
- Delete de linha, em qualquer forma — ver *O problema, medido*.
- `MailDelivery`, `LicOfferMapping` e o restante do ciclo da SPEC-038, que não
  mudam.

## Critérios de aceite

- [ ] Descartar uma entrega `FAILED` com motivo → `status=DISCARDED`,
      `discardedAt`/`discardedBy`/`discardedReason` gravados, **`error` original
      preservado**, e a linha **some** do filtro `FAILED`.
- [ ] Descartar **sem motivo** (ausente, vazio ou só espaços) → `422`, nada
      gravado.
- [ ] A entrega descartada **carrega `processedAt`**: um `DISCARDED` com
      `processed_at = NULL` é **recusado pelo banco** (`23514`, CHECK
      `lic_webhook_events_processed_coherent`). Há teste contra Postgres real que
      prova a recusa — se ele parar de falhar, a guarda caiu.
- [ ] O filtro `Descartadas` lista as entregas descartadas, com autor, data e
      motivo visíveis na linha.
- [ ] **Reprocessar não aparece** em linha `DISCARDED`; chamar
      `POST /webhook-events/:id/reprocess` num evento descartado responde `409`
      com mensagem que aponta o *Reabrir*.
- [ ] **Reabrir** devolve a `PENDING`, **limpa `processedAt` e `error`**, grava
      `reopenedAt`, e o job processa — a entrega volta a `FAILED` ou vira licença,
      conforme o mapeamento exista ou não.
- [ ] **Cadastrar o mapeamento e reabrir emite a licença** — o caminho de volta é
      real, não teórico.
- [ ] Reabrir um evento **nunca descartado** → `409`, nada gravado
      (CHECK `reopened_at IS NULL OR discarded_at IS NOT NULL` como rede de
      segurança do banco).
- [ ] Descartar de novo um evento reaberto **zera `reopenedAt`** e regrava o
      carimbo de descarte.
- [ ] **As 6 ofertas do dogfooding somem**: descartados os eventos, a aba
      *Oferta → edição* fica vazia e o badge laranja apaga — **sem `DELETE` no
      banco**, e com os 6 payloads ainda consultáveis no filtro `Descartadas`.
- [ ] Um evento novo do **mesmo `externalProductId`** de uma oferta já esvaziada
      faz a oferta **reaparecer** na lista.
- [ ] Descartar **não** toca em licença nenhuma: entrega `PROCESSED` que já emitiu
      licença **não pode** ser descartada → `409` (descartar é para o que não
      virou nada; esconder uma venda que virou licença perderia o elo).
- [ ] RLS: o descarte de um tenant não enxerga nem altera entrega de outro —
      exercido em int-spec contra Postgres real.
- [ ] `docs/TESTING.md` diz o que o botão *"Testar Webhook"* testa e o que não
      testa.
- [ ] `build`, `lint` e `test` verdes; arch-spec de fronteira mantida.

## Contratos

### Admin

```
POST /licensing/admin/webhook-events/:id/discard   { reason: string }   → 200 { discarded: true }
POST /licensing/admin/webhook-events/:id/reopen                         → 200 { enqueued: true }
GET  /licensing/admin/webhook-events?status=DISCARDED
```

`422` motivo ausente/vazio · `409` evento `PROCESSED` (descartar), evento não
`DISCARDED` (reabrir), evento `DISCARDED` (reprocessar) · `404` fora do tenant.

`GET /webhook-events` e `GET /webhook-events/:id` passam a devolver
`discardedAt`, `discardedBy`, `discardedReason` e `reopenedAt`.

### Modelo (deltas)

```prisma
enum LicWebhookStatus { PENDING PROCESSED FAILED IGNORED DISCARDED }

model LicWebhookEvent {
  // … campos da SPEC-038, inalterados
  discardedAt     DateTime? @map("discarded_at")
  discardedBy     String?   @map("discarded_by")
  discardedReason String?   @map("discarded_reason")
  reopenedAt      DateTime? @map("reopened_at")
}
```

CHECKs novos:

- `lic_webhook_events_discard_explained` — `status <> 'DISCARDED' OR
  (discarded_at IS NOT NULL AND length(btrim(COALESCE(discarded_reason,''))) > 0)`
- `lic_webhook_events_reopen_after_discard` — `reopened_at IS NULL OR
  discarded_at IS NOT NULL`

O CHECK `lic_webhook_events_processed_coherent` **não muda** — e é justamente por
isso que `DISCARDED` precisa carimbar `processed_at`.

Nada mais muda no schema da SPEC-038. Migration é ampliação de domínio (valor novo
no enum + colunas nullable): **toda linha existente continua válida**, sem
migração de dados.

## Notas técnicas

- **A armadilha do CHECK.** `lic_webhook_events_processed_coherent` afirma
  `(status = 'PENDING') = (processed_at IS NULL)`. Descartar sem gravar
  `processedAt` viola o CHECK e devolve `500` na tela — **exatamente o
  [#216](https://github.com/RodReis/rrb-proplan/issues/216)**, onde o `reprocess`
  voltava a `PENDING` sem limpar a data. O mesmo par de testes de banco daquela
  correção se aplica aqui, espelhado: um provando que `DISCARDED` **com** data é
  aceito, outro provando que **sem** data é recusado. Mock de Prisma não tem
  CHECK — só Postgres real pega esta classe de erro.
- **Descartar não é `IGNORED`.** `IGNORED` é a máquina dizendo *"este tipo não me
  diz respeito"* no intake, sem autor. `DISCARDED` é uma pessoa dizendo *"esta
  entrega não vai virar nada"*, com nome e motivo. Reaproveitar `IGNORED` para o
  ato humano apagaria a distinção que a issue pede — e a trilha deixaria de
  responder *quem*.
- **Por que colunas e não `LicEvent`.** `LicEvent.licenseId` é `NOT NULL`
  (`schema.prisma:1762`). O evento que mais precisa de descarte é o que **não tem
  licença** — a venda que nunca virou nada. Afrouxar aquela coluna para caber
  este caso mudaria a semântica da trilha da licença por conveniência de outra
  tabela.
- **Reabrir passa pelo job, como o reprocessar.** A rota não decide desfecho: ela
  devolve a `PENDING` e enfileira. Processar dentro da request foi recusado na
  SPEC-038 (*"receber ≠ processar"*) e a razão não mudou.
- **`PROCESSED` não se descarta.** A entrega que virou licença é o elo entre a
  venda e a chave emitida; escondê-la da lista quebraria a pergunta *"de onde veio
  esta licença"* — e ela nem aparece em pendências, então não há problema a
  resolver.
- **O botão *Testar Webhook* continua útil, e continua sujando.** Ele testa
  intake e assinatura — foi como se provou, em 2026-08-04, que o `401` acabou
  depois do acerto do Token. Cada disparo futuro custa um descarte. **Isto é
  dívida aceita**, não descuido: reconhecer o teste no intake exigiria heurística
  sobre payload, e heurística que engole venda real é pior que uma lista suja
  (decisão #4).
- Relacionadas: [#253](https://github.com/RodReis/rrb-proplan/issues/253)
  (SMTP + log da falha) e
  [#254](https://github.com/RodReis/rrb-proplan/issues/254) (entregas de e-mail
  invisíveis em Pendências) — mesma aba, problemas distintos.

## Decisões do PI (2026-08-04)

Nenhuma pergunta aberta. As quatro que bloqueavam foram resolvidas:

1. **Reversível por ato explícito.** Descartado sai da lista e perde o
   *Reprocessar*; volta pelo *Reabrir*, com carimbo próprio. Dois atos
   deliberados, não um efeito colateral.
2. **Uma linha por vez.** Sem lote nesta fatia. Seis descartes em seis cliques é
   irritante uma vez, não recorrente — e lote encoraja descartar sem ler, que é o
   que a trilha existe para impedir.
3. **A oferta some quando não sobra evento ativo.** O agrupamento passa a contar
   só entregas não descartadas; zerando, a oferta sai da lista e do badge, e
   reaparece sozinha se um evento novo do mesmo produto chegar. Sem estado novo
   na oferta.
4. **Só descarte manual, por ora.** Nada de classificar evento de teste no
   intake. A reincidência fica registrada como pendência conhecida.

### Pendências que não bloqueiam esta fatia

- **Descarte em lote** — reabrir se a operação real mostrar que uma a uma não
  escala.
- **Reconhecer o evento de teste no intake** — depende de haver marcador
  confiável no payload da Kiwify; sem ele, não se faz.
