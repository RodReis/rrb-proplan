import type { PrismaService } from '../../../prisma/prisma.service';
import type { CryptoService } from '../../identity/infrastructure/crypto.service';
import type { GithubSourceClient } from '../infrastructure/github-source.client';
import { SourceAdminService } from './source-admin.service';
import type { SourceInviteService } from './source-invite.service';
import type { RevokeOutcome, SourceRevokeService } from './source-revoke.service';

const TENANT = 'tn-1';
const REPO = 'RodReis/war-room';

/**
 * Admin do acesso ao repo source (SPEC-039 PR-5).
 *
 * O que este arquivo protege são as decisões em que "salvei e nada aconteceu" é o
 * sintoma — todas silenciosas:
 *
 * 1. **Trocar username cancela o convite anterior.** Sem isso, o username errado
 *    segue podendo aceitar e o certo nunca recebe convite.
 * 2. **Falha ao remover o acesso antigo NÃO grava o username novo** — perder o
 *    `githubUsername` é perder quem ainda tem acesso.
 * 3. **`FAILED` volta a `PENDING` antes de reemitir**, senão a rodada ignora a
 *    licença e o botão não faz nada.
 * 4. **O PAT é cifrado, write-only, e o teste checa PERMISSÃO** — um PAT
 *    só-leitura enxerga o repo e não convida ninguém.
 * 5. **O teste de conexão nunca lança**: o resultado *é* "seu token está errado".
 */
function montar(
  opcoes: {
    licenca?: Record<string, unknown> | null;
    usuario?: { login: string; name: string | null; avatarUrl: string | null } | null;
    usuarioErro?: Error;
    revokeOutcome?: RevokeOutcome;
    pat?: string | null;
    repo?: string | null;
    acesso?: { ok: true } | { ok: false; reason: string };
    acessoErro?: Error;
    cifraQuebrada?: boolean;
    settingsExiste?: boolean;
    pendentes?: Array<Record<string, unknown>>;
  } = {},
) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const settingsUpdates: Array<Record<string, unknown>> = [];

  const prisma = {
    license: {
      findFirst: jest.fn(async () => (opcoes.licenca === undefined ? null : opcoes.licenca)),
      findMany: jest.fn(async () => opcoes.pendentes ?? []),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      }),
    },
    licSettings: {
      findUnique: jest.fn(async () => {
        if (opcoes.settingsExiste === false) return null;
        return { id: 'st-1', githubPat: opcoes.pat === undefined ? 'cifrado' : opcoes.pat };
      }),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        settingsUpdates.push(args.data);
        return {};
      }),
    },
    licProduct: {
      findFirst: jest.fn(async () => ({
        sourceRepo: opcoes.repo === undefined ? REPO : opcoes.repo,
      })),
    },
  } as unknown as PrismaService;

  const github = {
    findUser: jest.fn(async () => {
      if (opcoes.usuarioErro) throw opcoes.usuarioErro;
      return opcoes.usuario === undefined
        ? { login: 'RodReis', name: 'Rodrigo', avatarUrl: null }
        : opcoes.usuario;
    }),
    checkRepoAccess: jest.fn(async () => {
      if (opcoes.acessoErro) throw opcoes.acessoErro;
      return opcoes.acesso ?? { ok: true };
    }),
  } as unknown as GithubSourceClient;

  const crypto = {
    encrypt: jest.fn((v: string) => `cifra(${v})`),
    decrypt: jest.fn((v: string) => {
      if (opcoes.cifraQuebrada) throw new Error('bad tag');
      return `claro(${v})`;
    }),
  } as unknown as CryptoService;

  const invites = {
    reconcile: jest.fn(async () => ({
      convidados: 1,
      aceitos: 0,
      falhas: 0,
      aguardandoUsername: 0,
    })),
  } as unknown as SourceInviteService;

  const revokes = {
    revoke: jest.fn(async () => opcoes.revokeOutcome ?? ('invitation_canceled' as RevokeOutcome)),
  } as unknown as SourceRevokeService;

  return {
    service: new SourceAdminService(prisma, github, crypto, invites, revokes),
    prisma,
    github,
    crypto,
    invites,
    revokes,
    updates,
    settingsUpdates,
  };
}

