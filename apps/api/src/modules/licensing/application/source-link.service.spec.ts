import type { PrismaService } from '../../../prisma/prisma.service';
import type { MailService } from '../../mail/application/mail.service';
import type { GithubSourceClient } from '../infrastructure/github-source.client';
import { hashToken } from '../domain/source-token';
import {
  GithubUnavailableError,
  GithubUserNotFoundError,
  SourceLinkInvalidError,
  SourceLinkService,
  SourceLinkUsedError,
} from './source-link.service';

const TENANT = 'tn-1';
const LICENCA = 'lic-1';
const LINK = 'link-1';
const TOKEN = 'tok-abc';

const USUARIO = { login: 'RodReis', name: 'Rodrigo', avatarUrl: 'https://avatar/1' };

/** Uma linha como a `resolve_source_link` devolve. */
function linhaResolvida(over: Record<string, unknown> = {}) {
  return {
    id: LINK,
    used_at: null as Date | null,
    tenant_id: TENANT,
    license_id: LICENCA,
    license_status: 'ACTIVE' as const,
    source_access: 'NONE',
    product_name: 'War Room',
    edition_name: 'Com código-fonte',
    ...over,
  };
}

/**
 * Dobra do Prisma, do `mail` e do GitHub. O RLS e a função SQL são do banco
 * (provados no int-spec do PR-1); aqui o que se testa é a REGRA em volta —
 * quando grava, o que grava, o que recusa e **o que não vaza**.
 */
function montar(
  opcoes: {
    resolvido?: ReturnType<typeof linhaResolvida> | null;
    usuario?: typeof USUARIO | null;
    githubLanca?: boolean;
    /** Quantas linhas o `updateMany` do queimar-link diz ter afetado. */
    queimou?: number;
    licenca?: Record<string, unknown> | null;
  } = {},
) {
  const enviados: Array<Record<string, unknown>> = [];
  const eventos: Array<Record<string, unknown>> = [];
  const updatesLicenca: Array<Record<string, unknown>> = [];
  const linksCriados: Array<Record<string, unknown>> = [];
  const linksInvalidados: Array<Record<string, unknown>> = [];

  const licencaPadrao = {
    customerEmail: 'comprador@exemplo.com',
    customerName: 'Rodrigo',
    sourceInviteAt: new Date('2026-08-07T00:00:00Z'),
    edition: { name: 'Com código-fonte', product: { name: 'War Room' } },
  };
  const licenca =
    opcoes.licenca === null ? null : { ...licencaPadrao, ...(opcoes.licenca ?? {}) };

  const tx = {
    licSourceLink: {
      updateMany: jest.fn(async (args: Record<string, unknown>) => {
        linksInvalidados.push(args);
        return { count: opcoes.queimou ?? 1 };
      }),
      create: jest.fn(async (args: Record<string, unknown>) => {
        linksCriados.push(args);
        return { id: 'novo' };
      }),
    },
    license: {
      update: jest.fn(async (args: Record<string, unknown>) => {
        updatesLicenca.push(args);
        return {};
      }),
    },
  };

  const prisma = {
    $queryRaw: jest.fn(async () =>
      opcoes.resolvido === undefined
        ? [linhaResolvida()]
        : opcoes.resolvido
          ? [opcoes.resolvido]
          : [],
    ),
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    runInTenantContext: jest.fn(async (_ids: string[], fn: () => Promise<unknown>) => fn()),
    license: {
      findFirst: jest.fn(async () => licenca),
      findUnique: jest.fn(async () => licenca),
    },
    licEvent: {
      create: jest.fn(async (args: Record<string, unknown>) => {
        eventos.push(args.data as Record<string, unknown>);
        return {};
      }),
    },
  } as unknown as PrismaService;

  const mail = {
    send: jest.fn(async (input: Record<string, unknown>) => {
      enviados.push(input);
      return 'entrega-1';
    }),
  } as unknown as MailService;

  const github = {
    findUser: jest.fn(async () => {
      if (opcoes.githubLanca) throw new Error('rede fora');
      return opcoes.usuario === undefined ? USUARIO : opcoes.usuario;
    }),
  } as unknown as GithubSourceClient;

  return {
    service: new SourceLinkService(prisma, mail, github),
    prisma,
    mail,
    github,
    enviados,
    eventos,
    updatesLicenca,
    linksCriados,
    linksInvalidados,
    tx,
  };
}

