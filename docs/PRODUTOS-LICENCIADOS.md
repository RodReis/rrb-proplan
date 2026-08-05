# PRODUTOS-LICENCIADOS.md — o que é preciso para um produto vender sozinho

> **Natureza deste documento.** Registro **operacional**, escrito pelo Claude Code
> em 2026-08-05 a pedido do PI, a partir da verificação ponta a ponta feita em
> produção no dogfooding da Fatia 36 (SPEC-047). Ele descreve **o que existe e
> foi conferido** — não normatiza processo.
>
> **A normação é do Cowork + PI.** Onde este texto disser *"hoje é assim"*, é
> constatação; onde uma regra precisar ser **decidida**, o documento aponta a
> pergunta em vez de responder. Ver `CLAUDE.md` §Papéis.
>
> **Fonte da verdade continua sendo o código e os ADRs.** Este arquivo é o mapa;
> quando divergir do código, o código vence e o mapa se corrige.

---

## Para que serve

Um produto licenciado só vende sozinho quando **sete elos** estão de pé. Nenhum
deles é difícil; o problema é que **três falham em silêncio** — a venda entra, o
dinheiro cai, e o comprador não recebe o que pagou, sem erro em lugar nenhum.

Este documento existe para que o segundo produto não redescubra isso pelo mesmo
caminho que o primeiro: uma compra real falhando.

---

## A cadeia: da compra ao produto na mão do cliente

```
1. venda na plataforma
        ↓  webhook
2. POST /licensing/v1/webhooks/kiwify/:tenantSlug   ← assinatura validada
        ↓  grava LicWebhookEvent + enfileira (BullMQ)
3. worker: parse do payload → product_id / offer_id
        ↓  de-para (LicOfferMapping)
4. resolve a EDIÇÃO que a compra entrega
        ↓
5. emite a licença (chave assinada) + grava LicEvent
        ↓
6. enfileira o e-mail: chave + link de download + manual
        ↓  só se a edição concede código-fonte
7. agenda o convite ao repositório (compra + 8 dias)
```

**O passo 7 tem uma ressalva importante** — ver §*O que ainda não é automático*.

### Onde cada elo pode quebrar

| # | elo | como falha | é visível? |
|---|---|---|---|
| 1 | webhook cadastrado na plataforma | evento nunca chega | **não** — silêncio total |
| 2 | `webhookSecret` correto | `401` em toda entrega | sim, no log; **não** no admin |
| 3 | de-para da oferta | entrega vira `FAILED` | **sim** — aba *Oferta → edição* |
| 4 | edição existe e tem limites | `FAILED` na entrega | sim |
| 5 | `LICENSING_SIGNING_KEY/KID` | licença não pode ser assinada | sim, erro no boot |
| 6 | `MAIL_PROVIDER` + `SMTP_*`/`RESEND_*` | e-mail não sai | sim, `mail_deliveries` |
| 7 | `grantsSourceAccess` + PAT + `sourceRepo` | **convite nunca sai** | **não** — o pior caso |

Os três marcados como invisíveis são os que já morderam: o #1 e o #2 na SPEC-038,
o #7 no FIX #214.

---

## Checklist de onboarding de um produto novo

Derivado do que foi verificado no War Room. **Não é norma** — é a sequência que
funcionou; quem a transformar em regra é o PI.

### Na plataforma de venda (hoje: Kiwify)

- [ ] **Produto criado e `Ativo`**. Produto pausado não aparece no catálogo do
      ProPlan — o sync filtra `status != active` fora, de propósito: não há
      compra futura a proteger.
- [ ] **Webhook apontando para o ProPlan**, com os eventos que importam
      marcados. Um webhook por tenant — ver §*Uma armadilha da Kiwify*.
- [ ] **API key com escopo *Produtos*** (Apps → API), se quiser o aviso
      preventivo de de-para faltando (SPEC-047).

### No ProPlan — aba *Produtos e Edições*

