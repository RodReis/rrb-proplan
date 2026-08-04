-- ===========================================================================
-- SPEC-045 — descartar entrega de webhook sem apagar a trilha (parte 1/2).
--
-- Nasce do dogfooding de 2026-08-04 (issue #257): o botão "Testar Webhook" da
-- Kiwify manda um `product_id` fictício E DIFERENTE a cada disparo. Seis deles
-- viraram seis ofertas sem mapeamento permanentes na aba Pendências — badge
-- laranja sem conserto possível, porque mapear emitiria licença real para venda
-- fictícia.
--
-- **Por que não `DELETE`.** O payload bruto é o que responde "por que esta venda
-- não virou licença". Apagar a linha para a tela ficar limpa é o oposto do que
-- este produto verifica — e o mesmo princípio que o board já fixa em
-- "issue nunca é deletada".
--
-- Ampliação de domínio pura: valor novo no enum + quatro colunas nullable.
-- **Toda linha existente continua válida**, sem migração de dados.
--
-- **Por que esta migration para em duas.** Postgres recusa usar um valor de enum
-- recém-criado na MESMA transação que o criou (`55P04`: *"unsafe use of new
-- value"*), e o Prisma roda cada migration dentro de uma transação. Os CHECKs
-- que comparam com 'DISCARDED' ficam na migration seguinte, que já enxerga o
-- valor commitado. Juntar as duas quebra o `migrate deploy` — e foi assim que
-- este arquivo falhou da primeira vez.
-- ===========================================================================

-- Uma PESSOA dizendo "esta entrega não vai virar nada" — com nome e motivo.
-- Distinto de `IGNORED`, que é a máquina dizendo "este tipo não me diz respeito"
-- no intake, sem autor. Reaproveitar `IGNORED` para o ato humano apagaria a
-- pergunta *quem*, que é justamente a que a trilha precisa responder.
ALTER TYPE "LicWebhookStatus" ADD VALUE 'DISCARDED';

ALTER TABLE "lic_webhook_events"
  ADD COLUMN "discarded_at"     TIMESTAMP(3),
  ADD COLUMN "discarded_by"     TEXT,
  ADD COLUMN "discarded_reason" TEXT,
  ADD COLUMN "reopened_at"      TIMESTAMP(3);