describe('criar o link e mandar o e-mail', () => {
  it('grava só o hash — o token não vai para o banco', async () => {
    const c = montar();

    const { token } = await c.service.createAndSend(TENANT, LICENCA);

    const gravado = c.linksCriados[0].data as { tokenHash: string };
    // A garantia central: o que persiste não abre o link. Vazamento do banco
    // não entrega acesso a código-fonte.
    expect(gravado.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(c.linksCriados)).not.toContain(token);
  });

  it('invalida o link anterior na mesma transação', async () => {
    const c = montar();

    await c.service.createAndSend(TENANT, LICENCA);

    // Dois links vivos para a mesma licença significaria que usar um não fecha o
    // outro — e o uso único deixaria de ser único.
    expect(c.linksInvalidados[0]).toMatchObject({
      where: { licenseId: LICENCA, usedAt: null },
    });
    // Na MESMA transação do create: separá-las abriria a janela em que dois
    // links servem.
    expect(c.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('manda a URL da web, não o token cru nem a base da API', async () => {
    const c = montar();

    const { token } = await c.service.createAndSend(TENANT, LICENCA);

    const dados = c.enviados[0].data as { url: string };
    expect(c.enviados[0].template).toBe('source_username_request');
    // `/s/:token` é rota React. Mandar a base da API levaria o comprador a um
    // JSON — ou ao catálogo, sem erro visível. Já aconteceu nesta base com
    // `/b/` (web) e `/c/` (API).
    expect(dados.url).toBe(`http://localhost:5180/s/${token}`);
    expect(dados.url).not.toContain('3311');
  });

  it('registra `source_invite_sent` na trilha, sem o token', async () => {
    const c = montar();

    const { token } = await c.service.createAndSend(TENANT, LICENCA);

    expect(c.eventos[0]).toMatchObject({ type: 'source_invite_sent' });
    // O critério de aceite: o token não aparece em `LicEvent.payload`.
    expect(JSON.stringify(c.eventos)).not.toContain(token);
  });

  it('licença inexistente não cria link', async () => {
    const c = montar({ licenca: null });

    await expect(c.service.createAndSend(TENANT, LICENCA)).rejects.toThrow(
      SourceLinkInvalidError,
    );
    expect(c.linksCriados).toEqual([]);
    expect(c.enviados).toEqual([]);
  });
});

describe('abrir o link (rota pública)', () => {
  it('link válido devolve só produto e edição', async () => {
    const c = montar();

    const r = await c.service.resolvePublic(TOKEN);

    expect(r).toEqual({
      status: 'valid',
      product: 'War Room',
      edition: 'Com código-fonte',
    });
  });

  it('não devolve dado pessoal do comprador', async () => {
    const c = montar();

    const r = await c.service.resolvePublic(TOKEN);

    // A página é PÚBLICA: quem tem a URL veria o e-mail de quem comprou. Prova
    // por ausência, mesmo desenho da SPEC-034/035.
    const chaves = Object.keys(r);
    expect(chaves).not.toContain('customerEmail');
    expect(chaves).not.toContain('customerName');
    expect(chaves).not.toContain('licenseId');
    expect(chaves).not.toContain('tenantId');
    expect(JSON.stringify(r)).not.toContain('comprador@exemplo.com');
  });

  it('link já usado devolve `used`, não `invalid`', async () => {
    const c = montar({ resolvido: linhaResolvida({ used_at: new Date() }) });

    const r = await c.service.resolvePublic(TOKEN);

    // O critério de aceite depende disto: reabrir mostra "já utilizado", nunca o
    // formulário de novo. Se virasse `invalid`, quem informou e recarregou
    // concluiria que o envio falhou — e informaria outra vez.
    expect(r.status).toBe('used');
    // **Produto e edição continuam vindo**, e isso é decisão: quem reabre o
    // próprio link precisa reconhecer que era o dele ("já utilizado" sozinho não
    // diz de qual compra). Não é vazamento — quem chegou até aqui com um token
    // válido já sabia o que comprou. Dado pessoal é que não sai (teste acima).
    expect(r.product).toBe('War Room');
  });

  it('token inexistente e de outro tenant respondem igual', async () => {
    // Os dois chegam como lista vazia da função SQL — é o que impede enumerar
    // tokens comparando respostas.
    const c = montar({ resolvido: null });

    expect(await c.service.resolvePublic(TOKEN)).toEqual({ status: 'invalid' });
  });

  it('licença revogada responde `invalid`, sem dizer que existiu', async () => {
    const c = montar({ resolvido: linhaResolvida({ license_status: 'REVOKED' }) });

    const r = await c.service.resolvePublic(TOKEN);

    // Coletar username de licença revogada seria coletar dado pessoal sem
    // finalidade (LGPD): o convite nunca sairia. E um estado próprio aqui
    // vazaria que a licença existiu.
    expect(r).toEqual({ status: 'invalid' });
  });
});

describe('consultar o username no GitHub', () => {
  it('devolve avatar, nome e login para a confirmação', async () => {
    const c = montar();

    // Validar existência não é validar identidade: é a pessoa que confirma,
    // olhando a foto. Sem o avatar, um typo convida um estranho.
    expect(await c.service.lookupUsername(TOKEN, 'RodReis')).toEqual(USUARIO);
  });

  it('não grava nada', async () => {
    const c = montar();

    await c.service.lookupUsername(TOKEN, 'RodReis');

    expect(c.updatesLicenca).toEqual([]);
    expect(c.linksInvalidados).toEqual([]);
  });

  it('username inexistente lança `GithubUserNotFoundError` nomeando o login', async () => {
    const c = montar({ usuario: null });

    await expect(c.service.lookupUsername(TOKEN, 'zzz-nao-existe')).rejects.toThrow(
      /zzz-nao-existe/,
    );
  });

  it.each(['../../admin', 'user name', '-x', 'a'.repeat(40)])(
    'recusa `%s` ANTES de chamar a rede',
    async (username) => {
      const c = montar();

      await expect(c.service.lookupUsername(TOKEN, username)).rejects.toThrow(
        GithubUserNotFoundError,
      );
      // A razão de validar sintaxe primeiro: sem isso o valor é interpolado em
      // `GET /users/:username` e a requisição sai para outro endpoint da API.
      expect(c.github.findUser).not.toHaveBeenCalled();
    },
  );

  it('GitHub fora do ar NÃO é "usuário não existe"', async () => {
    const c = montar({ githubLanca: true });

    // Dizer que é faria o comprador corrigir um dado correto — ou desistir. É o
    // precedente do FIX #136: `429`/`5xx` não viram "link inválido".
    await expect(c.service.lookupUsername(TOKEN, 'RodReis')).rejects.toThrow(
      GithubUnavailableError,
    );
  });

  it('link usado não consulta o GitHub', async () => {
    const c = montar({ resolvido: linhaResolvida({ used_at: new Date() }) });

    await expect(c.service.lookupUsername(TOKEN, 'RodReis')).rejects.toThrow(
      SourceLinkUsedError,
    );
    // Sem a guarda, o endpoint viraria proxy anônimo de consulta ao GitHub.
    expect(c.github.findUser).not.toHaveBeenCalled();
  });

  it('link inválido não consulta o GitHub', async () => {
    const c = montar({ resolvido: null });

    await expect(c.service.lookupUsername(TOKEN, 'RodReis')).rejects.toThrow(
      SourceLinkInvalidError,
    );
    expect(c.github.findUser).not.toHaveBeenCalled();
  });
});

describe('gravar o username confirmado', () => {
  it('grava o login canônico do GitHub, não o que foi digitado', async () => {
    const c = montar();

    await c.service.setUsername(TOKEN, 'rodreis', true);

    const dados = c.updatesLicenca[0].data as { githubUsername: string };
    // O GitHub normaliza caixa. Convidar com a caixa errada funciona, mas a
    // reconciliação do PR-3 compara strings e não encontraria o colaborador.
    expect(dados.githubUsername).toBe('RodReis');
  });

  it('deixa a licença em `PENDING`, nunca `INVITED`', async () => {
    const c = montar();

    await c.service.setUsername(TOKEN, 'RodReis', true);

    const dados = c.updatesLicenca[0].data as { sourceAccess: string };
    // O comprador informou o username; o convite ainda não saiu. `INVITED` aqui
    // afirmaria um convite que ninguém emitiu — e o job do PR-3, que seleciona
    // `PENDING`, nunca convidaria esta licença.
    expect(dados.sourceAccess).toBe('PENDING');
  });

  it('queima o link na MESMA transação do username', async () => {
    const c = montar();

    await c.service.setUsername(TOKEN, 'RodReis', true);

    // Separá-las abriria a janela em que o username está gravado e o link ainda
    // serve — e o link serve para gravar username: quem tivesse a URL
    // sobrescreveria o dado de quem comprou.
    expect(c.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(c.linksInvalidados[0]).toMatchObject({
      where: { id: LINK, usedAt: null },
    });
    expect(c.tx.license.update).toHaveBeenCalled();
  });

  it('corrida: o segundo `POST` simultâneo não sobrescreve o primeiro', async () => {
    // `updateMany` afetando 0 linhas = outra requisição queimou o link primeiro.
    // Um `if` antes do update deixaria as duas passarem.
    const c = montar({ queimou: 0 });

    await expect(c.service.setUsername(TOKEN, 'RodReis', true)).rejects.toThrow(
      SourceLinkUsedError,
    );
  });

  it('sem `confirm` não grava — a confirmação é exigida no servidor', async () => {
    const c = montar();

    await expect(c.service.setUsername(TOKEN, 'RodReis', false)).rejects.toThrow(
      GithubUserNotFoundError,
    );
    // Um POST direto sem `confirm` pularia a confirmação por avatar, que é uma
    // das três mitigações do risco aceito.
    expect(c.updatesLicenca).toEqual([]);
    expect(c.github.findUser).not.toHaveBeenCalled();
  });

  it('manda o e-mail nomeando quem será convidado', async () => {
    const c = montar();

    await c.service.setUsername(TOKEN, 'RodReis', true);

    const email = c.enviados[0];
    const dados = email.data as { githubUsername: string; inviteAt: string | null };
    expect(email.template).toBe('source_username_confirmed');
    // É a 3ª mitigação, e a única que age depois do fato: se o comprador
    // confirmou o login de um estranho sem olhar, é aqui que ele percebe —
    // enquanto ainda dá tempo.
    expect(dados.githubUsername).toBe('RodReis');
    expect(dados.inviteAt).toBe('2026-08-07T00:00:00.000Z');
  });

  it('registra `source_username_set` com o login, sem o token', async () => {
    const c = montar();

    await c.service.setUsername(TOKEN, 'RodReis', true);

    expect(c.eventos[0]).toMatchObject({
      type: 'source_username_set',
      payload: { username: 'RodReis' },
    });
    // O login é público no GitHub e é o que o admin precisa ver na trilha. O
    // token, não.
    expect(JSON.stringify(c.eventos)).not.toContain(TOKEN);
  });

  it('escreve sob contexto de tenant', async () => {
    const c = montar();

    await c.service.setUsername(TOKEN, 'RodReis', true);

    // Sem ele o RLS é fail-closed e o update grava ZERO LINHAS sem erro: a rota
    // responderia 200 e o username não estaria em lugar nenhum. É a classe de
    // bug que já custou 6 ocorrências nesta base.
    expect(c.prisma.runInTenantContext).toHaveBeenCalledWith(
      [TENANT],
      expect.any(Function),
    );
  });

  it('GitHub fora do ar não queima o link', async () => {
    const c = montar({ githubLanca: true });

    await expect(c.service.setUsername(TOKEN, 'RodReis', true)).rejects.toThrow(
      GithubUnavailableError,
    );
    // Queimar aqui deixaria o comprador sem link por causa de uma falha nossa —
    // e a correção passaria a exigir o admin.
    expect(c.linksInvalidados).toEqual([]);
    expect(c.updatesLicenca).toEqual([]);
  });
});