- [ ] **Produto cadastrado** com `slug`, nome e **prefixo de chave** (2–6 letras
      maiúsculas — ele aparece na chave que o cliente digita, ex.: `WR-…`).
- [ ] **Uma edição por coisa vendida.** A edição é o que a licença carrega:
      `maxMachines`, `updatesMonths`, `billingModel` e **se dá código-fonte**.
- [ ] **`dá acesso ao código-fonte`** marcado **só** na edição que realmente
      entrega o repo. Marcar errado entrega source a quem não comprou;
      desmarcar errado deixa quem pagou mais sem receber.
- [ ] **Link de download e do manual** preenchidos. Vazio não quebra: o e-mail
      **omite o bloco** em vez de mandar link quebrado (SPEC-042).
- [ ] **`sourceRepo`** no formato `dono/nome` (sem URL), se alguma edição vende
      código-fonte.

### No ProPlan — aba *Configurações*

- [ ] **Segredo do webhook** — o Token que a plataforma gera. **Sem ele, toda
      entrega responde `401`** e nenhuma venda vira licença.
- [ ] **PAT do GitHub** (só se vende código-fonte): fine-grained, com
      `administration:write` **e** `contents:read`, restrito ao repo do produto.
      **Use *Testar conexão*** — PAT fine-grained expira, e a expiração é muda.
- [ ] **Credenciais da API da Kiwify** (opcional): os três valores de
      Apps → API. Sem eles nada quebra; o que se perde é o aviso **antes** da
      primeira venda.

### No ProPlan — aba *Oferta → edição*

- [ ] **Cada oferta ativa mapeada para uma edição.** Com as credenciais da API
      configuradas, o bloco *"Nunca vendeu, sem de-para"* mostra o que falta
      **antes** de alguém comprar. Sem elas, a lacuna só aparece quando uma
      venda falha.
- [ ] **A escolha da edição é sempre humana** (decisão PI, SPEC-047 §Objetivo).
      O sistema detecta e pré-preenche produto e oferta; quem decide qual edição
      recebe a oferta é o operador. A razão é o caso real: duas ofertas do mesmo
      produto, **uma entrega código-fonte**, e uma regra automática acertaria o
      produto e poderia errar a edição.

### Verificação final

- [ ] **Compra de teste real** (não o botão *Testar Webhook* — ver a armadilha
      abaixo). A entrega deve ficar `PROCESSED` com licença, e o e-mail sair.

---

## Variáveis de ambiente que o licenciamento exige

Conferidas em produção (Railway, serviço `@proplan/api`) em 2026-08-05.

| variável | para quê | sem ela |
|---|---|---|
| `LICENSING_SIGNING_KEY` | assina o license file | **nenhuma licença é emitida** |
| `LICENSING_SIGNING_KID` | id da chave, viaja no arquivo | idem |
| `TOKEN_ENCRYPTION_KEY` | cifra `githubPat` e `kiwifyClientSecret` | credenciais não gravam |
| `MAIL_PROVIDER` | `smtp` ou `resend` | e-mail não sai |
| `MAIL_FROM` | remetente | idem |
| `SMTP_HOST/PORT/USER/PASS/SECURE/FROM` | quando `MAIL_PROVIDER=smtp` | idem |
| `REDIS_URL` | fila BullMQ (ADR-004) | evento não processa |
| `DATABASE_URL` | o óbvio | tudo |

**A chave de assinatura é única do ambiente, não do produto.** Produto novo não
precisa de chave nova — a edição e o produto viajam **dentro** do license file.

---

## O caso real: War Room (verificado em 2026-08-05)

Serve de exemplo trabalhado, não de template a copiar.

**No ProPlan:** 1 produto (`warroom`, prefixo `WR-`), 2 edições:

| edição | slug | código-fonte | licenças |
|---|---|---|---|
| Sem código Fonte | `war-room` | não | 7 |
| Com Código Fonte | `war-room-source` | **sim** | 2 |

