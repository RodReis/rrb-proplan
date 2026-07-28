/**
 * Modelo da frente de artefatos (SPEC-032 §2.4): **um só para a frente
 * inteira**, resolvido do env.
 *
 * Env próprio, e não o `LLM_MODEL_ANTHROPIC` global, porque o `insight` roda no
 * global — trocá-lo para Haiku mudaria o resumo de projeto junto, efeito
 * colateral fora desta fatia. O default é Haiku porque é a decisão do PI; quem
 * quiser outro, declara no `.env`.
 *
 * Isto **não é** o mapeamento tier→modelo que o ADR-008 rejeita: não há tabela
 * de complexidade escolhendo modelo por artefato. É uma frente inteira
 * declarando o seu, uma vez.
 */
export const ARTIFACTS_MODEL =
  process.env.LLM_MODEL_ARTIFACTS ?? 'claude-haiku-4-5-20251001';
