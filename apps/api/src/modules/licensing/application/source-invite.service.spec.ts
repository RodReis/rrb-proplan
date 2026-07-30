import type { PrismaService } from '../../../prisma/prisma.service';
import type { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceError,
  type GithubSourceClient,
  type InviteResult,
} from '../infrastructure/github-source.client';
import { SourceInviteService } from './source-invite.service';

const TENANT = 'tn-1';
const REPO = 'RodReis/war-room';

interface LinhaLicenca {
  id: string;
  sourceAccess: string;
  githubUsername: string | null;
  githubInvitationId?: string | null;
}

/**
 * A reconciliação do convite (SPEC-039 §Job do convite).
 *
 * O que este arquivo protege são as cinco decisões que a fatia não pode errar, e
 * cada uma delas falha **em silêncio** se quebrar:
 *
 * 1. **É reconciliação, não gatilho de data.** Quem informou o username no dia 20
 *    é convidado no dia 20 — um filtro por "exatamente 8 dias" deixaria esse
 *    comprador órfão para sempre.
 * 2. **`204` do GitHub é "já era colaborador"**, não convite. Gravar `INVITED`
 *    deixaria a licença esperando uma aceitação que já aconteceu.
 * 3. **Sem username não é falha.** É pendência humana; contá-la como erro
 *    misturaria o silêncio do comprador com defeito nosso.
 * 4. **Falha na promoção não rebaixa o estado.** `403` não significa "não
 *    aceitou", significa "não deu para saber".
 * 5. **O PAT nunca vai para o banco nem para o log.** `sourceAccessError` é
 *    exibido na tela do admin.
 */
function montar(
  opcoes: {
    licencas?: LinhaLicenca[];
    pat?: string | null;
    repo?: string | null;
    convite?: InviteResult | Error;
    ehColaborador?: boolean | Error;
    cifraQuebrada?: boolean;
  } = {},
) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const licencas = opcoes.licencas ?? [];

  const prisma = {
    licSettings: {
      findFirst: jest.fn(async () => ({
        githubPat: opcoes.pat === undefined ? 'cifrado' : opcoes.pat,
      })),
    },
    licProduct: {
      findFirst: jest.fn(async () => ({
        sourceRepo: opcoes.repo === undefined ? REPO : opcoes.repo,
      })),
    },
    license: {
      findMany: jest.fn(async (args: { where: { sourceAccess: string } }) =>
        licencas.filter((l) => l.sourceAccess === args.where.sourceAccess),
      ),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      }),
    },
  } as unknown as PrismaService;

  const github = {
    invite: jest.fn(async () => {
      if (opcoes.convite instanceof Error) throw opcoes.convite;
      return opcoes.convite ?? ({ kind: 'invited', invitationId: '42' } as InviteResult);
    }),
    isCollaborator: jest.fn(async () => {
      if (opcoes.ehColaborador instanceof Error) throw opcoes.ehColaborador;
      return opcoes.ehColaborador ?? false;
    }),
  } as unknown as GithubSourceClient;

  const crypto = {
    decrypt: jest.fn((v: string) => {
      if (opcoes.cifraQuebrada) throw new Error('bad tag');
      return `pat-em-claro:${v}`;
    }),
  } as unknown as CryptoService;

  return {
    service: new SourceInviteService(prisma, github, crypto),
    prisma,
    github,
    crypto,
    updates,
  };
}

