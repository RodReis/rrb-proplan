---
proplan: v1
spec: SPEC-037
fatia: 26
status: aprovada-pi # rascunho | aprovada-pi | em-implementacao | entregue | aceita-pi — aprovada pelo PI em 2026-07-29 (perguntas abertas resolvidas, ver §Perguntas abertas)
updated: 2026-07-29
---
# SPEC-037 — Licensing: heartbeat, desativação e troca de máquina self-service

> 2ª fatia do MVP4 (`docs/specs/MVP4.md`). Depende da Fatia 25 (SPEC-036) entregue: schema, chaves Ed25519 e `/activate` existindo.

## Objetivo

Fechar o ciclo de vida da ativação sem intervenção do dono: a máquina licenciada renova sozinha a janela offline (heartbeat), e o cliente que trocou de computador libera a vaga antiga sozinho — sem abrir suporte.

## Escopo

- `POST /licensing/v1/heartbeat` — atualiza `lastSeenAt` e `appVersion`; **reassina** o license file (renova `signedAt`, que é o que reinicia a graça de 14 dias no cliente). `410` quando a licença está revogada ou expirada.
- `POST /licensing/v1/deactivate` — libera uma vaga de máquina. Duas formas, ambas autenticadas pela chave: **própria máquina** (`fingerprint` da requisição) e **outra máquina** (`activationId` obtido na lista do `409`), que é o que torna a troca possível quando o computador antigo não está mais acessível.
- Desativação é *soft*: `deactivatedAt` preenchido, linha preservada (histórico e auditoria). Reativar o mesmo fingerprint depois **reocupa uma vaga** — não é retorno gratuito.
- Contagem de vagas passa a ignorar ativações desativadas (`deactivatedAt != null`), tanto no `/activate` quanto no `409`.
- Detecção de troca anômala: contador de reativações/desativações por licença numa janela móvel, exposto no admin como sinal (não bloqueia — ver §Perguntas abertas se vira limite duro).
- Ação equivalente no admin: desativar máquina de qualquer licença do tenant (suporte manual quando o self-service não resolve).
- Trilha `LicEvent`: `heartbeat`, `deactivated`, `deactivated_by_admin`, `reactivated`.
- Rate limit nas duas rotas públicas novas (por IP e por chave).

## Fora de escopo

- Renovação de assinatura, inadimplência e qualquer coisa vinda de webhook (Fatia 27 / SPEC-038) — aqui `expiresAt` só é **lido**, nunca escrito.
- E-mail de aviso ("sua máquina foi desativada") — não há provider até a SPEC-038.
- Portal público `GET /portal/:key` — a troca desta fatia é feita **pelo próprio cliente instalado**, via CLI/UI do produto, não por página web.
- Cliente de licença do War Room (repo dele) — esta fatia entrega o servidor; o consumidor implementa contra o contrato.
- Métricas e painel completo (Fatia 29 / SPEC-040).

## Critérios de aceite

- [ ] `POST /heartbeat` com chave e fingerprint ativos retorna license file com `signedAt` **mais recente** que o da ativação, assinatura válida, e atualiza `lastSeenAt` no banco.
- [ ] `heartbeat` de fingerprint **não ativado** (ou já desativado) retorna `409` com a lista de ativações — nunca reativa em silêncio.
- [ ] `heartbeat` de licença revogada retorna `410`; de licença com `expiresAt` no passado, `410`.
- [ ] `POST /deactivate` com o próprio fingerprint marca `deactivatedAt`; chamar de novo é **idempotente** (`200`, sem novo evento).
- [ ] `POST /deactivate` com `activationId` de outra máquina da mesma licença funciona; `activationId` de licença diferente retorna `404` (nunca vaza a existência da ativação alheia).
- [ ] Com `maxMachines=2` e 2 vagas ocupadas: `/activate` de uma 3ª máquina → `409`; desativar uma → `/activate` da 3ª passa e o total de ativações **não desativadas** volta a 2.
- [ ] Reativar um fingerprint desativado com as vagas cheias retorna `409` (não fura o limite por já ter existido).
- [ ] Ativações desativadas não aparecem na contagem, mas continuam legíveis no admin com a data.
- [ ] Contador de trocas da licença aparece no admin e reflete as desativações/reativações da janela.
- [ ] Todos os eventos do escopo gravam `LicEvent`; tenant B não desativa máquina do tenant A (RLS verificada por teste).
- [ ] `dev`, `test`, `lint` verdes; arch-spec de fronteira do módulo mantida.

