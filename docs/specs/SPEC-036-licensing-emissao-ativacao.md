---
proplan: v1
spec: SPEC-036
fatia: 25
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada pelo PI em 2026-07-29 (perguntas abertas resolvidas, ver §Perguntas abertas)
updated: 2026-07-29
---
# SPEC-036 — Licensing: schema, emissão manual e ativação com license file assinado

> 1ª fatia do MVP4 (`docs/specs/MVP4.md`). Piloto: War Room.

## Objetivo

Emitir uma licença pelo admin e ativá-la numa máquina real via `POST /licensing/v1/activate`, recebendo um license file assinado (Ed25519) que o cliente valida offline.

## Escopo

- Schema Prisma do módulo `licensing`: `LicProduct`, `LicEdition`, `License`, `Activation`, `LicEvent` + enums — com `tenantId` e políticas RLS (ADR-020). Migração + seed dev (produto `warroom`, edições `closed` e `source`).
- Par de chaves Ed25519: privada em env/secret (Railway), pública exportável; license file carrega `kid`. Script utilitário de geração do par documentado em `docs/DEPLOY.md`.
- Admin (auth de sessão existente, escopo do tenant): CRUD mínimo de produto/edição; **emissão manual** de licença (e-mail + nome do comprador, edição) — chave em claro exibida **uma única vez** na resposta; persistência só do `keyHash` (sha256).
- **Tela mínima de emissão** no painel: formulário (edição + e-mail + nome) → exibe a chave uma vez, com aviso de que não será mostrada de novo; lista simples de licenças do tenant com ação de revogar. O painel completo (busca avançada, métricas, demais ações) é da SPEC-040.
- `POST /licensing/v1/activate` (público, sem sessão): valida chave, status e limite de máquinas; cria/reativa `Activation`; retorna license file assinado.
- Revogação manual no admin (`status=REVOKED` + motivo) — necessária para testar o `410` do fluxo de ativação.
- Trilha `LicEvent` para: `issued`, `activated`, `reactivated`, `revoked`.
- Rate limit no `/activate` (por IP e por chave).

## Fora de escopo

