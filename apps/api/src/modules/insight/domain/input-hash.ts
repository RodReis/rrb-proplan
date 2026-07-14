import { createHash } from 'node:crypto';

/**
 * Entrada que define univocamente uma chamada de IA: os bytes exatos enviados
 * ao provedor (`system` + `user` renderizados) mais o provedor e o modelo —
 * trocar de modelo é input novo (SPEC-011).
 */
export interface InputHashParts {
  system: string;
  user: string;
  provider: string;
  model: string;
}

/**
 * SHA-256 do prompt efetivamente enviado ao provedor — a chave de invalidação
 * da Fatia 7.7 (emenda ao ADR-002). Determinístico: mesmos `parts` ⇒ mesmo
 * hash, sempre (o teste de duplo-hash prova isso, cobrindo o risco de prompt
 * não-determinístico da spec).
 *
 * Os campos são unidos por `\0` (byte nulo, ausente em texto de prompt) para
 * que a concatenação seja injetiva: `"a" | "bc"` nunca colide com `"ab" | "c"`.
 */
export function computeInputHash(parts: InputHashParts): string {
  return createHash('sha256')
    .update([parts.system, parts.user, parts.provider, parts.model].join('\0'))
    .digest('hex');
}
