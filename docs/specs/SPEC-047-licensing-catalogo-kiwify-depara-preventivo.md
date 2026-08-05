---
proplan: v1
spec: SPEC-047
fatia: 36
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi
updated: 2026-08-04
---
# SPEC-047 — Licensing: o catálogo da Kiwify expõe a oferta sem de-para **antes** da primeira venda

> Nasce do dogfooding da compra real do War Room (2026-08-04): a venda da oferta
> *Sem código Fonte* falhou com `order_approved` porque o de-para não existia —
> corrigido e reprocessado pelo caminho previsto, mas **a lacuna só apareceu
> quando alguém pagou**. A SPEC-046 conserta o que a lista diz sobre ofertas que
> **já venderam**; esta fatia faz a lista enxergar as que **ainda não venderam**.
> **Não é `[FIX]`**: nenhum documento define comportamento para oferta que nunca
> apareceu em webhook — havia decisão de produto a tomar, e foi tomada (abaixo).

## Objetivo

O operador vê **qual oferta do catálogo da Kiwify não tem de-para** sem esperar
uma venda falhar — e sem precisar lembrar de olhar: um job diário mantém o
retrato atual e a lacuna se anuncia no cartão. O clique em *Mapear* passa a
acontecer no cadastro da oferta, não no socorro à venda parada.

