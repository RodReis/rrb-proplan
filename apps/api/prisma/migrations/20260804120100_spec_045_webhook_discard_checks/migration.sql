-- ===========================================================================
-- SPEC-045 — as guardas do descarte (parte 2/2).
--
-- Separada da anterior por exigência do Postgres: um valor de enum criado com
-- `ALTER TYPE ... ADD VALUE` só pode ser REFERENCIADO depois de commitado
-- (`55P04`). Como o Prisma roda cada migration numa transação, os CHECKs abaixo
-- — que comparam `status` com 'DISCARDED' — precisam da migration seguinte.
-- ===========================================================================

-- Descarte sem motivo é o mesmo item ilegível que a lista de pendências já
-- produzia, só que escondido. O motivo é obrigatório onde ele importa — mesma
-- forma do `lic_webhook_events_failure_explained`, que faz isto para `FAILED`.
--
-- O `discarded_at` entra no mesmo CHECK porque descarte sem data deixaria a
-- trilha sem "quando desistimos disto?".
ALTER TABLE "lic_webhook_events"
  ADD CONSTRAINT "lic_webhook_events_discard_explained"
  CHECK ("status" <> 'DISCARDED' OR ("discarded_at" IS NOT NULL
     AND length(btrim(COALESCE("discarded_reason", ''))) > 0));

-- Rede de segurança do banco: reabrir o que nunca foi descartado não é estado
-- possível. A rota já recusa com 409; este CHECK é o que garante que nenhum
-- caminho futuro (script, correção manual) invente a combinação.
ALTER TABLE "lic_webhook_events"
  ADD CONSTRAINT "lic_webhook_events_reopen_after_discard"
  CHECK ("reopened_at" IS NULL OR "discarded_at" IS NOT NULL);

-- O `lic_webhook_events_processed_coherent` NÃO muda — e é justamente por isso
-- que `DISCARDED` precisa carimbar `processed_at`. Ele afirma
-- `(status = 'PENDING') = (processed_at IS NULL)`: descartar sem gravar a data
-- viola o CHECK e devolve `500` na tela, que foi exatamente o defeito do #216
-- (reprocess voltando a PENDING sem limpar a data). `DISCARDED` é desfecho, não
-- espera — carimba como PROCESSED/FAILED/IGNORED já carimbam.
