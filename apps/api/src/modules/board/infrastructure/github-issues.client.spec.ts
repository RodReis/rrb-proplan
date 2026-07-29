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

describe('GithubIssuesClient.listIssuesWithHierarchy', () => {
  afterEach(() => jest.restoreAllMocks());

  function graphqlNode(over: Record<string, unknown> = {}) {
    return {
      number: 1,
      title: 'T',
      state: 'OPEN',
      url: 'u',
      createdAt: 't',
      closedAt: null,
      updatedAt: 't',
      labels: { nodes: [] },
      assignees: { nodes: [] },
      parent: null,
      subIssues: { totalCount: 0 },
      ...over,
    };
  }

  function graphqlResponse(nodes: unknown[], hasNextPage = false, endCursor: string | null = null) {
    return jsonResponse({
      data: { repository: { issues: { pageInfo: { hasNextPage, endCursor }, nodes } } },
    });
  }

  it('deriva parentNumber e hasSubIssues do GraphQL', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      graphqlResponse([
        graphqlNode({ number: 95, subIssues: { totalCount: 2 } }), // épico
        graphqlNode({ number: 96, parent: { number: 95 } }), // filha
        graphqlNode({ number: 10 }), // raiz sem hierarquia
      ]),
    );
    const issues = await new GithubIssuesClient().listIssuesWithHierarchy('tok', 'o', 'r');
    const byNumber = new Map(issues.map((i) => [i.number, i]));
    expect(byNumber.get(95)).toMatchObject({ parentNumber: null, hasSubIssues: true });
    expect(byNumber.get(96)).toMatchObject({ parentNumber: 95, hasSubIssues: false });
    expect(byNumber.get(10)).toMatchObject({ parentNumber: null, hasSubIssues: false });
  });

  it('mapeia state/assignees do shape GraphQL para o formato REST', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      graphqlResponse([
        graphqlNode({
          state: 'CLOSED',
          labels: { nodes: [{ name: 'proplan:done' }] },
          assignees: { nodes: [{ login: 'ana', avatarUrl: 'a.png' }] },
        }),
      ]),
    );
    const [issue] = await new GithubIssuesClient().listIssuesWithHierarchy('tok', 'o', 'r');
    expect(issue.state).toBe('closed');
    expect(issue.labels).toEqual([{ name: 'proplan:done' }]);
    expect(issue.assignees).toEqual([{ login: 'ana', avatar_url: 'a.png' }]);
  });

  it('pagina por cursor do GraphQL', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(graphqlResponse([graphqlNode({ number: 1 })], true, 'CUR'))
      .mockResolvedValueOnce(graphqlResponse([graphqlNode({ number: 2 })]));
    const issues = await new GithubIssuesClient().listIssuesWithHierarchy('tok', 'o', 'r');
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('GraphQL com errors → cai no fallback REST (board plano)', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'sub_issues indisponível' }] }))
      .mockResolvedValueOnce(
        jsonResponse([
          { number: 7, title: 'plano', state: 'open', labels: [], assignees: [], html_url: 'u', closed_at: null, updated_at: 't' },
        ]),
      );
    const issues = await new GithubIssuesClient().listIssuesWithHierarchy('tok', 'o', 'r');
    expect(issues.map((i) => i.number)).toEqual([7]);
    // 1ª chamada = GraphQL (POST), 2ª = REST (listIssues)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][0] as string)).toContain('/graphql');
  });

  it('401 no GraphQL propaga (não cai no fallback — token inválido é fatal)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('unauth', { status: 401 }));
    await expect(
      new GithubIssuesClient().listIssuesWithHierarchy('tok', 'o', 'r'),
    ).rejects.toThrow('Token GitHub inválido');
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

/**
 * O rate limit precisa chegar ao chamador **reconhecível** (SPEC-035 §2.11).
 * Com `Error('GitHub issues 403')` genérico, o bloco de repos do dashboard não
 * teria como dizer "o limite volta às HH:MM" e cairia no texto de falha comum —
 * e um bloco vazio leria como **board vazio**, que é a leitura errada mais cara
 * daquela tela.
 */
describe('GithubIssuesClient: rate limit vira erro reconhecível', () => {
  afterEach(() => jest.restoreAllMocks());

  it('403 com cota zerada vira RateLimitError, com o horário de reposição', async () => {
    const epoch = Math.floor(new Date('2026-08-15T16:00:00.000Z').getTime() / 1000);
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('rate limited', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(epoch) },
      }),
    );

    await expect(
      new GithubIssuesClient().listIssues('tok', 'o', 'r'),
    ).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAt: '2026-08-15T16:00:00.000Z',
    });
  });

  it('429 (secundário) também vira RateLimitError', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }));

    await expect(
      new GithubIssuesClient().listIssues('tok', 'o', 'r'),
    ).rejects.toMatchObject({ name: 'RateLimitError' });
  });

  it('403 com cota SOBRANDO continua erro comum — é permissão, não limite', async () => {
    // Tratá-lo como rate limit mandaria a pessoa esperar por algo que não passa
    // sozinho com o tempo.
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('forbidden', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '4999' },
      }),
    );

    await expect(new GithubIssuesClient().listIssues('tok', 'o', 'r')).rejects.toThrow(
      'GitHub issues 403',
    );
  });

  it('rate limit no GraphQL NÃO degrada para o REST — a cota é a mesma', async () => {
    // O fallback gastaria uma 2ª chamada do que já acabou e trocaria um erro que
    // a tela sabe explicar por um genérico.
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response('rate limited', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
      );

    await expect(
      new GithubIssuesClient().listIssuesWithHierarchy('tok', 'o', 'r'),
    ).rejects.toMatchObject({ name: 'RateLimitError' });
    // Uma chamada só: a do GraphQL. Sem fallback.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falha comum do GraphQL AINDA degrada para o REST — o board volta plano', async () => {
    // A degradação continua valendo para o caso que ela existe para cobrir:
    // shape mudou ou feature indisponível.
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { number: 1, title: 'A', state: 'open', labels: [], assignees: [], html_url: 'u', closed_at: null, updated_at: 't' },
          ]),
          { status: 200 },
        ),
      );

    const issues = await new GithubIssuesClient().listIssuesWithHierarchy('tok', 'o', 'r');

    expect(issues.map((i) => i.number)).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
