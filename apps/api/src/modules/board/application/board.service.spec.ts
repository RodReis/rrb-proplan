import { BoardService } from './board.service';

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
