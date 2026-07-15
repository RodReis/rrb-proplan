import { SyncService } from './sync.service';
import { ProbeResult } from '../infrastructure/http-probe';

/**
 * Integração probe ↔ confronto (SPEC-013.6): prova os 4 modos do sinal
 * `declaredUrl` sem rede — o HttpProbe é um duplo. O método é privado; chamamos
 * via bracket-access, o padrão já usado em sync-propagation.spec.
 */
function makeSvc(probeImpl: (url: string) => Promise<ProbeResult>) {
  const httpProbe = { probe: jest.fn(probeImpl) } as any;
  return new SyncService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, httpProbe,
  );
}

const ISO = '2026-07-15T00:00:00.000Z';

describe('probeDeclaredUrl — modos do sinal declaredUrl', () => {
  it('plataforma declarada à mão vence, sem probe (mode string)', async () => {
    const probe = jest.fn();
    const svc = makeSvc(probe);
    const sig = await svc['probeDeclaredUrl'](
      { url: 'https://gestao.exemplo.com.br', platform: 'netlify' },
      ISO,
    );
    expect(sig.mode).toBe('string');
    expect(sig.platforms).toEqual(['netlify']);
    expect(probe).not.toHaveBeenCalled(); // dono já resolveu → não sonda
  });

  it('destino não-público → bloqueada_por_seguranca, platforms vazio', async () => {
    const svc = makeSvc(async () => ({ blocked: true, reason: 'destino_nao_publico' }));
    const sig = await svc['probeDeclaredUrl']({ url: 'https://interno', platform: null }, ISO);
    expect(sig.mode).toBe('bloqueada_por_seguranca');
    expect(sig.platforms).toEqual([]);
  });

  it('probe respondeu com fingerprint → mode probe', async () => {
    const svc = makeSvc(async () => ({
      blocked: false,
      headers: { 'x-nf-request-id': '01H' },
      finalUrl: 'https://own.example',
      bodySlice: '',
    }));
    const sig = await svc['probeDeclaredUrl']({ url: 'https://own.example', platform: null }, ISO);
    expect(sig.mode).toBe('probe');
    expect(sig.platforms).toEqual(['netlify']);
  });

  it('probe respondeu SEM fingerprint → cai no parse de domínio (mode string)', async () => {
    const svc = makeSvc(async () => ({
      blocked: false,
      headers: { server: 'nginx' },
      finalUrl: 'https://foo.netlify.app',
      bodySlice: '',
    }));
    const sig = await svc['probeDeclaredUrl']({ url: 'https://foo.netlify.app', platform: null }, ISO);
    expect(sig.mode).toBe('string');
    expect(sig.platforms).toEqual(['netlify']); // do sufixo de domínio
  });

  it('probe falhou (timeout, não é bloqueio) → parse de domínio', async () => {
    const svc = makeSvc(async () => ({ blocked: true, reason: 'timeout' }));
    const sig = await svc['probeDeclaredUrl']({ url: 'https://foo.vercel.app', platform: null }, ISO);
    expect(sig.mode).toBe('string');
    expect(sig.platforms).toEqual(['vercel']);
  });

  it('probe falhou + domínio próprio → platforms vazio (desconhecida, não chuta)', async () => {
    const svc = makeSvc(async () => ({ blocked: true, reason: 'timeout' }));
    const sig = await svc['probeDeclaredUrl']({ url: 'https://gestao.exemplo.com.br', platform: null }, ISO);
    expect(sig.mode).toBe('string');
    expect(sig.platforms).toEqual([]);
  });
});

describe('updateDeploySignals — teto de probes por sync (ADR-018 guarda 5)', () => {
  it('config com 15 prodUrls → no máximo 10 probes (rate-limit)', async () => {
    const urls = Array.from({ length: 15 }, (_, i) => `- https://app${i}.netlify.app`).join('\n');
    const configYml = `mapping: {}\ndeploy:\n  prodUrls:\n${urls.replace(/^/gm, '    ')}\n`;
    const probe = jest.fn(async () => ({ blocked: true as const, reason: 'timeout' }));
    const prisma = {
      document: {
        findFirst: jest.fn().mockResolvedValue({ content: configYml }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      project: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const git = {
      listRootFiles: jest.fn().mockResolvedValue([]),
      listDeploymentUrls: jest.fn().mockResolvedValue({ environmentUrls: [], count: 0, denied: false }),
    } as any;
    const resolution = { resolutionOf: jest.fn().mockResolvedValue({ path: null, paths: [] }) } as any;
    const svc = new SyncService(
      prisma, {} as any, git, {} as any, {} as any, resolution, { probe } as any,
    );
    await svc['updateDeploySignals']('p1', 'tok', 'o', 'r', 'main');
    expect(probe.mock.calls.length).toBeLessThanOrEqual(10);
    expect(probe.mock.calls.length).toBe(10);
  });
});