describe('lista de pendências', () => {
  it('classifica o motivo no SERVIDOR, não na tela', async () => {
    const c = montar({
      pendentes: [
        {
          id: 'l1',
          customerEmail: 'a@x.com',
          customerName: 'A',
          sourceAccess: 'PENDING',
          githubUsername: null,
          sourceInviteAt: new Date('2026-07-01'),
          sourceAccessError: null,
          edition: { name: 'Completa' },
        },
        {
          id: 'l2',
          customerEmail: 'b@x.com',
          customerName: null,
          sourceAccess: 'INVITED',
          githubUsername: 'bob',
          sourceInviteAt: new Date('2026-07-02'),
          sourceAccessError: null,
          edition: { name: 'Completa' },
        },
        {
          id: 'l3',
          customerEmail: 'c@x.com',
          customerName: 'C',
          sourceAccess: 'FAILED',
          githubUsername: 'carol',
          sourceInviteAt: new Date('2026-07-03'),
          sourceAccessError: 'token inválido ou expirado',
          edition: { name: 'Completa' },
        },
      ],
    });

    const lista = await c.service.pending(TENANT);

    // Uma tela que deduzisse o motivo do enum duplicaria a regra, e as duas
    // divergiriam na primeira mudança.
    expect(lista.map((i) => i.reason)).toEqual([
      'awaiting_username',
      'invited_not_accepted',
      'failed',
    ]);
    expect(lista[2].sourceAccessError).toBe('token inválido ou expirado');
  });

  it('`PENDING` no prazo fica FORA — não é pendência, é o processo andando', async () => {
    const c = montar({ pendentes: [] });

    await c.service.pending(TENANT);

    const where = (c.prisma.license.findMany as jest.Mock).mock.calls[0][0].where;
    const pendingRamo = where.OR.find((r: { sourceAccess: string }) => r.sourceAccess === 'PENDING');
    // Quem comprou hoje está no prazo legal de arrependimento. Incluí-lo encheria
    // a lista de linhas sem o que fazer, e ela perderia o significado de "aqui há
    // trabalho".
    expect(pendingRamo.sourceInviteAt).toHaveProperty('lte');
    expect(pendingRamo.githubUsername).toBeNull();
  });
});

describe('gravar o username (só pelo admin)', () => {
  const pendente = {
    id: 'l1',
    sourceAccess: 'PENDING',
    githubUsername: null,
  };

  it('valida no GitHub e grava o login CANÔNICO', async () => {
    const c = montar({
      licenca: pendente,
      usuario: { login: 'RodReis', name: 'Rodrigo', avatarUrl: null },
    });

    const r = await c.service.setUsername(TENANT, 'l1', 'rodreis');

    // O GitHub normaliza caixa, e a reconciliação compara strings: gravar o
    // digitado faria o job nunca encontrar o colaborador.
    expect(r.username).toBe('RodReis');
    expect(c.updates[0].data.githubUsername).toBe('RodReis');
  });

  it('volta para `PENDING` — é o estado que o job busca', async () => {
    const c = montar({ licenca: pendente });

    await c.service.setUsername(TENANT, 'l1', 'rodreis');

    // Sem isto a licença ficaria fora da fila e o convite nunca sairia.
    expect(c.updates[0].data.sourceAccess).toBe('PENDING');
    expect(c.updates[0].data.sourceAccessError).toBeNull();
  });

  it('username inexistente é recusado NOMEANDO o que foi procurado', async () => {
    const c = montar({ licenca: pendente, usuario: null });

    await expect(c.service.setUsername(TENANT, 'l1', 'zzz-nao-existe')).rejects.toThrow(
      /"zzz-nao-existe" não existe/,
    );
    // Um typo convidaria um estranho para um repositório privado, e o erro só
    // apareceria quando ele aceitasse.
    expect(c.updates).toEqual([]);
  });

  it.each(['../../admin', 'a b', '-começa-com-hifen', 'x'.repeat(40), ''])(
    'sintaxe inválida (%s) nem chega à rede',
    async (entrada) => {
      const c = montar({ licenca: pendente });

      await expect(c.service.setUsername(TENANT, 'l1', entrada)).rejects.toThrow();
      // Sem validar antes, `../../admin` é interpolado em `GET /users/:username`.
      expect(c.github.findUser).not.toHaveBeenCalled();
    },
  );

  it('licença que não concede source é recusada', async () => {
    const c = montar({ licenca: { id: 'l1', sourceAccess: 'NONE', githubUsername: null } });

    // Sem esta guarda o admin gravaria o username e nada aconteceria nunca —
    // sintoma "salvei e o convite não sai".
    await expect(c.service.setUsername(TENANT, 'l1', 'rodreis')).rejects.toThrow(
      /não concede acesso ao código-fonte/,
    );
  });

  it('registra `source_username_set` com o anterior e `by: admin`', async () => {
    const c = montar({
      licenca: { id: 'l1', sourceAccess: 'PENDING', githubUsername: 'antigo' },
    });

    await c.service.setUsername(TENANT, 'l1', 'rodreis');

    const trilha = (c.updates[0].data as { events: { create: Record<string, unknown> } })
      .events.create;
    expect(trilha).toMatchObject({
      type: 'source_username_set',
      payload: { username: 'RodReis', previous: 'antigo', by: 'admin' },
    });
  });

  describe('substituir username com convite já emitido', () => {
    it.each(['INVITED', 'ACTIVE'])('%s: cancela o acesso anterior antes de gravar', async (estado) => {
      const c = montar({
        licenca: { id: 'l1', sourceAccess: estado, githubUsername: 'errado' },
        revokeOutcome: estado === 'INVITED' ? 'invitation_canceled' : 'collaborator_removed',
      });

      const r = await c.service.setUsername(TENANT, 'l1', 'rodreis');

      // Sem isto o convite antigo continuaria de pé: o username errado seguiria
      // podendo aceitar, e o certo nunca receberia convite — os dois erros ao
      // mesmo tempo, nenhum visível.
      expect(c.revokes.revoke).toHaveBeenCalledWith(
        TENANT,
        'l1',
        expect.stringContaining('troca de username'),
      );
      expect(r.previousInviteCanceled).toBe(true);
      expect(c.updates[0].data.githubUsername).toBe('RodReis');
      expect(c.updates[0].data.githubInvitationId).toBeNull();
    });

    it('falha ao remover o acesso antigo NÃO grava o username novo', async () => {
      const c = montar({
        licenca: { id: 'l1', sourceAccess: 'ACTIVE', githubUsername: 'errado' },
        revokeOutcome: 'failed',
      });

      await expect(c.service.setUsername(TENANT, 'l1', 'rodreis')).rejects.toThrow(
        /não pôde ser removido/,
      );

      // **O ponto todo.** O acesso antigo continua de pé, e sobrescrever o
      // username perderia a informação de QUEM ainda tem acesso — é o
      // `githubUsername` que a remoção usa. Gravar aqui deixaria um colaborador
      // no repositório privado sem nenhum registro de quem é.
      expect(c.updates).toEqual([]);
    });

    it('`PENDING` não chama revogação — não há acesso a desfazer', async () => {
      const c = montar({ licenca: pendente });

      await c.service.setUsername(TENANT, 'l1', 'rodreis');

      expect(c.revokes.revoke).not.toHaveBeenCalled();
    });
  });
});

