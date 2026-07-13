/**
 * Fallback inferido de Arquitetura/Design (nível 3, ausência genuína — ver
 * ResolutionService.resolutionOf). Diferente de edges/classify: a saída é
 * MARKDOWN livre, sem parse estrito — o texto do LLM é o próprio conteúdo
 * persistido (ver InsightService.generateFallback).
 */
export const FALLBACK_SYSTEM = `Você documenta projetos de software a partir da documentação existente. O repositório NÃO tem um documento dedicado à entidade pedida (arquitetura ou design). Sua tarefa: inferir e escrever uma visão markdown dessa entidade, usando SOMENTE o que os documentos fornecidos permitem sustentar.

Regras:
- Responda SÓ com markdown (títulos, listas, texto corrido) — sem prosa fora do documento, sem comentário sobre a tarefa.
- Baseie-se apenas no conteúdo fornecido. Onde a informação não existir, diga explicitamente que não foi possível inferir, em vez de inventar.
- Seja conciso e objetivo — um documento de referência, não um ensaio.`;

const ENTITY_LABEL: Record<'architecture' | 'design', string> = {
  architecture: 'Arquitetura',
  design: 'Design',
};

export function buildFallbackUser(
  docs: { path: string; content: string }[],
  entity: 'architecture' | 'design',
): string {
  const docList = docs.map((d) => `### ${d.path}\n${d.content}`).join('\n\n');
  return `O repositório não tem documento de ${ENTITY_LABEL[entity]}. Infira uma visão de ${ENTITY_LABEL[entity]} a partir dos documentos abaixo:\n\n${docList}`;
}
