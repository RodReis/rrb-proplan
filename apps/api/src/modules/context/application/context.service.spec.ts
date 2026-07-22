import { transactionMock } from '../../../../test/prisma-transaction-mock';
import { ContextService } from './context.service';
import { serializeContextMd } from '../domain/context-doc';

const PROJECT = {
  id: 'p1',
  userId: 'u1',
  owner: 'acme',
  name: 'repo',
  defaultBranch: 'main',
};

function makeSvc(over: {
  project?: any;
  contextDoc?: string | null;
  assertionRows?: any[];
  lastCommitDates?: Record<string, Date | null>;
  headSha?: string | null;
} = {}) {
  const created: any[] = [];
  const putCalls: any[] = [];
  // `any` explicito: o `$transaction` referencia o proprio fake (o `tx` do
  // callback e ele mesmo); sem a anotacao o TS acusa auto-referencia.
  const prisma: any = {
    project: {
      findFirst: jest.fn().mockResolvedValue('project' in over ? over.project : PROJECT),
      findUnique: jest.fn().mockResolvedValue({
        userId: 'u1',
        owner: 'acme',
        name: 'repo',
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ login: 'rodrigo' }),
    },
    document: {
      findUnique: jest.fn().mockResolvedValue(
        over.contextDoc !== undefined
          ? over.contextDoc === null
            ? null
            : { content: over.contextDoc }
          : null,
      ),
    },
    assertion: {
      findMany: jest.fn().mockResolvedValue(over.assertionRows ?? []),
      findFirst: jest.fn().mockResolvedValue(over.assertionRows?.[0] ?? null),
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn((arg: any) => {
        created.push(...arg.data);
        return Promise.resolve({});
      }),
    },
    $transaction: transactionMock(() => prisma),
  } as any;

  const auth = {
    userToken: jest.fn().mockResolvedValue('user-token'),
    installationToken: jest.fn().mockResolvedValue('inst-token'),
  } as any;
  // O CONTEXT.md vem do GitHub, não do cache do banco: o merge é calculado
  // sobre o conteúdo vivo para poder ser reaplicado num 409 (ARCHITECTURE.md →
  // Resiliência). `over.contextDoc` continua sendo o dial do teste.
  const writeback = {
    getFile: jest.fn().mockResolvedValue(
      over.contextDoc !== undefined && over.contextDoc !== null
        ? { sha: 'base-sha', content: over.contextDoc }
        : null,
    ),
    putFile: jest.fn((params: any) => {
      putCalls.push(params);
      return Promise.resolve('new-blob-sha');
    }),
  } as any;
  const ingestion = {
    enqueueSync: jest.fn().mockResolvedValue({ syncRunId: 'run-1' }),
  } as any;
  const git = {
    getHeadSha: jest.fn().mockResolvedValue(over.headSha ?? 'abcdef0123456789'),
    getLastCommitDate: jest.fn((_t: string, _o: string, _r: string, path: string) =>
      Promise.resolve(over.lastCommitDates?.[path] ?? null),
    ),
  } as any;
  const activity = {
    start: jest.fn().mockResolvedValue('op-1'),
    advance: jest.fn().mockResolvedValue(undefined),
    attachArtifacts: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
  } as any;

  const svc = new ContextService(prisma, auth, writeback, ingestion, git, activity);
  return { svc, prisma, auth, writeback, ingestion, git, activity, created, putCalls };
}

describe('ContextService.capture', () => {
  it('write-back via installation token com autor+data+sha, Operation e re-sync SHA-aware', async () => {
    const { svc, auth, ingestion, activity, putCalls } = makeSvc({ contextDoc: null });
    const { operationId } = await svc.capture('u1', 'p1', {
      statement: 'Não mexer no motor de folha',
      paths: ['lib/folha/'],
      body: 'Drop irreversível.',
    });

    expect(operationId).toBe('op-1');
    expect(auth.installationToken).toHaveBeenCalledWith('p1'); // escrita = bot (ADR-015)
    expect(putCalls).toHaveLength(1);
    const content: string = putCalls[0].content;
    expect(putCalls[0].path).toBe('docs/CONTEXT.md');
    expect(content).toContain('## Não mexer no motor de folha');
    expect(content).toContain('- autor: rodrigo');
    expect(content).toContain('- sha: abcdef0'); // head sha curto
    expect(content).toContain('- status: vigente');
    expect(content).toContain('Drop irreversível.');
    // re-sync SHA-aware: expect(path, blobSha) — sem noop falso
    expect(ingestion.enqueueSync).toHaveBeenCalledWith('p1', {
      path: 'docs/CONTEXT.md',
      blobSha: 'new-blob-sha',
    });
    expect(activity.start).toHaveBeenCalledWith('p1', 'assertion', 'docs/CONTEXT.md');
  });

  it('preserva asserções existentes do arquivo (append, nunca sobrescreve)', async () => {
    const existing = serializeContextMd([
      { statement: 'Antiga', paths: ['a/'], author: 'r', date: '2026-01-01', sha: 'x', status: 'vigente', body: '' },
    ]);
    const { svc, putCalls } = makeSvc({ contextDoc: existing });
    await svc.capture('u1', 'p1', { statement: 'Nova', paths: ['b/'] });
    expect(putCalls[0].content).toContain('## Antiga');
    expect(putCalls[0].content).toContain('## Nova');
  });

  it('sem texto ou sem paths → 400, sem Operation órfã', async () => {
    const { svc, activity } = makeSvc();
    await expect(svc.capture('u1', 'p1', { statement: ' ', paths: ['a'] })).rejects.toThrow(/sem texto/i);
    await expect(svc.capture('u1', 'p1', { statement: 'X', paths: [] })).rejects.toThrow(/sem paths/i);
    expect(activity.start).not.toHaveBeenCalled();
  });

  it('falha no write-back → Operation falha e erro propaga', async () => {
    const { svc, writeback, activity } = makeSvc();
    writeback.putFile.mockRejectedValue(new Error('boom'));
    await expect(
      svc.capture('u1', 'p1', { statement: 'X', paths: ['a'] }),
    ).rejects.toThrow('boom');
    expect(activity.fail).toHaveBeenCalledWith('op-1', 'boom');
  });
});

