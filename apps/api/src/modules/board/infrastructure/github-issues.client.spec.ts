import { GithubIssuesClient } from './github-issues.client';

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe('GithubIssuesClient.listIssues', () => {
  afterEach(() => jest.restoreAllMocks());

  it('descarta PRs (payload com pull_request) — só issues viram card', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse([
        { number: 1, title: 'Issue real', state: 'open', labels: [], assignees: [], html_url: 'u', closed_at: null, updated_at: 't' },
        { number: 2, title: 'PR disfarçado', state: 'open', labels: [], assignees: [], html_url: 'u', closed_at: null, updated_at: 't', pull_request: { url: 'x' } },
      ]),
    );
    const issues = await new GithubIssuesClient().listIssues('tok', 'o', 'r');
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it('pagina seguindo o Link rel=next', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(
          [{ number: 1, title: 'A', state: 'open', labels: [], assignees: [], html_url: 'u', closed_at: null, updated_at: 't' }],
          { link: '<https://api.github.com/next>; rel="next"' },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ number: 2, title: 'B', state: 'open', labels: [], assignees: [], html_url: 'u', closed_at: null, updated_at: 't' }]),
      );
    const issues = await new GithubIssuesClient().listIssues('tok', 'o', 'r');
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('GithubIssuesClient.ensureLabel', () => {
  afterEach(() => jest.restoreAllMocks());

  it('422 (label já existe) é tratado como sucesso', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('exists', { status: 422 }));
    await expect(
      new GithubIssuesClient().ensureLabel('tok', 'o', 'r', 'proplan:todo', 'cccccc'),
    ).resolves.toBeUndefined();
  });

  it('erro real (500) propaga', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      new GithubIssuesClient().ensureLabel('tok', 'o', 'r', 'proplan:todo', 'cccccc'),
    ).rejects.toThrow('GitHub create label 500');
  });
});
