import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { GithubIssuesClient } from './github-issues.client';

/**
 * Leituras pontuais da SPEC-030 (`issueDetail` / `issueTimeline`). Em arquivo
 * separado do `github-issues.client.spec.ts` porque o que se prova aqui é o
 * `read` — o helper novo, com o mapeamento 404 → NotFound que o `write` não tem.
 */
describe('GithubIssuesClient.issueDetail', () => {
  afterEach(() => jest.restoreAllMocks());

  const payload = {
    number: 128,
    title: 'Painel de detalhe',
    state: 'open',
    html_url: 'https://github.com/o/r/issues/128',
    body: '# corpo',
    user: { login: 'RodReis', avatar_url: 'a' },
    assignees: [],
    labels: [{ name: 'prio:media', color: 'fbca04' }],
    created_at: '2026-07-25T20:19:42Z',
    updated_at: '2026-07-26T10:00:00Z',
    closed_at: null,
  };

  it('lê a issue individual — e traz o body, que o listIssues não traz', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    const issue = await new GithubIssuesClient().issueDetail('tok', 'o', 'r', 128);

    expect(issue.body).toBe('# corpo');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/o/r/issues/128',
    );
  });

  it('usa o token recebido no header — leitura é user-to-server (ADR-015)', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));

    await new GithubIssuesClient().issueDetail('token-do-usuario', 'o', 'r', 128);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-do-usuario',
    );
  });

  it('404 vira NotFoundException, não 500 — issue removida é caso normal aqui', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('Not Found', { status: 404 }));

    await expect(
      new GithubIssuesClient().issueDetail('tok', 'o', 'r', 999),
    ).rejects.toThrow(NotFoundException);
  });

  it('401 vira UnauthorizedException (token inválido/expirado)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('unauth', { status: 401 }));

    await expect(
      new GithubIssuesClient().issueDetail('tok', 'o', 'r', 128),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('outros erros (403 rate limit, 500) sobem como Error — a UI degrada', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('rate limited', { status: 403 }));

    await expect(
      new GithubIssuesClient().issueDetail('tok', 'o', 'r', 128),
    ).rejects.toThrow('GitHub GET 403');
  });
});

describe('GithubIssuesClient.issueTimeline', () => {
  afterEach(() => jest.restoreAllMocks());

  it('lê a timeline com per_page=100 — uma página basta para os 10 + "ver todos"', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([{ event: 'opened', created_at: '2026-07-25T20:00:00Z' }]),
          { status: 200 },
        ),
      );

    const events = await new GithubIssuesClient().issueTimeline('tok', 'o', 'r', 128);

    expect(events).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/o/r/issues/128/timeline?per_page=100',
    );
  });

  it('timeline vazia é resposta legítima (issue recém-aberta sem evento mapeável)', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));

    await expect(
      new GithubIssuesClient().issueTimeline('tok', 'o', 'r', 128),
    ).resolves.toEqual([]);
  });
});
