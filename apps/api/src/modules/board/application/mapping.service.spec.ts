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

    const svc = new MappingService(prisma, {} as any, {} as any, {} as any, resolution);
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

    const svc = new MappingService(prisma, {} as any, {} as any, {} as any, resolution);
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

    const svc = new MappingService(prisma, {} as any, {} as any, {} as any, resolution);
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
      document: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ content: 'proplan: v2\nmapping:\n  architecture: docs/a.md\n' }),
      },
    } as any;
    const auth = { installationToken: jest.fn().mockResolvedValue('tok') } as any;
    const writeback = {
      getFileSha: jest.fn().mockResolvedValue('sha1'),
      putFile: jest.fn().mockResolvedValue('sha2'),
    } as any;
    const ingestion = { enqueueSync: jest.fn().mockResolvedValue({ syncRunId: 'run1' }) } as any;
    const resolution = { resolutionOf: jest.fn() } as any;

    const svc = new MappingService(prisma, auth, writeback, ingestion, resolution);
    const out = await svc.putMapping('p1', 'deploy', null);

    const putArg = writeback.putFile.mock.calls[0][0];
    expect(putArg.path).toBe('.proplan/config.yml');
    expect(putArg.content).toContain('architecture: docs/a.md'); // preservou
    expect(putArg.content).toContain('deploy: null'); // mesclou
    expect(putArg.baseSha).toBe('sha1');
    expect(auth.installationToken).toHaveBeenCalledWith('p1');
    expect(out.syncRunId).toBe('run1');
  });
});