**Na Kiwify:** 2 produtos ativos — *NEXUS War Room — Edição Binário* (R$ 39,99) e
*NEXUS War Room — Source Code* (R$ 129,99).

**A assimetria é normal e é o que o de-para existe para resolver:** 1 produto com
2 edições aqui, 2 produtos lá. O que casa os dois lados é o `LicOfferMapping`.

**Os ids canônicos** (lidos na URL de edição da dashboard da Kiwify — a fonte que
resolveu a dúvida do dogfooding):

| produto na Kiwify | id | mapeado para |
|---|---|---|
| Edição Binário | `a3d7e940-9022-11f1-9979-1b627b11857b` | `war-room` |
| Source Code | `27e6ac80-9023-11f1-b628-31f0b9ff0ecc` | `war-room-source` |

**O uuid do webhook e o da API pública são o mesmo** — provado nesse dogfooding,
e era o critério de aceite que a SPEC-047 mandava parar se falhasse.

---

## Duas armadilhas que custaram caro

### 1. O botão *Testar Webhook* suja o de-para

Cada disparo do *Testar Webhook* da Kiwify gera um **`product_id` fictício e
diferente**. Eles chegam como entrega real, ficam `FAILED` por falta de de-para,
e a tentação é mapeá-los para "resolver a pendência".

**Não mapeie.** Mapear um id que não existe cria um de-para permanente que nunca
mais resolve venda nenhuma — e a lista fica com resíduo indistinguível do
legítimo. Foi assim que o War Room acumulou **três de-paras órfãos**, removidos
só em 2026-08-05.

O caminho certo para entrega de teste é **Descartar** (SPEC-045), que marca
`DISCARDED` sem apagar a trilha do payload.

**Como saber se um id é real:** abra o produto na dashboard da plataforma e leia
o id **na URL**. É prova direta e leva 30 segundos. **Não deduza por formato de
uuid** — a diferença entre v1 e v4 *sugere*, mas o custo de errar é entregar
código-fonte a quem comprou a edição sem.

### 2. Um webhook por tenant, não por produto

O `webhookSecret` é **1:1 com o tenant**. Criar um webhook por produto na Kiwify
gera **dois tokens diferentes**, e só um pode estar gravado — o outro passa a
falhar com `401`.

Use **"Todos que sou produtor"** no campo *Produtos* do webhook.

---

## O que ainda **não** é automático

Registro honesto do que depende de gente hoje.

### ~~O convite ao repositório espera um clique~~ — resolvido na Fatia 37

