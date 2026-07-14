-- Nº de documentos que entraram no prompt de cada execução de insight — o painel
-- de Atividade mostra "leu N documentos". Nullable, aditivo.
ALTER TABLE "insight_runs" ADD COLUMN "docs_read" INTEGER;
