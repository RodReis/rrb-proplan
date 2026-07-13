import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import {
  buildAppJwtClaims,
  decodePrivateKey,
  JWT_EXP_S,
  JWT_IAT_SKEW_S,
  signAppJwt,
} from './github-app-jwt';

describe('buildAppJwtClaims', () => {
  it('recua o iat 60s e põe exp 9min à frente do iat', () => {
    const now = 1_000_000;
    const c = buildAppJwtClaims('42', now);
    expect(c.iat).toBe(now - JWT_IAT_SKEW_S);
    expect(c.exp).toBe(c.iat + JWT_EXP_S);
    expect(c.iss).toBe('42');
  });

  it('exp fica dentro do limite de 10min do GitHub', () => {
    const c = buildAppJwtClaims('42', 1_000_000);
    expect(c.exp - 1_000_000).toBeLessThanOrEqual(10 * 60);
  });
});

describe('decodePrivateKey', () => {
  it('decodifica base64 preservando quebras de linha do PEM', () => {
    const pem = '-----BEGIN KEY-----\nlinha1\nlinha2\n-----END KEY-----\n';
    const b64 = Buffer.from(pem, 'utf-8').toString('base64');
    expect(decodePrivateKey(b64)).toBe(pem);
  });
});

describe('signAppJwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const privateKeyBase64 = Buffer.from(privateKey, 'utf-8').toString('base64');

  it('produz um JWT RS256 verificável pela chave pública', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = signAppJwt('99', privateKeyBase64, now);
    const decoded = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    }) as { iss: string; iat: number; exp: number };
    expect(decoded.iss).toBe('99');
    expect(decoded.iat).toBe(now - JWT_IAT_SKEW_S);
    expect(decoded.exp).toBe(now - JWT_IAT_SKEW_S + JWT_EXP_S);
  });
});