- `/heartbeat`, `/deactivate`, troca self-service de máquina (Fatia 26 / SPEC-037).
- E-mail (a chave desta fatia é entregue pelo admin, manualmente), webhooks, assinatura/renovação (Fatia 27 / SPEC-038).
- Convite GitHub da edição source (Fatia 28 / SPEC-039).
- Painel admin completo e métricas (Fatia 29 / SPEC-040) — aqui é o mínimo funcional.
- Trial (fora do produto — decisão #4 do MVP4). Portal self-service.
- Cliente de licença do War Room (repo dele; consome o contrato daqui).

## Critérios de aceite

- [ ] Admin cria produto `warroom` com edições `closed` (nome de exibição "Sem código-fonte") e `source` ("Com código-fonte") — ambas PERPETUAL, maxMachines 2, updates 12 meses — via seed ou tela.
- [ ] Tela mínima de emissão funciona ponta a ponta: formulário → chave exibida uma vez → licença aparece na lista → revogar pela lista muda o status.
- [ ] Emissão manual retorna chave no formato `WR-XXXX-XXXX-XXXX-XXXX`; a chave em claro não existe em nenhuma tabela (só `keyHash`); reconsultar a licença não revela a chave.
- [ ] `POST /activate` com chave válida + fingerprint novo cria `Activation` e retorna license file cuja assinatura confere com a chave pública (verificação por script/teste, fora do servidor).
- [ ] `payload.fingerprint` do license file = fingerprint enviado; `updatesUntil` = emissão + `updatesMonths` da edição.
- [ ] Mesma chave + mesmo fingerprint reativa (idempotente) sem consumir vaga de máquina.
- [ ] Chave inexistente → `404`; licença revogada → `410`; (`maxMachines`+1)-ésima máquina → `409` com lista de ativações (hostname + lastSeenAt).
- [ ] Tenant B não enxerga licenças do tenant A no admin (RLS verificado por teste).
- [ ] Todo evento do escopo gera `LicEvent`; a trilha é consultável no admin (lista simples).
- [ ] `dev`, `test`, `lint` verdes; arch-spec de fronteira do módulo (`licensing` não importa entidade interna de outro módulo).

## Contratos

### Modelo (Prisma — assinatura, campos essenciais)

```prisma
model LicProduct  { id tenantId slug @unique(per tenant) name keyPrefix projectId? editions[] }
model LicEdition  { id productId slug billingModel(PERPETUAL|SUBSCRIPTION) maxMachines=2 updatesMonths=12 licenses[] @@unique([productId, slug]) }
model License     { id tenantId editionId keyHash @unique status(ACTIVE|REVOKED|EXPIRED) customerEmail customerName? saleRef? @unique issuedAt updatesUntil expiresAt? revokedAt? revokedReason? sourceInviteAt? sourceInvited=false activations[] events[] }
model Activation  { id tenantId licenseId fingerprint hostname? appVersion? activatedAt lastSeenAt deactivatedAt? @@unique([licenseId, fingerprint]) }
model LicEvent    { id tenantId licenseId type payload? createdAt }
```

A chave em claro só existe na resposta da emissão. `expiresAt` fica nulo em PERPETUAL (uso na SPEC-038 para SUBSCRIPTION). `sourceInviteAt`/`sourceInvited` nascem no schema, usados na SPEC-039.

### `POST /licensing/v1/activate`

Request: `{ key, fingerprint, hostname?, appVersion? }`
`200`: license file — `{ payload: { licenseId, edition, billingModel, fingerprint, issuedAt, updatesUntil, expiresAt, signedAt, graceDays: 14, kid }, signature: base64(ed25519) }`
`404` chave inexistente · `410` revogada/expirada · `409` limite de máquinas, body `{ activations: [{ id, hostname, lastSeenAt }] }` · `429` rate limit.

### Admin (`/api` interno, auth existente)

`POST /licensing/admin/products` · `POST /licensing/admin/products/:id/editions` · `POST /licensing/admin/licenses` (emissão; resposta contém `key` em claro, única vez) · `POST /licensing/admin/licenses/:id/revoke` `{ reason }` · `GET /licensing/admin/licenses?email|key` (busca por e-mail ou pela chave — hasheia e busca por `keyHash`) · `GET /licensing/admin/licenses/:id/events`.

## Notas técnicas

- **RLS em rota pública**: `/activate` não tem sessão/tenant no contexto. Resolver pelo recurso: lookup por `keyHash` → `tenantId` da licença → estabelecer contexto RLS e prosseguir — mesmo padrão da rota pública do briefing (SPEC-031). Proibido `bypass` genérico (ADR-020).
- **Assinatura**: Ed25519 via `crypto` nativo do Node (`sign/verify` com chave `ed25519`) — sem dependência nova. Chave privada em PEM na env `LICENSING_SIGNING_KEY`; `LICENSING_SIGNING_KID` identifica a chave vigente.
- Formato da chave: `<keyPrefix>-` + 4 grupos de 4 chars (alfabeto sem ambíguos: sem `0/O/1/I`), gerada com `crypto.randomBytes`. Busca sempre por `keyHash` (índice único).
- Fingerprint é opaco para o servidor (hash calculado no cliente); o servidor só o compara por igualdade.
- Preço **não** entra no schema (decisão #4 do MVP4) — a plataforma de venda é a fonte; o valor chegará no `LicEvent.payload` do webhook (SPEC-038).
- Módulo segue estrutura padrão (`presentation/application/domain/infrastructure`); controller público separado do admin; testes `*.spec.ts` junto ao módulo.
- Rate limit com o Throttler do Nest (já usado? verificar — se não houver, dependência `@nestjs/throttler` entra aqui, escopo mínimo na rota pública).

## Perguntas abertas

**Nenhuma pendente — resolvidas com o PI em 2026-07-29:**

1. **Edições do piloto**: duas — `closed` ("Sem código-fonte") e `source` ("Com código-fonte"). `maxMachines = 2` para ambas (default da spec de origem; ajustável por edição pelo admin).
2. **Chave Ed25519**: só o suficiente para o piloto — par único (`kid: "2026-07"`), rotação documentada em `docs/DEPLOY.md`. Sem tabela de chaves no banco.
3. **Tela**: tela mínima de emissão **nesta fatia** (formulário + lista + revogar); painel completo na SPEC-040.