describe('convidar quem está pendente', () => {
  const pendente: LinhaLicenca = {
    id: 'lic-1',
    sourceAccess: 'PENDING',
    githubUsername: 'RodReis',
  };

  it('convida com `pull` e grava `INVITED` + id da invitation', async () => {
    const c = montar({ licencas: [pendente] });

    const r = await c.service.reconcile(TENANT);

    expect(c.github.invite).toHaveBeenCalledWith('pat-em-claro:cifrado', REPO, 'RodReis');
    const gravado = c.updates[0].data as { sourceAccess: string; githubInvitationId: string };
    expect(gravado.sourceAccess).toBe('INVITED');
    // Sem o id, a revogação do PR-4 só saberia remover colaborador — que é no-op
    // em convite não aceito, e o reembolsado ficaria com acesso.
    expect(gravado.githubInvitationId).toBe('42');
    expect(r.convidados).toBe(1);
  });

  it('`204` (já era colaborador) grava `ACTIVE`, não `INVITED`', async () => {
    const c = montar({
      licencas: [pendente],
      convite: { kind: 'already_collaborator' },
    });

    await c.service.reconcile(TENANT);

    const gravado = c.updates[0].data as {
      sourceAccess: string;
      githubInvitationId: string | null;
    };
    // Gravar `INVITED` aqui deixaria a licença esperando para sempre uma
    // aceitação que já aconteceu — e o PR-4 tentaria cancelar uma invitation
    // inexistente.
    expect(gravado.sourceAccess).toBe('ACTIVE');
    expect(gravado.githubInvitationId).toBeNull();
  });

  it('registra `source_invited` na trilha', async () => {
    const c = montar({ licencas: [pendente] });

    await c.service.reconcile(TENANT);

    const trilha = (c.updates[0].data as { events: { create: Record<string, unknown> } })
      .events.create;
    expect(trilha).toMatchObject({
      type: 'source_invited',
      payload: { username: 'RodReis', repo: REPO },
    });
  });

  it('sem username: NÃO é falha, é pendência humana', async () => {
    const c = montar({
      licencas: [{ id: 'lic-1', sourceAccess: 'PENDING', githubUsername: null }],
    });

    const r = await c.service.reconcile(TENANT);

    // Contar isto como erro misturaria o silêncio do comprador com defeito
    // nosso — e a coluna de falhas do admin perderia o significado.
    expect(r.aguardandoUsername).toBe(1);
    expect(r.falhas).toBe(0);
    expect(c.github.invite).not.toHaveBeenCalled();
    // E a licença NÃO é marcada `FAILED`: ela continua na fila, esperando o
    // username que o admin pode corrigir.
    expect(c.updates).toEqual([]);
  });

  it('filtra por `sourceInviteAt <= agora`, não por data exata', async () => {
    const c = montar({ licencas: [pendente] });

    await c.service.reconcile(TENANT);

    const where = (c.prisma.license.findMany as jest.Mock).mock.calls.find(
      (ch) => ch[0].where.sourceAccess === 'PENDING',
    )?.[0].where;
    // **A decisão que define a fatia.** `= hoje` deixaria órfão, para sempre e em
    // silêncio, quem informou o username no dia 9 — o caso mais provável, porque
    // depende de alguém ler e-mail.
    expect(where.sourceInviteAt).toHaveProperty('lte');
    expect(where.sourceInviteAt).not.toHaveProperty('equals');
    expect(where.sourceInviteAt).not.toHaveProperty('gte');
  });

  it('só licença `ACTIVE` é convidada', async () => {
    const c = montar({ licencas: [pendente] });

    await c.service.reconcile(TENANT);

    const where = (c.prisma.license.findMany as jest.Mock).mock.calls.find(
      (ch) => ch[0].where.sourceAccess === 'PENDING',
    )?.[0].where;
    // Sem este filtro, quem foi reembolsado antes do 8º dia (e teve o
    // agendamento limpo, mas ficou `PENDING` por algum caminho) receberia
    // convite ao código-fonte.
    expect(where.status).toBe('ACTIVE');
  });

  it('idempotente por ESTADO: só busca `PENDING`', async () => {
    const c = montar({
      licencas: [
        pendente,
        { id: 'lic-2', sourceAccess: 'INVITED', githubUsername: 'outro' },
        { id: 'lic-3', sourceAccess: 'ACTIVE', githubUsername: 'terceiro' },
      ],
      ehColaborador: false,
    });

    await c.service.reconcile(TENANT);

    // A transição `PENDING → INVITED` é a guarda. Rodar duas vezes no mesmo dia
    // não emite dois convites porque a 2ª rodada não acha mais a licença.
    expect(c.github.invite).toHaveBeenCalledTimes(1);
    expect(c.github.invite).toHaveBeenCalledWith(expect.anything(), REPO, 'RodReis');
  });
});