**Deixou de ser verdade em 2026-08-05** (SPEC-048, issue #276). O convite agora
sai sozinho por dois caminhos: rodada diária às **4 h** (`source-reconcile`) e
gatilho **por evento** ao gravar o username — quem responde depois do 8º dia
entra em segundos. O sweep de expiração (`expiry-sweep`, **5 h**) idem: até
então ele existia, era testado, e **nenhum código o chamava**.

**O prazo de 8 dias continua valendo, e nenhum dos dois gatilhos o fura.** Quem
compra hoje só entra no repositório em 8 dias — inclusive clicando no botão do
admin, que sempre chamou a mesma rodada. O filtro `sourceInviteAt <= agora` é a
única guarda, e é deliberado que seja uma só.

**O que continua dependendo de gente:** licença em `FAILED` **não é retentada
automaticamente** (decisão PI, SPEC-048). A causa é quase sempre configuração —
PAT expirado, `sourceRepo` errado —, e retentar sozinho martelaria o GitHub a
cada rodada, sempre falhando, esvaziando de sentido a lista de pendências. O
botão *reemitir* é o caminho, e ele devolve `FAILED → PENDING`.

### O comprador não é avisado de que espera 8 dias

Com o convite automático, *"sai no dia 8"* virou **promessa operacional** — e
hoje **nem o e-mail da compra nem o checkout dizem isso ao comprador**. Antes o
atraso era invisível porque não havia promessa; agora um job parado por uma
semana é falha percebida pelo cliente.

A SPEC-048 registra a lacuna e a põe **fora de escopo**: escrever esses textos é
fatia própria. Mitigação que já existe: a lista de pendências do admin mostra
`PENDING` vencido — ela deixa de ser o único caminho e passa a ser o alarme.

### Cancelar assinatura não remove o colaborador do repositório

**Lacuna conhecida, registrada aqui por decisão do PI (2026-08-05).** O
`cancelar()` grava o evento do ciclo, e o colaborador **permanece no
repositório**. Não virou fatia porque **assinatura é outro produto** — o War
Room é compra única, e o piloto não vende source por assinatura.

Volta como fatia própria **se e quando** algum produto vender código-fonte em
regime de assinatura. Até lá, o caminho é a revogação manual pelo admin.

### A tela não distingue de-para vivo de resíduo

Todos os mapeamentos aparecem iguais. Foi preciso ir à dashboard da Kiwify para
saber quais dos cinco eram reais. Marcar a origem (veio de venda / veio da API /
digitado à mão) resolveria — **é decisão de produto**, volta como fatia se a
operação sentir falta.

---

## Outra plataforma além da Kiwify

**Onde ela entraria**, para quem for implementar:

- `LicWebhookEvent.platform` e `LicOfferMapping.platform` são **TEXT, não enum**
  (SPEC-038) — plataforma nova **não pede migration**.
- O parser do payload é função pura em `domain/` (`kiwify-event.ts`): recebe o
  corpo bruto, devolve `{ action, saleRef, customerEmail, externalProductId, … }`.
  Outra plataforma é **outro arquivo ao lado**, não um `if` dentro deste.
- O client HTTP do catálogo é `infrastructure/kiwify-catalog.client.ts`, atrás de
  interface própria — mesma fronteira.
- A validação de assinatura é `domain/webhook-signature.ts`.

**O que este documento NÃO faz:** descrever como Hotmart, Lemon Squeezy ou
qualquer outra funcionam. Não foram lidas, e escrever isso seria ficção. Quando
a segunda plataforma existir, ela ganha sua seção **com o mesmo nível de prova**
que a Kiwify tem aqui — ids conferidos, cadeia verificada em produção.

O mapeamento de ação por tipo de evento, hoje, é:

| tipo (Kiwify) | ação | efeito |
|---|---|---|
| `order_approved` | `issue` | emite licença + e-mail |
| `order_refunded` | `revoke` | revoga + e-mail |
| `chargeback` | `revoke` | revoga + e-mail |
| `subscription_renewed` | `renew` | estende `expiresAt`, limpa `pastDueAt` |
| `subscription_late` | `past_due` | marca atraso, **mantém** acesso |
| `subscription_canceled` | `cancel` | encerra ao fim do período |
| qualquer outro | `ignore` | `IGNORED`, **não** é falha |

**`ignore` não é erro, e isso é desenho:** a plataforma acrescenta tipos sem
avisar, e tratar o desconhecido como falha encheria a lista de pendências de
coisas sem conserto.

---

## Relacionados

- `docs/ARCHITECTURE.md` — módulos, RLS, resiliência
- `docs/DECISIONS.md` — **ADR-004** (BullMQ), **ADR-015** (dois tokens do GitHub
  App), **ADR-020** (RLS nas `lic_*`), **ADR-028** (artefato na Release),
  **ADR-029** (o agendador)
- `docs/specs/SPEC-036` (licença e chave) · **038** (webhook e ciclo) ·
  **039** (código-fonte) · **041** (releases) · **042** (o e-mail entrega a
  compra) · **043** (relatos de erro) · **045** (descarte) · **046** (venda
  parada vs. de-para) · **047** (catálogo preventivo)
- `docs/DEPLOY.md` — runbook de produção
