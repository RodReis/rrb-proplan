import { NotFoundException } from '@nestjs/common';
import { BoardService } from './board.service';

/**
 * `BoardService.cardDetail` (SPEC-030). O que se prova aqui é *orquestração*: de
 * quem é o token, que nada é gravado e que o 404 do projeto não vaza existência.
 * A tradução do payload é do domínio (`card-detail.spec.ts`).
 */
describe('BoardService.cardDetail', () => {
  const issuePayload = {
    number: 128,
    title: 'Painel de detalhe',
    state: 'open' as const,
    html_url: 'https://github.com/o/r/issues/128',
    body: '# corpo',
    user: { login: 'RodReis', avatar_url: 'a' },
    assignees: [],
    labels: [],
    created_at: '2026-07-25T20:19:42Z',
    updated_at: '2026-07-26T10:00:00Z',
    closed_at: null,
  };

  function makeSvc(over: { project?: unknown } = {}) {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue(
          'project' in over
            ? over.project
            : { id: 'p1', userId: 'dono', owner: 'o', name: 'r' },
        ),
      },
      // Presentes de propósito: se algum dia alguém gravar aqui, o teste de
      // "nada persistido" abaixo pega.
      issue: { update: jest.fn(), upsert: jest.fn(), createMany: jest.fn() },
    } as any;
    const auth = { userToken: jest.fn().mockResolvedValue('tok-do-dono') } as any;
    const issues = {
      issueDetail: jest.fn().mockResolvedValue(issuePayload),
      issueTimeline: jest
        .fn()
        .mockResolvedValue([{ event: 'opened', created_at: '2026-07-25T20:19:42Z' }]),
    } as any;
    return { svc: new BoardService(prisma, auth, issues), prisma, auth, issues };
  }

  it('devolve corpo, metadados e trilha do card', async () => {
    const { svc } = makeSvc();
    const detail = await svc.cardDetail('quem-pediu', 'p1', 128);

    expect(detail.number).toBe(128);
    expect(detail.body).toBe('# corpo');
    expect(detail.timeline.map((e) => e.type)).toEqual(['opened']);
    expect(detail.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('lê com o token do DONO do projeto, não de quem pediu (ADR-015)', async () => {
    const { svc, auth, issues } = makeSvc();
    await svc.cardDetail('outro-membro-do-tenant', 'p1', 128);

    expect(auth.userToken).toHaveBeenCalledWith('dono');
    expect(issues.issueDetail).toHaveBeenCalledWith('tok-do-dono', 'o', 'r', 128);
    expect(issues.issueTimeline).toHaveBeenCalledWith('tok-do-dono', 'o', 'r', 128);
  });

  it('NÃO persiste corpo nem trilha — ADR-017, o GitHub serve isso ao vivo', async () => {
    const { svc, prisma } = makeSvc();
    await svc.cardDetail('u1', 'p1', 128);

    expect(prisma.issue.update).not.toHaveBeenCalled();
    expect(prisma.issue.upsert).not.toHaveBeenCalled();
    expect(prisma.issue.createMany).not.toHaveBeenCalled();
  });

  it('projeto de outro usuário devolve 404 sem chamar o GitHub (não vaza existência)', async () => {
    const { svc, issues, auth } = makeSvc({ project: null });

    await expect(svc.cardDetail('intruso', 'p1', 128)).rejects.toThrow(
      NotFoundException,
    );
    expect(auth.userToken).not.toHaveBeenCalled();
    expect(issues.issueDetail).not.toHaveBeenCalled();
  });

  it('busca issue e timeline em paralelo — a latência aparece no open da gaveta', async () => {
    const { svc, issues } = makeSvc();
    let detailResolved = false;

    issues.issueDetail.mockImplementation(
      () =>
        new Promise((r) =>
          setTimeout(() => {
            detailResolved = true;
            r(issuePayload);
          }, 10),
        ),
    );
    // A timeline afirma, quando chamada, que a outra ainda não voltou: só é
    // verdade se as duas partiram juntas (em série, detail já teria resolvido).
    issues.issueTimeline.mockImplementation(() => {
      expect(detailResolved).toBe(false);
      return Promise.resolve([]);
    });

    await svc.cardDetail('u1', 'p1', 128);
    expect(issues.issueTimeline).toHaveBeenCalled();
  });
});