## Contratos

### `POST /licensing/v1/heartbeat`

Request: `{ key, fingerprint, appVersion? }`
`200`: license file (mesmo formato da SPEC-036, com `signedAt` novo).
`404` chave inexistente · `409` fingerprint não ativo, body `{ activations: [{ id, hostname, lastSeenAt }] }` · `410` revogada/expirada · `429` rate limit.

### `POST /licensing/v1/deactivate`

Request: `{ key, fingerprint }` **ou** `{ key, activationId }` (exatamente um dos dois; enviar ambos → `400`).
`200`: `{ deactivated: true, remainingSlots: n }` — idempotente.
`404` chave inexistente ou `activationId` fora da licença · `410` revogada · `429` rate limit.

### Admin

`POST /licensing/admin/licenses/:id/activations/:activationId/deactivate` — mesma semântica, autenticada por sessão, evento `deactivated_by_admin`.
`GET /licensing/admin/licenses/:id` passa a devolver as ativações com `deactivatedAt` e o contador de trocas da janela.

## Notas técnicas

- **Resolução de tenant nas rotas públicas** segue a SPEC-036: lookup por `keyHash` → `tenantId` → contexto RLS. Sem bypass (ADR-020).
- **`signedAt` é do servidor, sempre `now()`** — nunca copiado do request. A graça do cliente é medida sobre ele, então aceitar valor do cliente seria deixar a máquina estender a própria licença.
- **Não reativar em silêncio no heartbeat** é a decisão de desenho da fatia: se o fingerprint não está ativo, houve desativação deliberada (troca de máquina) ou máquina nova reusando chave — reativar sozinho tornaria o `maxMachines` decorativo. O `409` devolve a lista e o cliente decide.
- `deactivate` por `activationId` só é aceito para ativação **da mesma licença**; a checagem é feita depois do lookup pela chave, e a resposta para "existe mas é de outra licença" é a mesma de "não existe" (`404`) — não confirmar existência é o que evita enumerar ativações alheias.
- Contador de trocas: derivado de `LicEvent` (contagem de `deactivated`+`reactivated` na janela), **sem coluna nova** — o mesmo princípio do `LlmUsage.tenant_id` citado no `STATUS.md`: coluna criada para o futuro e não alimentada mente em silêncio.
- Idempotência do `deactivate`: `deactivatedAt` já preenchido → `200` sem novo `LicEvent` (evento duplicado inflaria o contador de trocas e faria o sinal de abuso disparar por retry de rede).

## Perguntas abertas

**Nenhuma pendente — resolvidas com o PI em 2026-07-29:**

1. **Troca abusiva: só sinal, sem limite duro.** O contador aparece no admin e nada bloqueia. Motivo: teto errado bloqueia cliente honesto que formatou o PC duas vezes, e o volume do piloto é pequeno o bastante para olhar caso a caso. **Gatilho de revisão:** abuso visível no admin (licença com trocas muito acima da mediana) → aí vira teto por janela, com spec própria.
2. **`graceDays` fixo em 14.** Constante do módulo, documentada no contrato da §5 do MVP4 — não vira campo de `LicEdition`. **Gatilho de revisão:** existir um segundo produto que peça outra janela.
3. **Cadência do heartbeat não viaja no license file.** Fica documentada no contrato (24 h ± 2 h) e muda junto com o cliente. **Gatilho de revisão:** um segundo consumidor do contrato, ou necessidade de afrouxar a cadência sem redistribuir binário.
