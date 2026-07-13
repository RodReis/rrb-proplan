import { generateKeyPairSync } from 'crypto';
import type { Redis } from 'ioredis';
import {
  INSTALLATION_TOKEN_TTL_S,
  InstallationTokenService,
  installationCacheKey,
} from './installation-token.service';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    store,
  } as unknown as Redis & { get: jest.Mock; set: jest.Mock; store: Map<string, string> };
}

describe('installationCacheKey', () => {
  it('chaveia por installationId (compartilhado entre projetos da conta)', () => {
    expect(installationCacheKey(123)).toBe('installation_token:123');
  });
});

describe('InstallationTokenService', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  beforeEach(() => {
    process.env.GITHUB_APP_ID = '42';
    process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(privateKey, 'utf-8').toString(
      'base64',
    );
  });

  it('cache miss: emite via API e grava com TTL 55min', async () => {
    const redis = fakeRedis();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ token: 'ghs_novo' }), { status: 200 }),
      );
    const svc = new InstallationTokenService(redis);

    const token = await svc.tokenFor(7);

    expect(token).toBe('ghs_novo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'installation_token:7',
      'ghs_novo',
      'EX',
      INSTALLATION_TOKEN_TTL_S,
    );
    fetchMock.mockRestore();
  });

  it('cache hit: não chama a API (dois writes não geram dois access_tokens)', async () => {
    const redis = fakeRedis();
    redis.store.set('installation_token:7', 'ghs_cacheado');
    const fetchMock = jest.spyOn(global, 'fetch');
    const svc = new InstallationTokenService(redis);

    const token = await svc.tokenFor(7);

    expect(token).toBe('ghs_cacheado');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha da API vira erro (nunca token vazio)', async () => {
    const redis = fakeRedis();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 404 }));
    const svc = new InstallationTokenService(redis);

    await expect(svc.tokenFor(7)).rejects.toThrow('GitHub access_tokens 404');
    expect(redis.set).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