describe('promover quem aceitou', () => {
  const convidada: LinhaLicenca = {
    id: 'lic-1',
    sourceAccess: 'INVITED',
    githubUsername: 'RodReis',
    githubInvitationId: '42',
  };

  it('colaborador confirmado vira `ACTIVE`', async () => {
    const c = montar({ licencas: [convidada], ehColaborador: true });

    const r = await c.service.reconcile(TENANT);

    // A aceitação é DESCOBERTA: o GitHub não manda webhook nesta configuração.
    // Sem esta consulta, a licença ficaria `INVITED` para sempre.
    expect(c.updates[0].data).toMatchObject({ sourceAccess: 'ACTIVE' });
    expect(r.aceitos).toBe(1);
  });

  it('convite ainda pendente não muda nada', async () => {
    const c = montar({ licencas: [convidada], ehColaborador: false });

    const r = await c.service.reconcile(TENANT);

    // Normal, não é falha: o comprador ainda não clicou no e-mail do GitHub.
    expect(c.updates).toEqual([]);
    expect(r.aceitos).toBe(0);
    expect(r.falhas).toBe(0);
  });

  it('registra `source_invite_accepted` na trilha', async () => {
    const c = montar({ licencas: [convidada], ehColaborador: true });

    await c.service.reconcile(TENANT);

    const trilha = (c.updates[0].data as { events: { create: Record<string, unknown> } })
      .events.create;
    expect(trilha).toMatchObject({ type: 'source_invite_accepted' });
  });

  it('falha ao consultar NÃO rebaixa o estado', async () => {
    const c = montar({
      licencas: [convidada],
      ehColaborador: new GithubSourceError('token inválido ou expirado', 401),
    });

    const r = await c.service.reconcile(TENANT);

    // `401` não significa "não aceitou": significa "não deu para saber".
    // Rebaixar para `FAILED` faria a lista de pendências acusar o comprador por
    // um problema do NOSSO token — e o PR-4 poderia chamar a API errada depois.
    const gravado = c.updates[0].data as Record<string, unknown>;
    expect(gravado.sourceAccess).toBeUndefined();
    expect(gravado.sourceAccessError).toBe('token inválido ou expirado');
    expect(r.falhas).toBe(1);
  });
});

