import { GithubSourceClient } from './github-source.client';

/**
 * O cliente do GitHub do caminho do convite (SPEC-039).
 *
 * `fetch` dobrado. O que se testa aqui não é "o GitHub responde" — é a **tradução
 * de cada resposta dele numa decisão nossa**, e é onde os erros silenciosos
 * moram: `404` que vira "não existe", `403` que NÃO pode virar "não existe", e um
 * PAT só-leitura que enxerga o repo e não consegue convidar ninguém.
 */

function dobrarFetch(
  respostas: Array<{ status: number; body?: unknown }>,
): jest.Mock {
  const fila = [...respostas];
  const mock = jest.fn(async () => {
    const r = fila.shift() ?? { status: 500 };
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      json: async () => r.body ?? {},
    } as Response;
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

describe('findUser', () => {
  it('devolve login canônico, nome e avatar', async () => {
    dobrarFetch([
      { status: 200, body: { login: 'RodReis', name: 'Rodrigo', avatar_url: 'https://a/1' } },
    ]);

    expect(await new GithubSourceClient().findUser('rodreis')).toEqual({
      login: 'RodReis',
      name: 'Rodrigo',
      avatarUrl: 'https://a/1',
    });
  });

  it('usa o `login` do corpo, não o que foi digitado', async () => {
    dobrarFetch([{ status: 200, body: { login: 'RodReis' } }]);

    const u = await new GithubSourceClient().findUser('RODREIS');

    // O GitHub normaliza caixa. Gravar o digitado faria a reconciliação do PR-3
    // comparar `RODREIS` com `RodReis` e nunca encontrar o colaborador.
    expect(u?.login).toBe('RodReis');
  });

  it('404 devolve `null` — é a resposta esperada de "não existe"', async () => {
    dobrarFetch([{ status: 404 }]);

    expect(await new GithubSourceClient().findUser('zzz-nao-existe')).toBeNull();
  });

  it.each([403, 429, 500, 502])('%s LANÇA, não devolve null', async (status) => {
    dobrarFetch([{ status }]);

    // Tratar rate limit ou queda como "não existe" faria o comprador corrigir um
    // dado correto — ou desistir. O sintoma seria "o GitHub caiu e o cliente
    // achou que digitou errado".
    await expect(new GithubSourceClient().findUser('RodReis')).rejects.toThrow(
      new RegExp(String(status)),
    );
  });

  it('200 sem `login` lança em vez de gravar vazio', async () => {
    dobrarFetch([{ status: 200, body: {} }]);

    // Sem esta guarda, `githubUsername` viraria `undefined` e o convite sairia
    // para ninguém — com a licença marcada como se estivesse tudo certo.
    await expect(new GithubSourceClient().findUser('RodReis')).rejects.toThrow(
      /sem login/,
    );
  });

  it('não manda `Authorization` — o endpoint é público', async () => {
    const mock = dobrarFetch([{ status: 200, body: { login: 'RodReis' } }]);

    await new GithubSourceClient().findUser('RodReis');

    // Usar o PAT do tenant aqui gastaria a cota dele numa consulta que não
    // precisa de privilégio nenhum.
    const headers = (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('escapa o username na URL', async () => {
    const mock = dobrarFetch([{ status: 404 }]);

    await new GithubSourceClient().findUser('a/b');

    // A validação de sintaxe no service é a 1ª barreira; o encode é a 2ª. Duas,
    // porque este cliente pode ganhar outro chamador depois.
    expect(mock.mock.calls[0][0]).toBe('https://api.github.com/users/a%2Fb');
  });

  it('manda `User-Agent` — sem ele a API do GitHub recusa', async () => {
    const mock = dobrarFetch([{ status: 200, body: { login: 'x' } }]);

    await new GithubSourceClient().findUser('x');

    const headers = (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toBeTruthy();
  });
});

describe('checkRepoAccess', () => {
  it('PAT com admin no repo passa', async () => {
    dobrarFetch([{ status: 200, body: { permissions: { admin: true } } }]);

    expect(await new GithubSourceClient().checkRepoAccess('pat', 'RodReis/war-room')).toEqual({
      ok: true,
    });
  });

  it('PAT só-leitura falha, mesmo enxergando o repo', async () => {
    dobrarFetch([{ status: 200, body: { permissions: { admin: false, pull: true } } }]);

    const r = await new GithubSourceClient().checkRepoAccess('pat', 'RodReis/war-room');

    // **O caso que o teste de conexão existe para pegar.** Um PAT só-leitura
    // responde 200 no repo e falha só na hora de convidar — descobrir isso na
    // primeira venda é descobrir tarde.
    expect(r).toEqual({
      ok: false,
      reason: 'o token não tem permissão de administração no repositório',
    });
  });

  it('401 diz que o token expirou', async () => {
    dobrarFetch([{ status: 401 }]);

    // PAT fine-grained EXPIRA (limite do GitHub). Expiração silenciosa pararia
    // os convites sem erro visível — este método é metade do que a torna visível.
    expect(await new GithubSourceClient().checkRepoAccess('pat', 'x/y')).toEqual({
      ok: false,
      reason: 'token inválido ou expirado',
    });
  });

  it('404 fala das DUAS causas', async () => {
    dobrarFetch([{ status: 404 }]);

    // A API do GitHub esconde repo privado que o token não vê: "não existe" e
    // "não tenho permissão" chegam iguais. A mensagem não pode escolher uma.
    const r = await new GithubSourceClient().checkRepoAccess('pat', 'x/y');
    expect(r).toEqual({
      ok: false,
      reason: 'repositório não encontrado ou fora do escopo do token',
    });
  });

  it('manda o PAT no header', async () => {
    const mock = dobrarFetch([{ status: 200, body: { permissions: { admin: true } } }]);

    await new GithubSourceClient().checkRepoAccess('pat-secreto', 'x/y');

    const headers = (mock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer pat-secreto');
  });

  it('resposta sem `permissions` não passa por omissão', async () => {
    dobrarFetch([{ status: 200, body: {} }]);

    // `undefined` é falsy e o `!body.permissions?.admin` cobre — mas o teste fica
    // porque a alternativa (`body.permissions.admin === false`) lançaria aqui, e
    // um `try/catch` acima transformaria isso em "token OK".
    expect((await new GithubSourceClient().checkRepoAccess('pat', 'x/y')).ok).toBe(false);
  });
});
