import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token do link público de briefing (SPEC-029).
 *
 * O token é **opaco**: não carrega claims, não é JWT. Quem tem o link tem
 * acesso, então o segredo é o próprio valor — e por isso ele é exibido **uma
 * única vez** na criação e só o **hash** persiste. Um vazamento do banco não
 * entrega nenhum link ativo.
 *
 * Crypto puro, sem Prisma e sem Nest: a parte da fatia que mais precisa de
 * teste é a que não deve depender de infraestrutura para ser testada.
 */

/** 32 bytes = 256 bits de entropia (o que a spec pede). */
const TOKEN_BYTES = 32;

/** Token novo, em base64url — seguro em URL sem escape. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hash de armazenamento/lookup. SHA-256 sem salt **de propósito**: o lookup é
 * por hash (`WHERE token_hash = ?`), e um salt por linha exigiria varrer a
 * tabela inteira comparando um a um. Isso é seguro aqui, ao contrário de senha:
 * o token tem 256 bits de entropia CSPRNG, então não há dicionário nem
 * força-bruta viável — o que o salt protege (senha humana, previsível) não se
 * aplica.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparação em tempo constante.
 *
 * O lookup por índice já resolve o caminho normal; isto existe para quando se
 * compara um hash candidato com um conhecido, sem dar ao atacante um oráculo de
 * temporização. `timingSafeEqual` exige buffers do mesmo tamanho — comprimento
 * diferente sai por `false` antes, o que não vaza nada além do comprimento (que
 * é fixo para SHA-256 hex).
 */
export function tokenHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Estado de um link, do ponto de vista de quem abre a URL pública. */
export type LinkStatus = 'valid' | 'expired' | 'revoked' | 'invalid';

export interface LinkLifecycle {
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
export function linkStatus(
  link: LinkLifecycle | null,
  now: Date = new Date(),
): LinkStatus {
  if (!link) return 'invalid';
  if (link.revokedAt) return 'revoked';
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'valid';
}