describe('falha do GitHub ao convidar', () => {
  const pendente: LinhaLicenca = {
    id: 'lic-1',
    sourceAccess: 'PENDING',
    githubUsername: 'RodReis',
  };

  it.each([
    [401, 'token inválido ou expirado'],
    [403, 'token sem permissão de administração no repositório'],
    [404, 'repositório não encontrado ou fora do escopo do token'],
  ])('%s vira `FAILED` com motivo legível', async (status, motivo) => {
    const c = montar({
      licencas: [pendente],
      convite: new GithubSourceError(motivo, status),
    });

    const r = await c.service.reconcile(TENANT);

    // "Reembolsado que continua colaborador" é a falha que custa dinheiro — ela
    // não pode viver só no log, onde ninguém olha sem motivo.
    expect(c.updates[0].data).toMatchObject({
      sourceAccess: 'FAILED',
      sourceAccessError: motivo,
    });
    expect(r.falhas).toBe(1);
  });

  it('a licença fica intacta além do estado do acesso', async () => {
    const c = montar({
      licencas: [pendente],
      convite: new GithubSourceError('rede', 500),
    });

    await c.service.reconcile(TENANT);

    // Critério de aceite: falha do GitHub não revoga nem expira licença. O que
    // o comprador pagou continua valendo; o que falta é o acesso ao repo.
    const gravado = Object.keys(c.updates[0].data);
    expect(gravado).not.toContain('status');
    expect(gravado).not.toContain('revokedAt');
    expect(gravado).not.toContain('expiresAt');
  });

  it('uma falha não interrompe as outras licenças', async () => {
    let chamadas = 0;
    const c = montar({
      licencas: [
        pendente,
        { id: 'lic-2', sourceAccess: 'PENDING', githubUsername: 'outro' },
      ],
    });
    (c.github.invite as jest.Mock).mockImplementation(async () => {
      chamadas += 1;
      if (chamadas === 1) throw new GithubSourceError('rede', 500);
      return { kind: 'invited', invitationId: '99' };
    });

    const r = await c.service.reconcile(TENANT);

    // Uma rodada que morre na primeira falha deixaria toda a fila atrás dela sem
    // convite — e o sintoma seria "o job roda e ninguém é convidado".
    expect(r.falhas).toBe(1);
    expect(r.convidados).toBe(1);
  });

  it('o motivo gravado não carrega o PAT', async () => {
    const c = montar({
      licencas: [pendente],
      convite: new Error('request failed: Bearer pat-em-claro:cifrado'),
    });

    await c.service.reconcile(TENANT);

    // **Defeito real, pego por este teste.** `sourceAccessError` é EXIBIDO na
    // tela do admin, e a mensagem de um erro qualquer de `fetch` pode arrastar o
    // header `Authorization` inteiro — entregando `administration:write` no
    // repositório privado a quem abrir a página de pendências.
    //
    // Só mensagem CURADA (construída por nós a partir do status) chega ao banco;
    // erro desconhecido vira texto fixo.
    const erro = (c.updates[0].data as { sourceAccessError: string }).sourceAccessError;
    expect(erro).not.toContain('pat-em-claro');
    expect(erro).toMatch(/ver o log do servidor/);
  });

  it('nem o log carrega o PAT', async () => {
    const c = montar({
      licencas: [pendente],
      convite: new Error('request failed: Bearer pat-em-claro:cifrado'),
    });
    const warn = jest
      .spyOn((c.service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await c.service.reconcile(TENANT);

    // Log não é superfície pública, mas também não é lugar de segredo: quem lê
    // log de produção não deveria sair dele com um token de escrita em repo
    // privado. Mesmo princípio do arch-spec que proíbe a chave de licença em
    // `logger.*`.
    const registrado = warn.mock.calls.map((ch) => String(ch[0])).join('\n');
    expect(registrado).toContain('[redigido]');
    expect(registrado).not.toContain('pat-em-claro');
  });
});

describe('configuração ausente', () => {
  it('sem PAT: não é erro do job, é pendência de configuração', async () => {
    const c = montar({
      pat: null,
      licencas: [{ id: 'lic-1', sourceAccess: 'PENDING', githubUsername: 'RodReis' }],
    });

    const r = await c.service.reconcile(TENANT);

    // Marcar as licenças como `FAILED` aqui encheria a lista de pendências de
    // linhas cuja causa é uma só: o token que ninguém cadastrou.
    expect(r).toEqual({ convidados: 0, aceitos: 0, falhas: 0, aguardandoUsername: 0 });
    expect(c.updates).toEqual([]);
    expect(c.github.invite).not.toHaveBeenCalled();
  });

  it('sem repo configurado: mesma coisa', async () => {
    const c = montar({
      repo: null,
      licencas: [{ id: 'lic-1', sourceAccess: 'PENDING', githubUsername: 'RodReis' }],
    });

    expect(await c.service.reconcile(TENANT)).toMatchObject({ convidados: 0, falhas: 0 });
    expect(c.github.invite).not.toHaveBeenCalled();
  });

  it('PAT ilegível (chave trocada) não convida ninguém', async () => {
    const c = montar({
      cifraQuebrada: true,
      licencas: [{ id: 'lic-1', sourceAccess: 'PENDING', githubUsername: 'RodReis' }],
    });

    await c.service.reconcile(TENANT);

    // Sem o PAT não há convite — e o caminho é o mesmo de "não configurado", em
    // vez de estourar a rodada inteira com uma exceção de crypto.
    expect(c.github.invite).not.toHaveBeenCalled();
  });

  it('o PAT é descriptografado, nunca usado cifrado', async () => {
    const c = montar({
      licencas: [{ id: 'lic-1', sourceAccess: 'PENDING', githubUsername: 'RodReis' }],
    });

    await c.service.reconcile(TENANT);

    // Mandar o valor cifrado no header daria `401` em toda chamada, e a lista de
    // pendências diria "token inválido" sobre um token perfeitamente válido.
    expect(c.crypto.decrypt).toHaveBeenCalledWith('cifrado');
    expect(c.github.invite).toHaveBeenCalledWith('pat-em-claro:cifrado', REPO, 'RodReis');
  });
});
