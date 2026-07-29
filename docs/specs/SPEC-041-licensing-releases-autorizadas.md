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

**Um ADR novo é pré-requisito desta fatia** (a escrever antes do 1º PR), com
duas decisões:

1. **O artefato de release vive em Release privada do GitHub, não no Postgres.**
   O ADR-025 guarda binário em `bytea` com teto de **10 MB** e lista como
   gatilho de revisão *"arquivo acima de 10 MB"* e *"segundo caso de uso de
   binário"*. Um instalador de ~80 MB dispara os dois — então esta fatia não
   escolhe livremente: ela é o gatilho disparando. GitHub Release privada
   reaproveita o App do ADR-015 e não acrescenta provedor, credencial nem linha
   na fatura.
2. **Exceção estreita ao ADR-015**, que manda ler com token *user-to-server* e
   proíbe ler com *installation token*. A regra existe para que a leitura
   respeite a **visibilidade do usuário**; aqui **não há usuário** — quem pede é
   uma máquina licenciada, sem identidade GitHub. A exceção fica amarrada a
   **um repo** (o do War Room) e **uma rota** (`releases/download`), e o ADR
   precisa dizer isso com essas palavras, ou vira porta larga.

**Mecanismo do download.** `GET /repos/{owner}/{repo}/releases/assets/{id}` com
`Accept: application/octet-stream` responde **302** com `Location` para URL
assinada (Azure). A implementação **captura o `Location` sem seguir o redirect**
e devolve a URL ao cliente. A URL expira em segundos a minutos e **não pode ser
cacheada** — por isso `check` e `download` são rotas separadas: a primeira é
barata e idempotente, a segunda cunha URL fresca a cada chamada.

**Risco #1, a validar no 1º PR:** que o installation token do App tenha escopo
para asset de Release **privada**. Se não tiver, o plano B é decisão do PI entre
PAT dedicado só-leitura (credencial de vida longa — o que o App existe para
evitar) e object storage R2/S3 (provedor novo). **Validar antes de escrever a
tela do admin** — é o que decide se a fatia inteira se sustenta.

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
5. Autenticação no GitHub por **exceção estreita ao ADR-015**, registrada em ADR
   novo.
