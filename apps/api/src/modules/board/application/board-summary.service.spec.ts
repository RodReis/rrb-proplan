import { BoardSummaryService } from './board-summary.service';

const TENANT = 't1';
const ALVO = { projectId: 'p1', owner: 'RodReis', name: 'rrb-proplan', userId: 'u1' };

function issue(over: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: 'uma issue',
    state: 'open' as const,
    labels: [] as { name: string }[],
    assignees: [],
    html_url: 'https://github.com/x/y/issues/1',
    created_at: '2026-08-01T00:00:00Z',
    closed_at: null,
    updated_at: '2026-08-01T00:00:00Z',
    hasSubIssues: false,
    ...over,
  };
}

function deps(remotas: unknown[] = []) {
  const prisma: any = { project: { findMany: jest.fn().mockResolvedValue([]) } };
  const auth: any = { userToken: jest.fn().mockResolvedValue('tok') };
  const issues: any = {
    listIssuesWithHierarchy: jest.fn().mockResolvedValue(remotas),
    listIssues: jest.fn().mockResolvedValue(remotas),
  };
  return { svc: new BoardSummaryService(prisma, auth, issues), prisma, auth, issues };
}

describe('BoardSummaryService (SPEC-035 §2.6)', () => {
  describe('quais repos entram', () => {
    it('só instalação ATIVA — sem token, seria falha garantida ocupando vaga do teto', async () => {
      const { svc, prisma } = deps();

      await svc.reposDoTenant(TENANT);

      expect(prisma.project.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        installationStatus: 'active',
      });
    });

    it('mais ATIVOS primeiro, e os nunca sincronizados por último', async () => {
      // A ordem importa porque existe teto: quem cai sob "ver todos" tem de ser
      // o repo parado, não o que teve commit ontem.
      const { svc, prisma } = deps();

      await svc.reposDoTenant(TENANT);

      expect(prisma.project.findMany.mock.calls[0][0].orderBy).toEqual([
        { lastCodeCommitAt: { sort: 'desc', nulls: 'last' } },
        { name: 'asc' },
      ]);
    });
  });

  describe('a contagem ao vivo', () => {
    it('vai ao GitHub com o token do USUÁRIO — leitura (ADR-015)', async () => {
      const { svc, auth, issues } = deps();

      await svc.contagemAoVivo(ALVO);

      expect(auth.userToken).toHaveBeenCalledWith('u1');
      expect(issues.listIssuesWithHierarchy).toHaveBeenCalledWith(
        'tok',
        'RodReis',
        'rrb-proplan',
      );
    });

    it('devolve as 6 colunas SEMPRE, inclusive as vazias', async () => {
      // Coluna ausente faria a tela mostrar menos colunas para um repo que para
      // outro, e a pessoa leria como se aquele board fosse diferente.
      const { svc } = deps([]);

      const out = await svc.contagemAoVivo(ALVO);

      expect(out.map((c) => c.column)).toEqual([
        'backlog',
        'todo',
        'doing',
        'done',
        'finalized',
        'discarded',
      ]);
      expect(out.every((c) => c.count === 0)).toBe(true);
    });

    it('classifica pelas MESMAS regras do board — sem 2ª cópia da projeção', async () => {
      // Recontar coluna por conta própria produziria um dashboard que discorda
      // do board na mesma tela, sem ninguém poder saber qual dos dois mente.
      const { svc } = deps([
        issue({ number: 1, state: 'open', labels: [] }), // sem label → backlog
        issue({ number: 2, state: 'open', labels: [{ name: 'proplan:todo' }] }),
        issue({ number: 3, state: 'open', labels: [{ name: 'proplan:doing' }] }),
        // Feito é ABERTA (ADR-011): open + proplan:done.
        issue({ number: 4, state: 'open', labels: [{ name: 'proplan:done' }] }),
        issue({
          number: 5,
          state: 'closed',
          labels: [{ name: 'proplan:finalizado' }],
        }),
      ]);

      const out = await svc.contagemAoVivo(ALVO);
      const por = Object.fromEntries(out.map((c) => [c.column, c.count]));

      expect(por).toMatchObject({
        backlog: 1,
        todo: 1,
        doing: 1,
        done: 1,
        finalized: 1,
        discarded: 0,
      });
    });

    it('ÉPICO não entra na contagem — é faixa, não card (SPEC-024)', async () => {
      // Contá-lo inflaria a coluna com uma faixa, e o número do dashboard
      // divergiria do board para o mesmo repo.
      const { svc } = deps([
        issue({ number: 1, hasSubIssues: true }),
        issue({ number: 2, hasSubIssues: false }),
      ]);

      const out = await svc.contagemAoVivo(ALVO);

      expect(out.find((c) => c.column === 'backlog')?.count).toBe(1);
    });

    it('usa o caminho COM hierarquia — sem ele, épico viraria card', async () => {
      const { svc, issues } = deps();

      await svc.contagemAoVivo(ALVO);

      expect(issues.listIssuesWithHierarchy).toHaveBeenCalled();
      expect(issues.listIssues).not.toHaveBeenCalled();
    });

    it('erro SOBE — quem isola a falha é o orquestrador (§2.11)', async () => {
      const { svc, issues } = deps();
      issues.listIssuesWithHierarchy.mockRejectedValue(new Error('GitHub 500'));

      await expect(svc.contagemAoVivo(ALVO)).rejects.toThrow('GitHub 500');
    });
  });

  describe('nada é persistido (ADR-017)', () => {
    it('a leitura ao vivo não escreve na tabela de issues', async () => {
      const { svc, prisma } = deps([issue()]);
      prisma.issue = {
        create: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      };

      await svc.contagemAoVivo(ALVO);

      expect(prisma.issue.create).not.toHaveBeenCalled();
      expect(prisma.issue.createMany).not.toHaveBeenCalled();
      expect(prisma.issue.deleteMany).not.toHaveBeenCalled();
      expect(prisma.issue.upsert).not.toHaveBeenCalled();
    });
  });
});
