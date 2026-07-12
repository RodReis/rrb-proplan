import jwt from 'jsonwebtoken';

/**
 * JWT do GitHub App (RS256), usado para pedir installation tokens.
 * `iat` com 60s de folga para trás (relógio adiantado quebra o JWT — a
 * pegadinha clássica da SPEC-008) e `exp` em 9min (o GitHub rejeita > 10min).
 */
export const JWT_IAT_SKEW_S = 60;
export const JWT_EXP_S = 9 * 60;

export interface AppJwtClaims {
  iat: number;
  exp: number;
  iss: string;
}

/** Claims determinísticos a partir do instante atual (em segundos epoch). */
export function buildAppJwtClaims(appId: string, nowSeconds: number): AppJwtClaims {
  const iat = nowSeconds - JWT_IAT_SKEW_S;
  return { iat, exp: iat + JWT_EXP_S, iss: appId };
}

/** PEM guardado em base64 no env (tem quebras de linha — SPEC-008). */
export function decodePrivateKey(base64Pem: string): string {
  return Buffer.from(base64Pem, 'base64').toString('utf-8');
}

/** Assina o JWT do App. `privateKeyBase64` = PEM em base64. */
export function signAppJwt(
  appId: string,
  privateKeyBase64: string,
  nowSeconds: number,
): string {
  const claims = buildAppJwtClaims(appId, nowSeconds);
  return jwt.sign(claims, decodePrivateKey(privateKeyBase64), {
    algorithm: 'RS256',
  });
}