describe('reemitir o convite', () => {
  it('roda a reconciliação do tenant — o mesmo caminho do job', async () => {
    const c = montar({
      licenca: { id: 'l1', sourceAccess: 'PENDING', githubUsername: 'RodReis' },
    });

    const r = await c.service.reinvite(TENANT, 'l1');

    // Duplicar a lógica de convite aqui criaria um 2º lugar que precisa acertar o
    // estado, e o modo de errar é o silencioso: dois convites, ou `INVITED` com
    // id nulo.
    expect(c.invites.reconcile).toHaveBeenCalledWith(TENANT);
    expect(r.convidados).toBe(1);
  });

  it('`FAILED` volta a `PENDING` ANTES da rodada', async () => {
    const c = montar({
      licenca: { id: 'l1', sourceAccess: 'FAILED', githubUsername: 'RodReis' },
    });

    await c.service.reinvite(TENANT, 'l1');

    // Sem esta linha o botão rodaria a reconciliação e a licença em `FAILED` seria
    // ignorada (o job busca `PENDING`) — sintoma "cliquei em reemitir e nada
    // aconteceu".
    expect(c.updates[0].data).toMatchObject({
      sourceAccess: 'PENDING',
      sourceAccessError: null,
    });
  });

  it('sem username recusa nomeando a causa', async () => {
    const c = montar({
      licenca: { id: 'l1', sourceAccess: 'PENDING', githubUsername: null },
    });

    // Recusar aqui é o que impede o admin de clicar três vezes esperando
    // resultado.
    await expect(c.service.reinvite(TENANT, 'l1')).rejects.toThrow(/Grave o username/);
    expect(c.invites.reconcile).not.toHaveBeenCalled();
  });

  it('licença inexistente é 404', async () => {
    const c = montar({ licenca: null });
    await expect(c.service.reinvite(TENANT, 'l1')).rejects.toThrow();
  });
});

describe('revogação manual', () => {
  it('delega ao service de revogação com motivo próprio', async () => {
    const c = montar({
      licenca: { id: 'l1' },
      revokeOutcome: 'collaborator_removed',
    });

    const r = await c.service.removeAccess(TENANT, 'l1');

    expect(c.revokes.revoke).toHaveBeenCalledWith(TENANT, 'l1', 'revogação manual pelo admin');
    expect(r.outcome).toBe('collaborator_removed');
  });

  it('NÃO toca o status da licença', async () => {
    const c = montar({ licenca: { id: 'l1' } });

    await c.service.removeAccess(TENANT, 'l1');

    // Remover do repo e revogar a licença são atos diferentes. Quem quer os dois
    // usa as duas rotas.
    expect(c.updates).toEqual([]);
  });
});

