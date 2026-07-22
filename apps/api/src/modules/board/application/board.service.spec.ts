import { transactionMock } from '../../../../test/prisma-transaction-mock';
import { BoardService } from './board.service';

describe('BoardService.syncIssues — persistência da hierarquia (SPEC-024)', () => {
  it('grava parentNumber e hasSubIssues no cache a partir do sync', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 3 });
    // `any` explicito: o `$transaction` referencia o proprio fake (o `tx` do
    // callback e ele mesmo); sem a anotacao o TS acusa auto-referencia.
    const prisma: any = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1', userId: 'u1', owner: 'o', name: 'r' }),
        update: jest.fn().mockResolvedValue({}),
      },
      issue: { deleteMany: jest.fn(), createMany },
      document: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: transactionMock(() => prisma),
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

describe('BoardService.getBoard — épicos fora das colunas (SPEC-024)', () => {
  function issueRow(over: Record<string, unknown> = {}) {
    return {
      number: 1,
      title: 'T',
      column: 'todo',
      priority: null,
      assigneeLogin: null,
      assigneeAvatarUrl: null,
      htmlUrl: 'u',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      closedAt: null,
      closedOutside: false,
      state: 'open',
      parentNumber: null,
      hasSubIssues: false,
      ...over,
    };
  }

  function makeSvc(rows: unknown[]) {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1',
          userId: 'u1',
          installationStatus: 'active',
          needsIssueImport: false,
        }),
      },
      issue: { findMany: jest.fn().mockResolvedValue(rows) },
    } as any;
    return new BoardService(prisma, {} as any, {} as any);
  }

  it('épico (hasSubIssues) sai das colunas e vira faixa; card carrega parentNumber', async () => {
    const svc = makeSvc([
      issueRow({ number: 95, title: 'Épico', column: 'todo', hasSubIssues: true }),
      issueRow({ number: 96, title: 'Filha', column: 'todo', parentNumber: 95 }),
    ]);
    const board = await svc.getBoard('u1', 'p1');

    const todoCards = board.columns.find((c) => c.column === 'todo')!.cards;
    expect(todoCards.map((c) => c.number)).toEqual([96]); // épico NÃO está na coluna
    expect(todoCards[0].parentNumber).toBe(95);
    expect(board.epics).toEqual([
      { number: 95, title: 'Épico', htmlUrl: 'u', closedChildren: 0, totalChildren: 1 },
    ]);
  });

  it('conta filhas fechadas/total na faixa (SPEC-024)', async () => {
    const svc = makeSvc([
      issueRow({ number: 95, title: 'Épico', hasSubIssues: true }),
      issueRow({ number: 96, column: 'doing', parentNumber: 95, state: 'open' }),
      issueRow({ number: 97, column: 'finalized', parentNumber: 95, state: 'closed' }),
    ]);
    const board = await svc.getBoard('u1', 'p1');
    expect(board.epics[0]).toMatchObject({ closedChildren: 1, totalChildren: 2 });
  });

  it('Finalizado ordena por data de finalização (mais recente primeiro), ignorando prioridade', async () => {
    // Decisão do PI 2026-07-20 (emenda à SPEC-005 linha 109): em coluna fechada
    // a prioridade é ruído — o que importa é quando foi aceito. O mock devolve
    // na ordem do banco (prioridade asc), e o serviço tem de reordenar.
    const svc = makeSvc([
      issueRow({ number: 1, column: 'finalized', state: 'closed', priority: 'alta', closedAt: new Date('2026-06-01T10:00:00Z') }),
      issueRow({ number: 2, column: 'finalized', state: 'closed', priority: 'baixa', closedAt: new Date('2026-07-18T10:00:00Z') }),
      issueRow({ number: 3, column: 'finalized', state: 'closed', priority: 'media', closedAt: new Date('2026-07-01T10:00:00Z') }),
    ]);
    const board = await svc.getBoard('u1', 'p1');
    const finalized = board.columns.find((c) => c.column === 'finalized')!.cards;
    // #2 (18/07) → #3 (01/07) → #1 (01/06), apesar de #1 ser prio alta.
    expect(finalized.map((c) => c.number)).toEqual([2, 3, 1]);
  });

  it('Finalizado sem closedAt (fechada fora do ProPlan) vai para o fim, sem inventar data', async () => {
    const svc = makeSvc([
      issueRow({ number: 1, column: 'finalized', state: 'closed', closedAt: null }),
      issueRow({ number: 2, column: 'finalized', state: 'closed', closedAt: new Date('2026-07-18T10:00:00Z') }),
    ]);
    const board = await svc.getBoard('u1', 'p1');
    const finalized = board.columns.find((c) => c.column === 'finalized')!.cards;
    expect(finalized.map((c) => c.number)).toEqual([2, 1]);
  });

  it('colunas abertas mantêm a ordem do banco (prioridade), não a de Finalizado', async () => {
    const svc = makeSvc([
      issueRow({ number: 1, column: 'todo', priority: 'alta', closedAt: null }),
      issueRow({ number: 2, column: 'todo', priority: 'baixa', closedAt: null }),
    ]);
    const board = await svc.getBoard('u1', 'p1');
    const todo = board.columns.find((c) => c.column === 'todo')!.cards;
    expect(todo.map((c) => c.number)).toEqual([1, 2]);
  });

  it('épico fechado não vira faixa (some das colunas abertas)', async () => {
    const svc = makeSvc([
      issueRow({ number: 90, title: 'Épico fechado', column: 'finalized', state: 'closed', hasSubIssues: true }),
    ]);
    const board = await svc.getBoard('u1', 'p1');
    expect(board.epics).toEqual([]);
    // E também não aparece como card em nenhuma coluna.
    const allCards = board.columns.flatMap((c) => c.cards);
    expect(allCards).toHaveLength(0);
  });
});

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
