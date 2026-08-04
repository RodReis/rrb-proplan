---
proplan: v1
spec: SPEC-046
fatia: 35
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-08-04
---
# SPEC-046 — Licensing: a lista de ofertas separa *venda parada* de *de-para faltando*

> Nasce do dogfooding em produção da SPEC-045 (2026-08-04), registrado no
> comentário de encerramento da issue
> [#257](https://github.com/RodReis/rrb-proplan/issues/257#issuecomment-5183763233).
> **Não é `[FIX]`**: nem a SPEC-038 nem a SPEC-045 dizem o que a lista deve fazer
> com entrega já processada — não há comportamento correto escrito a restaurar.

## Objetivo

A aba *Oferta → edição* para de pedir ação sobre venda que já foi entregue — e
**sem esconder** que aquele produto continua sem de-para, o que faria a próxima
compra falhar sem aviso.

## O problema, medido

Descartadas as 3 entregas de teste, o badge de Pendências ficou limpo — **nenhum
`FAILED` sobrou** — e a aba *Oferta → edição* continuou marcando
`3 SEM MAPEAMENTO`. As três (`dcec8ed0`, `db097001`, `2567aaf0`) são `PROCESSED`
**com licença emitida**.

`ofertasNaoMapeadas` agrega **toda** entrega não descartada e cruza com
`LicOfferMapping`. Sem linha de de-para, a oferta entra na lista — mesmo que a
entrega tenha desfecho e a venda tenha sido entregue.

**A tela pede uma ação já resolvida**, e o modo de errar é pior que o badge sujo:
mapear é plausível, e o operador não tem como saber que aquela venda já foi. É a
mesma *"pendência sem conserto"* que a SPEC-045 veio eliminar, por outra causa.

### Como uma entrega vira `PROCESSED` sem de-para — dois caminhos, ambos legítimos

1. **Curto-circuito por `saleRef`.** `WebhookProcessorService.emitir` procura
   licença com o mesmo `saleRef` **antes** de chamar `resolverEdicao`; achando,
   devolve o id e sai. É a guarda anti-emissão-dupla, e o
   `license-admin.service.ts` já a documenta: *"o webhook da plataforma é a
   SPEC-038 — é lá que `saleRef` deixa de ser nulo e vira a idempotência da
   reentrega"*. Licença emitida à mão com o `saleRef` da venda ⇒ a entrega
   processa **sem nunca olhar o mapeamento**.
2. **Evento que não é compra.** `revoke`, `renew`, `past_due` e `cancel` resolvem
   a licença por `encontrar()` (`saleRef` → `subscriptionId` → e-mail) e **nunca**
   tocam no de-para. Reembolso de uma licença emitida à mão processa igual.

Some-se um terceiro caso sem rastro: **de-para removido depois** de a entrega ter
processado.

## Escopo

### A lista responde uma pergunta por bloco

Hoje uma linha só responde duas coisas — *"esta venda está parada"* e *"este
produto não tem de-para"* —, e é essa fusão que produz o alarme mentiroso. A aba
passa a ter **dois blocos**:

- **Venda parada agora** — ofertas com pelo menos uma entrega `PENDING` ou
  `FAILED`. **É o único que conta no badge** e o único com tom de atenção. Vem
  primeiro: é o que custa dinheiro parado.
- **Sem de-para, nada parado** — ofertas cujas entradas são todas `PROCESSED`
  (ou `IGNORED`). Tom neutro, **fora do badge**, com a frase que importa:
  *"as vendas que chegaram já foram entregues; sem o de-para, a **próxima**
  compra deste produto vai falhar"*.

### O que a linha afirma

- **A consequência, não a causa** (decisão PI #2). A spec **não** tenta dizer se
  veio de emissão manual, de evento de ciclo ou de de-para removido: as três
  produzem o mesmo fato verificável — **não há de-para hoje** — e inferir o
  passado exigiria heurística de datas sobre remoção que não deixa rastro.
- Cada linha continua trazendo `ocorrencias`, `falhas` e `ultimaEm`. Ganha
  `aguardando` (entregas `PENDING`) para a separação ser legível sem contas de
  cabeça.

### A ação continua, com a legenda certa

- **Mapear permanece nos dois blocos** (decisão PI #3). No bloco *sem de-para*,
  o texto diz em voz alta: *"esta venda já foi entregue; o de-para vale para as
  próximas"*. A ação sempre esteve certa — errada estava a legenda.
- O toast de sucesso do bloco *sem de-para* **não** manda reprocessar (não há o
  que reprocessar); diz que as próximas compras daquele produto passam a resolver
  sozinhas.

### Contagem no cartão

`N sem mapeamento` vira **duas** etiquetas: `N venda parada` (tom `atencao`, só
quando `N > 0`) e `M sem de-para` (tom `neutro`). O tom do cartão inteiro passa a
seguir **só** o primeiro número — hoje ele fica laranja por qualquer linha na
lista.

## Fora de escopo

- **Esconder `PROCESSED`** — recusado: escondê-lo faria a próxima venda daquele
  produto falhar sem aviso prévio (decisão PI #1).
- **Distinguir a causa** do `PROCESSED` sem de-para, em qualquer forma — inclusive
  carimbar quem removeu um `LicOfferMapping` (decisão PI #2). Volta como fatia
  própria se a operação provar que a consequência não basta.
- **Avisar no processamento.** O curto-circuito por `saleRef` continua marcando
  `PROCESSED` em silêncio quando não há de-para; quem passa a contar a verdade é
  a lista (decisão PI #4). Sem coluna nova, sem segundo lugar afirmando a mesma
  coisa.
- Mudança no `WebhookProcessorService`, no schema ou em qualquer rota de
  webhook. **Esta fatia é de leitura e de tela.**
- O `error` de entrega, o descarte e o *Reabrir* da SPEC-045, que não mudam.

## Critérios de aceite

- [ ] Oferta com entrega `FAILED` aparece em **Venda parada agora**, com tom de
      atenção, e **conta** na etiqueta `venda parada`.
- [ ] Oferta cujas entregas são **todas `PROCESSED`** aparece em **Sem de-para,
      nada parado**, em tom neutro, e **não** entra na etiqueta `venda parada`.
- [ ] Oferta com **uma** entrega `FAILED` e **três** `PROCESSED` aparece **só** em
      *Venda parada agora* — uma oferta nunca sai nos dois blocos.
- [ ] O cartão *Oferta → edição* fica **neutro** quando só há linhas do 2º bloco,
      e de **atenção** assim que existe uma do 1º.
- [ ] **O caso do dogfooding**: com `dcec8ed0`, `db097001` e `2567aaf0` em
      `PROCESSED` com licença e sem de-para, a aba **não** marca `3 sem
      mapeamento` em laranja — as três aparecem no bloco neutro, com a frase de
      vendas futuras.
- [ ] Entregas `DISCARDED` continuam **fora** dos dois blocos (SPEC-045 mantida).
- [ ] `IGNORED` não cria bloco novo: agrupa com `PROCESSED` no 2º bloco.
- [ ] **Mapear funciona nos dois blocos** e cria o mesmo `LicOfferMapping`; no 2º
      bloco a confirmação diz que o efeito é sobre **vendas futuras**, e **não**
      sugere reprocessar.
- [ ] Mapeada a oferta, ela **sai dos dois blocos** — o de-para existente já a
      remove hoje, e continua removendo.
- [ ] Um evento `FAILED` novo de um produto que estava no 2º bloco **move** a
      oferta para o 1º e acende o badge.
- [ ] A regra da separação é testada como **função pura** (`domain/seen-offers.ts`),
      sem banco — mesmo corte de `ofertasNaoMapeadas`.
- [ ] `build`, `lint` e `test` verdes; arch-spec de fronteira mantida.

## Contratos

### `GET /licensing/admin/seen-offers`

Sem mudança de rota. `OfertaVista` ganha dois campos:

```ts
export interface OfertaVista {
  externalProductId: string;
  externalOfferId: string | null;
  ocorrencias: number;
  falhas: number;
  aguardando: number;                    // novo — entregas PENDING
  situacao: 'PARADA' | 'SEM_DEPARA';     // novo — derivado, nunca persistido
  ultimaEm: Date;
}
```

`situacao = 'PARADA'` quando `falhas + aguardando > 0`; `'SEM_DEPARA'` caso
contrário. **É derivação de leitura** — não vira coluna, não vira estado no
banco, e some se a regra mudar.

Ordem: `PARADA` primeiro (por falhas, depois pela entrega mais recente, como
hoje); `SEM_DEPARA` depois, pela mais recente.

### Schema

**Nenhum delta.** Nem enum, nem coluna, nem migration.

## Notas técnicas

- **Nada disto vira estado.** A tentação é marcar a oferta como *"já resolvida"*
  no banco. Seria a segunda tabela de decisão que a SPEC-045 já recusou
  (decisão #3 de lá): a verdade é derivável das entregas e do de-para, e derivada
  ela nunca desatualiza.
- **Por que a consequência é melhor que a causa.** *"Não há de-para hoje, logo a
  próxima compra por webhook deste produto vai falhar"* é verdadeira nos três
  caminhos e verificável na hora. Qualquer frase sobre o passado (*"veio de
  emissão manual"*) depende de inferência que a remoção silenciosa de um
  `LicOfferMapping` já quebra.
- **A separação mora na função pura.** `ofertasNaoMapeadas` já é pura justamente
  para que a regra de leitura seja testável sem banco (comentário do
  `seen-offers.ts`). A `situacao` entra ali, não no service.
- **`PENDING` entra em *parada*, não em *nada parado*.** Uma entrega esperando o
  job ainda pode falhar por de-para ausente; classificá-la como resolvida
  afirmaria desfecho que não houve.
- **O silêncio no processamento continua** e está registrado como dívida: quando
  o curto-circuito por `saleRef` dispara sem de-para, ninguém é avisado no ato.
  A aposta desta fatia é que a lista basta, porque é onde o operador já olha. Se
  não bastar, o aviso volta como fatia própria — **não** como remendo no
  `error`, que é campo de falha.
- Relacionadas: [#253](https://github.com/RodReis/rrb-proplan/issues/253) (SMTP +
  log da falha) e [#254](https://github.com/RodReis/rrb-proplan/issues/254)
  (entregas de e-mail invisíveis em Pendências) — mesma aba, problemas distintos.

## Decisões do PI (2026-08-04)

Nenhuma pergunta aberta. As quatro que bloqueavam foram resolvidas:

1. **Dois blocos, um badge só.** A lista responde duas perguntas com a mesma
   linha; separar é o conserto. *Esconder `PROCESSED`* foi recusado — faria a
   próxima venda falhar sem aviso.
2. **Não distinguir a causa; dizer a consequência.** Emissão manual, evento de
   ciclo ou de-para removido produzem o mesmo fato, e detectar qual foi exigiria
   heurística sobre um passado sem rastro.
3. **Mapear continua nos dois blocos**, com o efeito dito em voz alta. A ação
   estava certa; a legenda é que mentia.
4. **Só na tela, por ora.** O processador não muda. Se a lista não bastar, o
   aviso no processamento volta como fatia própria.

### Pendências que não bloqueiam esta fatia

- **Aviso no momento do processamento** — reabrir se a lista se provar
  insuficiente.
- **Trilha de remoção de `LicOfferMapping`** — pré-requisito de qualquer
  detecção de causa, se um dia ela for pedida.
