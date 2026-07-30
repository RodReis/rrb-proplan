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

describe('invite', () => {
  it('`201` devolve o id da invitation', async () => {
    dobrarFetch([{ status: 201, body: { id: 12345 } }]);

    // O id é o que permite CANCELAR o convite depois (PR-4). Sem guardá-lo, a
    // revogação só saberia remover colaborador — que é no-op em convite não
    // aceito, e o reembolsado ficaria com acesso ao código.
    expect(await new GithubSourceClient().invite('pat', 'o/r', 'RodReis')).toEqual({
      kind: 'invited',
      invitationId: '12345',
    });
  });

  it('`204` significa "já era colaborador", não convite', async () => {
    dobrarFetch([{ status: 204 }]);

    // **A documentação oficial foi o que me disse isso** — eu teria tratado tudo
    // como convite. `204` acontece na recompra, ou quando o convite é aceito
    // entre a nossa leitura e esta chamada.
    expect(await new GithubSourceClient().invite('pat', 'o/r', 'RodReis')).toEqual({
      kind: 'already_collaborator',
    });
  });

  it('`201` sem `id` devolve `invitationId: null` em vez de mentir', async () => {
    dobrarFetch([{ status: 201, body: {} }]);

    // Gravar `INVITED` com um id inventado faria o PR-4 chamar
    // `DELETE /invitations/undefined`. Nulo é honesto: a reconciliação resolve.
    expect(await new GithubSourceClient().invite('pat', 'o/r', 'x')).toEqual({
      kind: 'invited',
      invitationId: null,
    });
  });

  it('pede permissão `pull`, nunca `push`', async () => {
    const mock = dobrarFetch([{ status: 201, body: { id: 1 } }]);

    await new GithubSourceClient().invite('pat', 'o/r', 'RodReis');

    // O produto é o código-fonte, não a colaboração: `push` deixaria o comprador
    // escrever no repositório do vendedor.
    const init = mock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ permission: 'pull' });
  });

  it.each([
    [401, /expirado/],
    [403, /permissão/],
    [404, /não encontrado/],
    [422, /recusou/],
  ])('%s lança com motivo legível', async (status, esperado) => {
    dobrarFetch([{ status }]);

    // A mensagem vai para `sourceAccessError`, exibido no admin — por isso é
    // construída a partir do STATUS, nunca do corpo ou dos headers da resposta.
    await expect(new GithubSourceClient().invite('pat', 'o/r', 'x')).rejects.toThrow(esperado);
  });

  it('escapa o username na URL', async () => {
    const mock = dobrarFetch([{ status: 204 }]);

    await new GithubSourceClient().invite('pat', 'o/r', 'a b');

    expect(mock.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/o/r/collaborators/a%20b',
    );
  });
});

describe('isCollaborator', () => {
  it('`204` é colaborador; `404` não é', async () => {
    dobrarFetch([{ status: 204 }]);
    expect(await new GithubSourceClient().isCollaborator('pat', 'o/r', 'x')).toBe(true);

    dobrarFetch([{ status: 404 }]);
    expect(await new GithubSourceClient().isCollaborator('pat', 'o/r', 'x')).toBe(false);
  });

  it.each([401, 403, 500])('%s LANÇA, não devolve `false`', async (status) => {
    dobrarFetch([{ status }]);

    // Devolver `false` num `403` faria a reconciliação concluir "não aceitou" —
    // e no PR-4 isso viraria a chamada errada de revogação: cancelar uma
    // invitation que já não existe, deixando o colaborador no repositório.
    await expect(
      new GithubSourceClient().isCollaborator('pat', 'o/r', 'x'),
    ).rejects.toThrow();
  });
});

describe('cancelInvitation', () => {
  it('204 é sucesso e usa DELETE em /invitations/:id', async () => {
    const f = dobrarFetch([{ status: 204 }]);

    await new GithubSourceClient().cancelInvitation('pat', 'o/r', '42');

    const [url, init] = f.mock.calls[0] as [string, { method: string }];
    // Pelo **id da invitation**, não pelo username: é a chamada de quem está em
    // `INVITED`, onde existe convite e não existe assento de colaborador.
    expect(url).toBe('https://api.github.com/repos/o/r/invitations/42');
    expect(init.method).toBe('DELETE');
  });

  it('404 TAMBÉM é sucesso — o convite já não existe', async () => {
    dobrarFetch([{ status: 404 }]);

    // Tratar como erro poria a licença em `FAILED` e faria o admin retentar para
    // sempre uma remoção que não tem o que remover. O caso "aceitou no meio do
    // caminho" volta pela reconciliação, e aí é o `removeCollaborator` que resolve.
    await expect(
      new GithubSourceClient().cancelInvitation('pat', 'o/r', '42'),
    ).resolves.toBeUndefined();
  });

  it.each([401, 403, 500])('%s LANÇA com motivo legível', async (status) => {
    dobrarFetch([{ status }]);

    // O reembolsado continuaria com o convite de pé. Falha aqui tem de virar
    // `FAILED` na licença, nunca sucesso silencioso.
    await expect(
      new GithubSourceClient().cancelInvitation('pat', 'o/r', '42'),
    ).rejects.toThrow();
  });

  it('manda o PAT no header', async () => {
    const f = dobrarFetch([{ status: 204 }]);

    await new GithubSourceClient().cancelInvitation('pat-secreto', 'o/r', '42');

    const [, init] = f.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBe('Bearer pat-secreto');
  });
});

describe('removeCollaborator', () => {
  it('204 é sucesso e usa DELETE em /collaborators/:username', async () => {
    const f = dobrarFetch([{ status: 204 }]);

    await new GithubSourceClient().removeCollaborator('pat', 'o/r', 'RodReis');

    const [url, init] = f.mock.calls[0] as [string, { method: string }];
    // Pelo **username**: é a chamada de quem está em `ACTIVE`, onde o convite já
    // foi aceito e não há mais invitation para cancelar.
    expect(url).toBe('https://api.github.com/repos/o/r/collaborators/RodReis');
    expect(init.method).toBe('DELETE');
  });

  it.each([401, 403, 404, 500])('%s LANÇA — não é remoção bem-sucedida', async (status) => {
    dobrarFetch([{ status }]);

    // Ao contrário do `cancelInvitation`, aqui `404` LANÇA: o `204` do GitHub já
    // cobre "não era colaborador", então um `404` significa que o repositório não
    // foi encontrado — problema de PAT ou de configuração, não acesso removido.
    await expect(
      new GithubSourceClient().removeCollaborator('pat', 'o/r', 'RodReis'),
    ).rejects.toThrow();
  });

  it('escapa o username na URL', async () => {
    const f = dobrarFetch([{ status: 204 }]);

    await new GithubSourceClient().removeCollaborator('pat', 'o/r', 'a b/c');

    const [url] = f.mock.calls[0] as [string];
    expect(url).toBe('https://api.github.com/repos/o/r/collaborators/a%20b%2Fc');
  });
});