**O que NÃO se automatiza: a escolha da edição** (decisão PI #4). O job detecta
e pré-preenche; quem decide qual `LicEdition` recebe a oferta é sempre o humano.
A razão é o próprio caso que abriu esta fatia: as duas ofertas do War Room têm o
mesmo produto e **uma delas entrega código-fonte** — regra automática (nome,
preço, heurística) acertaria o produto e poderia errar a edição, entregando
source por e-mail irrevogável a quem pagou pela edição sem. E, por construção,
**toda linha da lacuna é um caso sem resposta derivável**: se houvesse cobertura
(curinga do produto), a linha nem existiria.

## O problema, medido

Hoje `ofertasNaoMapeadas` só conhece ofertas que **já apareceram em entrega de
webhook** — por construção (`domain/seen-offers.ts`: *"as ofertas que já
apareceram nas entregas da plataforma"*). Oferta criada na Kiwify ontem e ainda
sem venda é invisível para o ProPlan; a primeira compra dela é o primeiro aviso,
e o aviso é uma entrega `FAILED` com dinheiro do cliente no meio.

A Kiwify expõe o que falta (verificado em 2026-08-04, docs.kiwify.com.br):

- `GET https://public-api.kiwify.com/v1/products` — lista paginada de produtos
  (`id`, `name`, `status`, ...).
- `GET /v1/products/{id}` — detalhe com `offers[]` (`id`, `name`, `price`,
  `active`) — **a granularidade exata do `LicOfferMapping`**.
- Autenticação: OAuth client credentials — `POST /v1/oauth/token` exige
  `client_id` **e** `client_secret` (ambos obrigatórios; gerados em *Apps >
  API* na dashboard, junto do `account_id`). A doc pede para **não** gerar
  token por chamada; o texto fala em 96h mas o exemplo devolve
  `expires_in: 86400` (24h) — o cache respeita o `expires_in` da resposta.
  Toda rota exige também o header `x-kiwify-account-id`.
- Verificado na conta real (dashboard, 2026-08-04): a API key `warroom` existe
  desde 30/07/2026 com o escopo *Produtos* habilitado — configurar é colar os
  três valores.
- Rate limit: 100 req/min — folga larga para o volume do piloto.

## Escopo

### Credenciais no `LicSettings`

Três campos novos, **todos opcionais** — mesma lição do FIX #212: propósitos
independentes não se bloqueiam. Sem os três, nada muda: o job pula o tenant em
silêncio e o botão de busca aparece desabilitado com a dica de onde configurar.

- `kiwifyClientId     String? @map("kiwify_client_id")`
- `kiwifyClientSecret String? @map("kiwify_client_secret")`
- `kiwifyAccountId    String? @map("kiwify_account_id")`

Só o `client_secret` é segredo — na dashboard da Kiwify ele já aparece
mascarado, enquanto `client_id` e `account_id` são exibidos em claro. No
painel: o secret segue o padrão dos segredos existentes (`webhookSecret`,
`githubPat`) — write-only, nunca ecoado na leitura, string vazia recusada no
update; os outros dois são campos comuns, lidos de volta normalmente.
"Configurado" = os três presentes.

### Sincronização: job diário + botão (decisão PI #1, revisada)

- **Job diário** via **BullMQ repeatable job** (ADR-029, abaixo) — uma rodada
  por tenant com credenciais configuradas, de madrugada. Janela máxima de
  exposição: 24h entre criar a oferta na Kiwify e a lacuna aparecer.
- **Botão "Buscar ofertas da Kiwify"** na aba *Oferta → edição* continua
  existindo, para quem acabou de criar a oferta e não quer esperar. Os dois
  caminhos executam o **mesmo** fluxo de fetch e gravam o **mesmo** snapshot.
- O token OAuth é cacheado em Redis chaveado por tenant
  (`lic:kiwify:token:{tenantId}`), com TTL derivado do `expires_in` da resposta
  (menos margem) — a doc pede para não gerar por chamada, e o valor real
  (24h vs 96h) é contraditório na própria doc, então nunca hardcode. Trocar
  qualquer credencial no settings apaga a chave.

### O snapshot: cache de verdade externa, com carimbo

Com job, o resultado precisa sobreviver até alguém olhar — o efêmero morreu
junto com o manual. Entra **uma** tabela, e a natureza dela importa:

```prisma
model LicCatalogSnapshot {
  id        String   @id @default(uuid())
  tenantId  String   @unique @map("tenant_id")
  platform  String   // `kiwify` hoje; TEXT como no resto do módulo
  /// O catálogo como veio (produtos ativos + offers), SEM cruzamento com
  /// mapeamentos. O cruzamento é derivação de leitura, como na SPEC-046.
  payload   Json
  fetchedAt DateTime @map("fetched_at")
  /// Última falha de fetch, legível. Nula quando o último fetch deu certo.
  fetchError String? @map("fetch_error")
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@map("lic_catalog_snapshots")
}
```

**Cache, não tabela de decisão** — a distinção que as SPEC-045/046 policiam:
o snapshot guarda o que a Kiwify **disse**, com carimbo de quando; nunca guarda
conclusão (`coberta`, `situacao`, "resolvida"). O cruzamento com
`LicOfferMapping` e com as ofertas vistas é **derivado na leitura**, na função
pura — derivado, nunca desatualiza. Uma linha por tenant, sobrescrita a cada
rodada; sem histórico, porque o retrato de ontem não responde pergunta nenhuma.

Falha de fetch **não apaga** o snapshot anterior: grava `fetchError` e mantém o
último `payload` bom, com o `fetchedAt` antigo dizendo a idade.

### O terceiro bloco

A aba ganha **"Nunca vendeu, sem de-para"** (decisão PI #2), depois dos dois da
SPEC-046 — a estrutura continua *um bloco por pergunta*:

1. **Venda parada agora** — único no badge de **atenção** (SPEC-046, intacta).
2. **Sem de-para, nada parado** — vendeu, entregou, próxima falha (SPEC-046,
   intacta).
3. **Nunca vendeu, sem de-para** — vem do snapshot; tom neutro, com a frase:
   *"nenhuma venda chegou; sem o de-para, a primeira compra desta oferta vai
   falhar"* e o carimbo *"catálogo consultado em {fetchedAt}"*.

Regras do bloco 3:

- Entra a oferta do catálogo **sem cobertura** — nem mapeamento exato, nem
  curinga do produto (mesma regra de casamento de `seen-offers.ts`).
- Sai a oferta que **já aparece nos blocos 1 ou 2** — uma oferta nunca sai em
  dois blocos (invariante da SPEC-046, estendida ao terceiro).
- A linha mostra **nome do produto e nome da oferta** vindos da API — a
  primeira vez que o operador vê nomes humanos em vez de uuid transcrito.
- Oferta `active: false` e produto `status != active` **não entram**: não há
  compra futura a proteger. Sem opção de exibi-los — se a operação sentir
  falta, volta como fatia.
- **Mapear na linha**, criando o mesmo `LicOfferMapping` dos outros blocos —
  com produto e oferta já preenchidos, **e a edição escolhida à mão** (decisão
  PI #4). O toast diz que o efeito é sobre as **vendas futuras** (mesma legenda
  do bloco 2).
- Sem snapshot ainda (tenant recém-configurado, job não rodou): o bloco mostra
  o convite ao botão, não um vazio mudo.

### A lacuna se anuncia no cartão (decisão PI #3)

A etiqueta neutra `M sem de-para` do cartão (SPEC-046) passa a **somar os
blocos 2 e 3** — a pergunta que ela responde vira *"quantas ofertas conhecidas
não têm de-para"*, vendida ou não. O badge de **atenção** e o tom do cartão
continuam seguindo **só** o bloco 1: lacuna preventiva não é dinheiro parado, e
misturar os dois desfaria a separação que a SPEC-046 acabou de fazer.

### Fronteira de plataforma

O client HTTP nasce em `infrastructure/` atrás de interface própria
(`KiwifyCatalogClient`), como o resto do módulo — `platform` continua TEXT e a
fronteira do adapter é o que abre Hotmart/Lemon sem migration (SPEC-038,
mantida). Fetch nativo, como toda a integração GitHub (Octokit segue proibido —
CLAUDE.md §Stack).

## ADR-029 — BullMQ repeatable jobs como agendador do repo

**Decisão tomada nesta spec; texto no `DECISIONS.md` redigido pelo Code no
PR-1** — mesmo caminho dos ADR-026/027/028. O conteúdo decidido:

- O repo **passa a ter agendador**, e ele é **BullMQ repeatable jobs** — Redis
  e BullMQ já são o stack de jobs (ADR-004); zero dependência nova, sobrevive a
  múltiplas instâncias (o que `@nestjs/schedule` in-process não garante) e a
  fila é observável como qualquer outra.
- Primeiro consumidor: o sync diário desta spec. **Segundo, imediato: o purge
  de 90 dias da SPEC-043**, que está no Backlog esperando exatamente esta
  decisão — o Code o liga no mesmo PR ou em FIX subsequente citando o ADR-029
  (comportamento correto já documentado: retenção de 90 dias, SPEC-043).
- Todo repeatable job novo entra por este ADR — sem segundo mecanismo de
  agendamento no repo.

## Fora de escopo

- **Auto-mapear** — escolher a edição por regra, em qualquer forma (nome,
  preço, "só existe uma"). Ver §Objetivo; volta só como proposta escrita com os
  cenários de erro, se o PI pedir.
- **Alerta por e-mail quando `order_approved` falha** (decisão PI #3 da 1ª
  rodada) — problema distinto; segue como pendência registrada na SPEC-046.
- **Histórico de snapshots** — uma linha por tenant, sobrescrita. O retrato de
  ontem não responde pergunta nenhuma.
- **Criar/editar oferta na Kiwify** a partir do ProPlan — leitura, só.
- Mudança no `WebhookProcessorService`, nos blocos 1–2 ou em qualquer rota de
  webhook.

## Critérios de aceite

- [ ] Sem credenciais configuradas: job pula o tenant, botão desabilitado com
      dica, aba exatamente como a SPEC-046 a deixou.
- [ ] Com credenciais: o job diário grava o snapshot; o botão executa o mesmo
      fluxo e atualiza o mesmo snapshot na hora.
- [ ] O bloco 3 lista as ofertas do catálogo sem cobertura, com nome de
      produto e de oferta e o carimbo do `fetchedAt`.
- [ ] Oferta com mapeamento exato **ou** curinga do produto **não** aparece no
      bloco 3.
- [ ] Oferta presente nos blocos 1 ou 2 **não** repete no 3.
- [ ] Oferta inativa e produto não-ativo ficam fora.
- [ ] *Mapear* no bloco 3 exige escolher a edição, cria o `LicOfferMapping` e
      a linha some sem novo fetch; toast fala em vendas futuras, sem sugerir
      reprocessar.
- [ ] A etiqueta neutra do cartão soma blocos 2+3; o badge de atenção e o tom
      seguem **só** o bloco 1 — inclusive com o bloco 3 cheio.
- [ ] **O caso do dogfooding, invertido**: com o catálogo real do War Room
      (ofertas *Sem código Fonte* e *Com Código Fonte*), o sync mostra no
      bloco 3 exatamente a oferta ainda sem de-para — validando de quebra que o
      id do produto no webhook e na API pública são o mesmo uuid. **Se não
      forem, parar e reportar ao PI** — casar formatos por heurística é
      proibido.
- [ ] Falha da API (credencial inválida, 429, 5xx): `fetchError` gravado,
      snapshot anterior preservado, mensagem legível na aba com a idade do
      último retrato — blocos 1–2 nunca quebram.
- [ ] A regra do bloco 3 é **função pura** em `domain/` (mesmo corte de
      `seen-offers.ts`), testada sem banco e sem HTTP.
- [ ] O repeatable job aparece registrado uma única vez (sem duplicar a cada
      boot da API) e o texto do ADR-029 entra no `DECISIONS.md` no PR-1.
- [ ] `build`, `lint` e `test` verdes; arch-spec de fronteira mantida.

## Contratos

### `GET /licensing/admin/kiwify/catalog`

Novo. **Lê o snapshot** — nunca chama a Kiwify — e devolve o catálogo já
cruzado com os mapeamentos do tenant (cruzamento derivado na leitura):

```ts
export interface OfertaCatalogo {
  externalProductId: string;   // Product.id na Kiwify
  productName: string;
  externalOfferId: string;     // Offer.id — nunca nulo: a API lista ofertas concretas
  offerName: string;
  coberta: boolean;            // mapeamento exato OU curinga do produto
}

export interface CatalogoKiwify {
  ofertas: OfertaCatalogo[];   // só produtos/ofertas ativos
  fetchedAt: Date | null;      // null = nunca sincronizou
  fetchError: string | null;   // legível; snapshot anterior preservado
}
```

### `POST /licensing/admin/kiwify/catalog/refresh`

Novo — o botão. Executa o fetch agora (mesmo código do job), grava o snapshot
e devolve o mesmo `CatalogoKiwify`. `409` quando as credenciais não estão
configuradas (a tela nem chama — o botão está desabilitado — mas a rota não
pode depender disso); `502` com mensagem legível quando a Kiwify falhar.

### Schema — delta

```prisma
// LicSettings
kiwifyClientId     String? @map("kiwify_client_id")
kiwifyClientSecret String? @map("kiwify_client_secret")
kiwifyAccountId    String? @map("kiwify_account_id")

// nova
model LicCatalogSnapshot { ... }   // ver §O snapshot
```

Uma migration aditiva. `GET /licensing/admin/settings` devolve apenas flag de
presença (`kiwifyApiConfigured: boolean`), nunca os valores — padrão dos
segredos existentes.

## Notas técnicas

- **N+1 assumido e aceito**: `offers[]` só vem no detalhe do produto, então o
  fetch faz 1 + N chamadas. Com rate limit de 100/min, o teto prático é ~99
  produtos por rodada — ordens de grandeza acima do catálogo do piloto (2
  ofertas). Se um tenant futuro estourar isso, paginação com pausa é problema
  daquele dia, não deste.
- **Nenhuma chamada externa no caminho de renderização**: o painel lê snapshot
  (GET); a Kiwify só é consultada pelo job ou pelo clique explícito (POST).
  Mesmo princípio da regra de inferência do CLAUDE.md, aplicado a API externa.
- **O uuid do webhook e o da API precisam ser o mesmo.** Tudo indica que sim
  (ambos são o id canônico do produto/oferta na Kiwify), mas o critério de
  aceite exige a prova com o dado real do War Room antes de considerar a fatia
  entregue. Divergiu → PI decide, nunca heurística.
- **Idempotência do registro do job**: BullMQ repeatable é registrado por
  `jobId`/chave estável no boot — reiniciar a API não pode duplicar a rodada.
- Relacionadas: SPEC-046 (blocos 1–2 e a invariante *uma oferta, um bloco*),
  SPEC-043 (purge esperando o agendador — destravado pelo ADR-029), SPEC-038
  (fronteira de plataforma, `platform` TEXT), FIX #212 (segredos opcionais e
  independentes no `LicSettings`).

## Decisões do PI (2026-08-04)

Nenhuma pergunta aberta. Duas rodadas no mesmo dia — a segunda revisou a
primeira:

1. **Sync automático diário + botão manual** (revisão da decisão "só manual"
   da manhã). BullMQ repeatable (ADR-029); janela máxima de 24h; o botão cobre
   o "acabei de criar a oferta".
2. **Terceiro bloco na aba.** Um bloco por pergunta, e a pergunta nova é
   *"o que ainda nem vendeu?"*. Etiqueta de cobertura sem lista foi recusada:
   esconderia **qual** oferta falta, que é o dado acionável.
3. **A lacuna se anuncia na etiqueta neutra do cartão** (blocos 2+3 somados).
   Badge de atenção segue exclusivo do bloco 1 — preventivo não é dinheiro
   parado. E-mail de alerta continua fora (pendência da SPEC-046).
4. **Mapear é humano, sempre.** O job detecta e pré-preenche; a edição é
   escolhida à mão. Auto-mapear só volta como proposta escrita com cenários de
   erro documentados.

### Pendências que não bloqueiam esta fatia

- **Aviso no momento da falha de `order_approved`** — herdada da SPEC-046,
  segue aberta.
- **Ligar o purge da SPEC-043 no agendador** — destravada pelo ADR-029; é do
  Code (comportamento já documentado), no PR desta fatia ou em FIX próprio.
