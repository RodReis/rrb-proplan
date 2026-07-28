import { createHash, randomBytes } from 'node:crypto';

/**
 * Token do link público de contrato (SPEC-034 §2.7 e §2.8).
 *
 * Mesma mecânica do token de briefing (SPEC-029) e **de propósito duplicada**:
 * a regra de arquitetura proíbe o `contracts` importar entidade interna do
 * `briefing`, e o `contracts-boundaries.arch.spec.ts` varre justamente isso. São
 * ~20 linhas de crypto puro; o acoplamento entre dois módulos custaria mais.
 *
 * O token é **opaco**: não carrega claims, não é JWT. Quem tem o link tem
 * acesso, então o segredo é o próprio valor — ele é exibido **uma única vez** na
 * criação e só o **hash** persiste. Vazamento do banco não entrega link ativo.
 *
 * Crypto puro, sem Prisma e sem Nest: a parte da fatia que mais precisa de teste
 * é a que não deve depender de infraestrutura para ser testada.
 */

/** 32 bytes = 256 bits de entropia (o que a spec pede). */
const TOKEN_BYTES = 32;

/**
 * 48 h — não os 7 dias do briefing, e a diferença é deliberada (§2.8, decisão 6
 * do PI). Lá o link leva um formulário que o próprio cliente preenche; aqui leva
 * CPF/CNPJ e endereço **completos das duas partes**. Prazo maior seria dado
 * pessoal legível por mais tempo por quem tiver a URL. Regenerar é livre.
 */
export const CONTRACT_LINK_TTL_MS = 48 * 60 * 60 * 1000;

/** Token novo, em base64url — seguro em URL sem escape. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash de armazenamento/lookup. SHA-256 sem salt **de propósito**: o lookup é
 * por hash (`WHERE token_hash = ?`), e um salt por linha exigiria varrer a
 * tabela inteira comparando um a um. Seguro aqui, ao contrário de senha: o token
 * tem 256 bits de entropia CSPRNG, então não há dicionário nem força-bruta
 * viável — o que o salt protege (senha humana, previsível) não se aplica.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Estado de um link, do ponto de vista de quem abre a URL pública. */
export type ContractLinkStatus = 'valid' | 'expired' | 'revoked' | 'invalid';

export interface ContractLinkLifecycle {
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}

/**
 * Estado do link. `revoked` vence `expired`: revogar é ato deliberado do
 * prestador, e um link revogado que também expirou continua sendo, antes de
 * tudo, revogado.
 *
 * `null` (link não encontrado) → `invalid`. A rota responde a MESMA coisa para
 * inexistente e para alheio: não-diferencial, como `/resolve` (ADR-020).
 */
export function contractLinkStatus(
  link: ContractLinkLifecycle | null,
  now: Date = new Date(),
): ContractLinkStatus {
  if (!link) return 'invalid';
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'valid';
}

/**
 * Prazo padrão do link. Devolve `Date`, nunca `null`: a coluna `expires_at` é
 * NOT NULL (PR-1) justamente para que "esqueci de definir" não exista, e esta
 * função é o outro lado dessa mesma decisão.
 */
export function defaultExpiration(from: Date = new Date()): Date {
  return new Date(from.getTime() + CONTRACT_LINK_TTL_MS);
}