describe('PAT write-only', () => {
  it('o valor NUNCA sai — só `githubPatSet`', async () => {
    const c = montar({ pat: 'cifrado' });

    const view = await c.service.settings(TENANT);

    expect(view).toEqual({ githubPatSet: true, sourceRepo: REPO });
    expect(JSON.stringify(view)).not.toContain('cifrado');
  });

  it('grava CIFRADO, nunca em claro', async () => {
    const c = montar();

    await c.service.setPat(TENANT, 'ghp_secreto');

    // Um dump do banco não pode virar acesso de escrita ao repositório privado
    // (decisão PI #2).
    expect(c.crypto.encrypt).toHaveBeenCalledWith('ghp_secreto');
    expect(c.settingsUpdates[0].githubPat).toBe('cifra(ghp_secreto)');
    expect(c.settingsUpdates[0].githubPat).not.toBe('ghp_secreto');
  });

  it('vazio é recusado, não gravado', async () => {
    const c = montar();

    // Um PAT em branco pararia os convites, e o sintoma seria o mesmo de um token
    // expirado — indistinguível na pendência.
    await expect(c.service.setPat(TENANT, '   ')).rejects.toThrow(/não pode ser vazio/);
    expect(c.settingsUpdates).toEqual([]);
  });

  it('sem linha de settings, manda configurar o webhook primeiro', async () => {
    const c = montar({ settingsExiste: false });

    // Criar aqui deixaria `webhookSecret: ''`, e toda entrega da plataforma
    // passaria a falhar com 401 — efeito colateral que ninguém ligaria a "salvei o
    // PAT".
    await expect(c.service.setPat(TENANT, 'ghp_x')).rejects.toThrow(/segredo do webhook/);
  });

  it('o log não ecoa o PAT', async () => {
    const c = montar();
    const logger = (c.service as unknown as { logger: { log: (m: string) => void } }).logger;
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);

    await c.service.setPat(TENANT, 'ghp_secreto');

    const registrado = log.mock.calls.map((ch) => String(ch[0])).join('\n');
    expect(registrado).not.toContain('ghp_secreto');
  });
});

describe('teste de conexão', () => {
  it('ok quando o PAT tem permissão de admin no repo', async () => {
    const c = montar({ acesso: { ok: true } });

    expect(await c.service.testConnection(TENANT)).toEqual({ ok: true, repo: REPO });
    // Descriptografado: mandar o valor cifrado daria `401` em toda chamada, e a
    // tela diria "token inválido" sobre um token válido.
    expect(c.github.checkRepoAccess).toHaveBeenCalledWith('claro(cifrado)', REPO);
  });

  it('propaga o motivo do `checkRepoAccess` (inclui PAT só-leitura)', async () => {
    const c = montar({
      acesso: { ok: false, reason: 'o token não tem permissão de administração no repositório' },
    });

    // **O teste pergunta pela PERMISSÃO, não só pela existência do repo.** Um PAT
    // só-leitura enxerga o repositório e não convida ninguém: sem isto o teste
    // passaria e o convite falharia — o pior desfecho, porque o operador teria uma
    // confirmação verde.
    expect(await c.service.testConnection(TENANT)).toEqual({
      ok: false,
      reason: 'o token não tem permissão de administração no repositório',
    });
  });

  it.each([
    ['PAT ausente', { pat: null }, /PAT não configurado/],
    ['repo ausente', { repo: null }, /sourceRepo/],
    ['cifra ilegível', { cifraQuebrada: true }, /ilegível/],
  ])('%s devolve `ok: false` com motivo, sem lançar', async (_caso, opcoes, esperado) => {
    const c = montar(opcoes);

    const r = await c.service.testConnection(TENANT);

    // Um `500` diria "o ProPlan quebrou" sobre um teste cuja resposta É "sua
    // configuração está errada".
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(esperado);
  });

  it('rede fora NÃO é "token inválido"', async () => {
    const c = montar({ acessoErro: new Error('fetch failed') });

    const r = await c.service.testConnection(TENANT);

    // Dizer "token inválido" mandaria o operador trocar um token correto.
    expect(r).toEqual({ ok: false, reason: 'não foi possível falar com o GitHub agora' });
  });

  it('a mensagem devolvida não carrega o PAT', async () => {
    const c = montar({
      acessoErro: new Error('request failed: Bearer claro(cifrado)'),
    });
    const logger = (c.service as unknown as { logger: { warn: (m: string) => void } }).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const r = await c.service.testConnection(TENANT);

    // Esta resposta é EXIBIDA na tela: a mensagem de um `fetch` pode arrastar o
    // header `Authorization` inteiro. Por isso o texto é fixo, e o log redige.
    expect(JSON.stringify(r)).not.toContain('claro(cifrado)');
    const registrado = warn.mock.calls.map((ch) => String(ch[0])).join('\n');
    expect(registrado).toContain('[redigido]');
    expect(registrado).not.toContain('claro(cifrado)');
  });
});
