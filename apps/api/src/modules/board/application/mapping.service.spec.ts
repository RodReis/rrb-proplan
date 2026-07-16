import { MappingService } from './mapping.service';
import { ENTITIES } from '../../ingestion/domain/entity';

describe('MappingService.getMapping', () => {
  it('retorna rows + proplanConfigInvalid=false quando o projeto não tem o flag setado', async () => {
    const prisma = {
      document: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findUnique: jest.fn().mockResolvedValue({ proplanConfigInvalid: false }) },
    } as any;
    const resolution = {
      resolutionOf: jest.fn().mockResolvedValue({
        level: 4,
        source: 'absent',
        path: null,
        paths: [],
        confidence: 0,
      }),
    } as any;

    const svc = new MappingService(prisma, {} as any, {} as any, {} as any, resolution, {} as any);
    const out = await svc.getMapping('p1');

    expect(out.rows).toHaveLength(ENTITIES.length);
    expect(out.proplanConfigInvalid).toBe(false);
  });

  it('retorna proplanConfigInvalid=true quando o projeto tem o flag setado', async () => {
    const prisma = {
      document: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findUnique: jest.fn().mockResolvedValue({ proplanConfigInvalid: true }) },
    } as any;
    const resolution = {
      resolutionOf: jest.fn().mockResolvedValue({
        level: 4,
        source: 'absent',
        path: null,
        paths: [],
        confidence: 0,
      }),
    } as any;

    const svc = new MappingService(prisma, {} as any, {} as any, {} as any, resolution, {} as any);
    const out = await svc.getMapping('p1');

    expect(out.proplanConfigInvalid).toBe(true);
  });

  it('retorna proplanConfigInvalid=false quando o projeto não é encontrado', async () => {
    const prisma = {
      document: { findMany: jest.fn().mockResolvedValue([]) },
      project: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const resolution = {
      resolutionOf: jest.fn().mockResolvedValue({
        level: 4,
        source: 'absent',
        path: null,
        paths: [],
        confidence: 0,
      }),
    } as any;

    const svc = new MappingService(prisma, {} as any, {} as any, {} as any, resolution, {} as any);
    const out = await svc.getMapping('p1');

    expect(out.proplanConfigInvalid).toBe(false);
  });
});

describe('MappingService.putMapping', () => {
  it('mescla a entidade no config existente e reescreve com write-back + re-sync', async () => {
    const prisma = {
      project: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r', defaultBranch: 'main' }),
      },
      document: { findUnique: jest.fn() },
    } as any;
    const auth = { installationToken: jest.fn().mockResolvedValue('tok') } as any;
    // O config vem do GitHub, não do cache do banco: o merge tem de ser
    // calculado sobre o conteúdo vivo para poder ser reaplicado num 409.
    const writeback = {
      getFile: jest.fn().mockResolvedValue({
        sha: 'sha1',
        content: 'proplan: v2\nmapping:\n  architecture: docs/a.md\n',
      }),
      putFile: jest.fn().mockResolvedValue('sha2'),
    } as any;
    const ingestion = { enqueueSync: jest.fn().mockResolvedValue({ syncRunId: 'run1' }) } as any;
    const resolution = { resolutionOf: jest.fn() } as any;
    const activity = {
      start: jest.fn().mockResolvedValue('op1'),
      advance: jest.fn().mockResolvedValue(undefined),
      attachArtifacts: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    } as any;

    const svc = new MappingService(prisma, auth, writeback, ingestion, resolution, activity);
    const out = await svc.putMapping('p1', 'deploy', null);

    const putArg = writeback.putFile.mock.calls[0][0];
    expect(putArg.path).toBe('.proplan/config.yml');
    expect(putArg.content).toContain('architecture: docs/a.md'); // preservou
    expect(putArg.content).toContain('deploy: null'); // mesclou
    expect(putArg.baseSha).toBe('sha1');
    expect(auth.installationToken).toHaveBeenCalledWith('p1');
    // Passa o blob SHA commitado como expectativa de propagação (consistência
    // eventual da Trees API — ver SyncService.listScope).
    expect(ingestion.enqueueSync).toHaveBeenCalledWith('p1', {
      path: '.proplan/config.yml',
      blobSha: 'sha2',
    });
    // Operation (SPEC-010): abre kind mapping, anexa o syncRunId, devolve o id.
    expect(activity.start).toHaveBeenCalledWith('p1', 'mapping', '.proplan/config.yml');
    expect(activity.attachArtifacts).toHaveBeenCalledWith('op1', { syncRunId: 'run1' });
    expect(out.operationId).toBe('op1');
  });
});
