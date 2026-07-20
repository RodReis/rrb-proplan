import { BoardService } from './board.service';

describe('BoardService.syncIssues — persistência da hierarquia (SPEC-024)', () => {
  it('grava parentNumber e hasSubIssues no cache a partir do sync', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 3 });
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r' }),
        update: jest.fn().mockResolvedValue({}),
      },
      issue: { deleteMany: jest.fn(), createMany },
      document: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    } as any;
    const auth = { userToken: jest.fn().mockResolvedValue('tok') } as any;
    const issues = {
      issuesEnabled: jest.fn().mockResolvedValue(true),
      listIssuesWithHierarchy: jest.fn().mockResolvedValue([
        base({ number: 95, hasSubIssues: true }), // épico
        base({ number: 96, parentNumber: 95 }), // filha
        base({ number: 10 }), // raiz sem hierarquia (ausentes → null/false)
      ]),
    } as any;

    const svc = new BoardService(prisma, auth, issues);
    await svc.syncIssues('p1');

    const rows = createMany.mock.calls[0][0].data;
    const byNumber = new Map(rows.map((r: any) => [r.number, r]));
    expect(byNumber.get(95)).toMatchObject({ parentNumber: null, hasSubIssues: true });
    expect(byNumber.get(96)).toMatchObject({ parentNumber: 95, hasSubIssues: false });
    expect(byNumber.get(10)).toMatchObject({ parentNumber: null, hasSubIssues: false });
  });
});

function base(over: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: 'T',
    state: 'open' as const,
    labels: [],
    assignees: [],
    html_url: 'u',
    created_at: '2026-01-01T00:00:00Z',
    closed_at: null,
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('BoardService.syncIssues — modo degradado', () => {
  it('limpa o cache de issues quando o repo tem Issues desabilitada (não deixa cache órfão)', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r' }) },
      issue: { deleteMany },
    } as any;
    const auth = { userToken: jest.fn().mockResolvedValue('tok') } as any;
    const issues = {
      issuesEnabled: jest.fn().mockResolvedValue(false),
      listIssuesWithHierarchy: jest.fn(),
    } as any;

    const svc = new BoardService(prisma, auth, issues);
    await svc.syncIssues('p1');

    // Cache órfão de sync anterior tem de ser removido — banco = cache, repo é fonte de verdade.
    expect(deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    // Não relê issues em modo degradado (read-only).
    expect(issues.listIssuesWithHierarchy).not.toHaveBeenCalled();
  });
});