describe('ContextService.revalidate', () => {
  it('renova data+sha e volta a vigente (critério de aceite)', async () => {
    const doc = serializeContextMd([
      { statement: 'Antiga', paths: ['a/'], author: 'r', date: '2026-01-01', sha: 'aaa', status: 'a-revalidar', body: '' },
    ]);
    const { svc, putCalls } = makeSvc({
      contextDoc: doc,
      assertionRows: [{ id: 'as1', statement: 'Antiga' }],
    });
    await svc.revalidate('u1', 'p1', 'as1');
    const content: string = putCalls[0].content;
    expect(content).toContain('- status: vigente');
    expect(content).toContain('- sha: abcdef0');
    expect(content).not.toContain('- data: 2026-01-01'); // data renovada
  });

  it('asserção removida à mão do arquivo → 400 (o repo é a fonte)', async () => {
    const { svc } = makeSvc({
      contextDoc: serializeContextMd([]),
      assertionRows: [{ id: 'as1', statement: 'Sumiu' }],
    });
    await expect(svc.revalidate('u1', 'p1', 'as1')).rejects.toThrow(/não está mais/i);
  });
});

describe('ContextService.rebuild (ingestão no sync)', () => {
  const doc = serializeContextMd([
    { statement: 'Vigente sem mudança', paths: ['lib/ok/'], author: 'r', date: '2026-06-12', sha: 'aaa', status: 'vigente', body: '' },
    { statement: 'Path mudou depois', paths: ['lib/mudou/'], author: 'r', date: '2026-06-12', sha: 'bbb', status: 'vigente', body: '' },
  ]);

  it('CONTEXT.md editado à mão é ingerido igual; path com commit depois da data → a-revalidar, nunca apagada', async () => {
    const { svc, created } = makeSvc({
      contextDoc: doc,
      lastCommitDates: {
        'lib/ok': new Date('2026-06-01T00:00:00Z'),
        'lib/mudou': new Date('2026-07-01T00:00:00Z'),
      },
    });
    await svc.rebuild('p1');
    expect(created).toHaveLength(2); // nunca apagada
    expect(created.find((a) => a.statement === 'Vigente sem mudança').status).toBe('vigente');
    expect(created.find((a) => a.statement === 'Path mudou depois').status).toBe('a-revalidar');
  });

  it('falha na Commits API → mantém o status do arquivo (tolerante)', async () => {
    const { svc, git, created } = makeSvc({ contextDoc: doc });
    git.getLastCommitDate.mockRejectedValue(new Error('rate limit'));
    await svc.rebuild('p1');
    expect(created).toHaveLength(2);
    expect(created.every((a) => a.status === 'vigente')).toBe(true);
  });

  it('sem CONTEXT.md → tabela zerada (reconstruível)', async () => {
    const { svc, prisma, created } = makeSvc({ contextDoc: null });
    await svc.rebuild('p1');
    expect(prisma.assertion.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(created).toHaveLength(0);
  });

  it('asserção já a-revalidar não re-checa (Decisão 2 do PI — só vigentes)', async () => {
    const stale = serializeContextMd([
      { statement: 'Já rebaixada', paths: ['x/'], author: 'r', date: '2026-01-01', sha: 'x', status: 'a-revalidar', body: '' },
    ]);
    const { svc, git, created } = makeSvc({ contextDoc: stale });
    await svc.rebuild('p1');
    expect(git.getLastCommitDate).not.toHaveBeenCalled();
    expect(created[0].status).toBe('a-revalidar');
  });
});

describe('ContextService.list', () => {
  it('expõe o status sempre (a marca a-revalidar nunca é omitida)', async () => {
    const { svc } = makeSvc({
      assertionRows: [
        { id: '1', statement: 'X', paths: ['a'], author: 'r', assertedAt: '2026-01-01', assertedSha: 's', status: 'a-revalidar', body: '', createdAt: new Date() },
      ],
    });
    const list = await svc.list('u1', 'p1');
    expect(list[0].status).toBe('a-revalidar');
  });
});
