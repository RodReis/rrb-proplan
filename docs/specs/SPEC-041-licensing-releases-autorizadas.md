---
proplan: v1
spec: SPEC-041
fatia: 30
status: aprovada-pi
updated: 2026-07-29
---
# SPEC-041 — Licensing: releases autorizadas por licença (`war-room update`)

## Objetivo

A máquina licenciada descobre e baixa a versão nova a que **tem direito**, sem
o dono mandar link por e-mail — e sem que um byte do instalador atravesse a API
do ProPlan.

## Contexto

O `war-room update` (§4 da `SPEC-build-fechado.md`, repo do War Room) supõe
*"mesma API de licenças, autoriza download se `updatesUntil >= versão.releasedAt`"*.
Essa rota **não existe**: o controller público tem `activate`, `heartbeat`,
`deactivate` e o webhook, nada mais. Esta fatia é o que falta para o piloto do
build fechado fechar — decisão do PI de 2026-07-29 de que `update` entra no
piloto.

## Escopo

1. **Modelo `LicRelease`**, pendurado em `LicProduct`: `version` (semver),
   `releasedAt`, `os` (`win-x64` no piloto), `assetId` do GitHub, `sha256`,
   `notes`, `published`.
2. **Tela no admin** (`t/:tenant/licensing`): registrar release à mão, listar
   por produto, despublicar. Sem upload de arquivo — o binário já está na
   Release privada do GitHub; aqui se registra o ponteiro.
3. **`POST /licensing/v1/releases/check`** — `licenseKey` + `fingerprint` →
   versão mais nova **autorizada** para aquela licença, com `sha256` e `notes`.
4. **`POST /licensing/v1/releases/download`** — devolve **URL assinada** de
   vida curta, obtida do GitHub. A API nunca serve os bytes.
5. **Autorização**: `updatesUntil >= release.releasedAt`, comparado contra o
   valor **da licença** (copiado na emissão), nunca contra
   `LicEdition.updatesMonths` — mudar a política da edição não pode encurtar a
   janela de quem já comprou.
6. **Rate limit por IP e por chave**, o mesmo das outras três rotas públicas.
7. **`LicEvent` por download autorizado** — auditoria de quem baixou o quê e
   quando.

## Fora de escopo

- **Publicação automática pelo CI do War Room** (decisão do PI: recusada nesta
  rodada). Exigiria token de máquina com escrita administrativa — superfície de
  autenticação nova dentro do módulo que guarda as licenças. Gatilho de
  revisão: passar de ~1 release por semana no piloto.
- **Upload de artefato pelo ProPlan.** O binário nasce e vive no GitHub; aqui
  só o ponteiro.
- Artefatos de macOS/Linux — o campo `os` existe, o piloto registra só
  `win-x64` (decisão do PI, plano do piloto).
- Troca do binário na máquina do cliente, verificação local do SHA256, aviso no
  HUD: tudo do repo do War Room, não daqui.
- Delta/patch update, CDN, download por navegador sem licença, portal
  self-service.
- Apagar release antiga (ver decisão 3 abaixo — artefato não some).

## Critérios de aceite

- [ ] Licença com `updatesUntil` no futuro: `check` devolve a versão corrente; o
      arquivo baixado pela URL do `download` tem **SHA256 igual** ao registrado.
- [ ] Licença com `updatesUntil` **anterior** ao `releasedAt` da corrente:
      `check` devolve a **última versão autorizada**, não a corrente, e o
      `download` dela funciona. É o critério que prova a promessa da licença
      perpétua.
- [ ] Chave revogada ou expirada → `410` nas duas rotas.
- [ ] `fingerprint` não ativo → `409`, sem reativar em silêncio (mesma regra do
      `heartbeat`; senão bastaria pular o `activate` para furar `maxMachines`).
- [ ] Chave inexistente → `404`; excesso de chamadas → `429` por IP **e** por
      chave, verificado nas duas rotas.
- [ ] **Nenhum byte do artefato passa pela API**: a resposta do `download` é
      JSON com a URL; verificado no tráfego, não afirmado.
- [ ] Dois `download` seguidos devolvem **URLs diferentes** — prova de que a URL
      assinada não é cacheada (ela expira em segundos).
- [ ] Release `published: false` desaparece do `check` **e** do `download`.
- [ ] Cada `download` autorizado gera `LicEvent`; a lista aparece em
      `GET licenses/:id/events`.
- [ ] Tela do admin registra release (versão, `os`, `releasedAt`, `assetId`,
      `sha256`) e lista por produto; `sha256` malformado é recusado no servidor.
- [ ] Ativação de teste do tenant `wr-test` não aparece em métrica do tenant
      real (isolamento por RLS, já existente — verificado, não presumido).
- [ ] **PAT ausente, expirado ou sem `contents:read`** → `download` responde
      erro de configuração explícito (nunca `500`, nunca URL vazia) **e** o
      admin mostra pendência — mesma regra da SPEC-039: *"nunca falha
      silenciosa"*. O modo de errar aqui é mudo por natureza: a máquina do
      cliente para de receber update e ninguém no admin fica sabendo.
- [ ] **Tenant B não baixa asset com o PAT do tenant A** (RLS verificado por
      teste, como na SPEC-039).

## Contratos

**Modelo novo** — `LicRelease` (tabela `lic_releases`), raiz com `tenant_id`,
`ENABLE`+`FORCE` RLS, como as demais tabelas `lic_*`:

```
id · productId → LicProduct · version (semver) · os · releasedAt ·
assetId (GitHub) · sha256 · notes · published · createdAt · updatedAt
@@unique([productId, version, os])
```

**Públicos** (`licensing/v1`, corpo — nunca query string, para a chave não cair
em log de acesso):

```
POST releases/check     { licenseKey, fingerprint, currentVersion? }
  200 { update: false } | { update: true, version, releasedAt, sha256, notes,
                            reason: "current" | "last-authorized" }
  404 chave inexistente · 409 fingerprint inativo · 410 revogada/expirada · 429

POST releases/download  { licenseKey, fingerprint, version, os }
  200 { url, expiresInSeconds, sha256 }
  403 versão fora da janela de updates da licença
  404 release inexistente ou despublicada
  409 · 410 · 429 iguais aos da rota acima
```

**Admin** (`t/:tenant/licensing`): `GET releases` · `POST releases` ·
`POST releases/:id/unpublish`.

## Notas técnicas

**ADR-028 acompanha esta fatia**, redigido pelo Code **no PR-1** — mesmo caminho
dos ADR-026/027, que também eram pré-requisito de spec e nasceram no PR. Ele
registra **uma** decisão estrutural, não duas (ver *Emenda de 2026-07-30*
abaixo):

**O artefato de release vive em Release privada do GitHub, não no Postgres.**
O ADR-025 guarda binário em `bytea` com teto de **10 MB** e lista como gatilho
de revisão *"arquivo acima de 10 MB"* e *"segundo caso de uso de binário"*. Um
instalador de ~80 MB dispara os dois — então esta fatia não escolhe livremente:
ela é o gatilho disparando, e o próprio ADR-025 já pré-escreveu que *"disparado
o gatilho, nasce ADR novo escolhendo object storage"*. GitHub Release privada
não acrescenta provedor, credencial nem linha na fatura.

### Emenda de 2026-07-30 — a exceção ao ADR-015 foi retirada

A versão original desta spec pedia uma **exceção estreita ao ADR-015** para ler
o asset com *installation token*. **Não é necessária**, e a razão é que a
credencial já existe: a SPEC-039 (entregue 2026-07-30, issue #214) criou
`LicSettings.githubPat` — **PAT fine-grained, por tenant, criptografado com o
`TOKEN_ENCRYPTION_KEY`, com teste de conexão no admin** — e `LicProduct.sourceRepo`,
apontando para o mesmo repo cujo asset esta fatia quer baixar.

Decisão do PI (**2026-07-30**): **`releases/download` autentica com o
`githubPat` do tenant.** Comparação que decidiu:

- O PAT amplia um risco **já aceito e confinado ao módulo `licensing`**; a
  exceção abriria buraco numa regra **global de leitura**.
- A "estreiteza" prometida não era verificável por máquina: o ADR diria *"um
  repo"*, mas o repo é `LicProduct.sourceRepo`, **campo configurável na tela** —
  na prática ficaria amarrada a qualquer repo que o tenant digitasse. Pelo
  padrão do ADR-027 item 3 (fronteira checada por máquina, não por lembrança),
  isso nasceria promessa, não guarda.
- Some o **Risco #1** original (se o installation token alcança asset de Release
  privada) — com PAT a pergunta não se coloca.

**O ADR-015 não é tocado por esta fatia.** O par user-to-server/installation
continua valendo sem exceção; o PAT do `licensing` já vivia fora desse modelo
desde a SPEC-039.

**Mecanismo do download.** `GET /repos/{owner}/{repo}/releases/assets/{id}` com
`Accept: application/octet-stream` responde **302** com `Location` para URL
assinada (Azure). A implementação **captura o `Location` sem seguir o redirect**
e devolve a URL ao cliente. A URL expira em segundos a minutos e **não pode ser
cacheada** — por isso `check` e `download` são rotas separadas: a primeira é
barata e idempotente, a segunda cunha URL fresca a cada chamada.

**Risco #1, a validar no 1º PR (reescrito na emenda de 2026-07-30):** o PAT da
SPEC-039 é **fine-grained com `administration:write` só no repo do produto** —
baixar asset exige **`contents:read` no mesmo repo**. É **ampliação de escopo do
mesmo token, no mesmo repo**, não credencial nova; mas é ampliação, e precisa
de três coisas no PR-1:

1. provar que o 302 → `Location` assinado funciona com PAT fine-grained;
2. o **teste de conexão do admin** (que a SPEC-039 já tem) passa a validar
   **os dois escopos**, não só `administration:write` — senão a primeira venda
   volta a ser o lugar onde se descobre que o token está errado, que é
   exatamente o que aquele teste existe para evitar;
3. a rotação do PAT no `docs/DEPLOY.md` (SPEC-039) ganha a menção ao novo
   escopo.

**Validar antes de escrever a tela do admin.**

**Rota nova no `/v1` é adição, não quebra** — o contrato do license file
continua intacto (MVP4 decisão 9: mudança de formato seria `/v2`).

## Perguntas abertas

Nenhuma. As cinco decisões desta fatia foram resolvidas com o PI em
**2026-07-29**:

1. Artefato em **Release privada do GitHub** (não Postgres, não R2, não volume).
2. Publicação **manual no admin** (não pelo CI do War Room).
3. `updatesUntil` vencido: o cliente **continua baixando** a última versão
   autorizada ⇒ **artefato nunca é apagado**, storage cresce monotonicamente.
4. Fatia **dentro do MVP4** (`[MVP4][SPEC-041][F30]`).
5. ~~Autenticação no GitHub por **exceção estreita ao ADR-015**, registrada em
   ADR novo.~~ **Revista em 2026-07-30**: autenticação pelo **`githubPat` do
   tenant** (SPEC-039), sem exceção ao ADR-015 — ver *Emenda de 2026-07-30* nas
   Notas técnicas. O ADR-028 fica com **uma** decisão (artefato fora do
   Postgres) e é redigido pelo Code no PR-1.
