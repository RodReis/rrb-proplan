import type { PrismaService } from '../../../prisma/prisma.service';
import type { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceError,
  type GithubSourceClient,
} from '../infrastructure/github-source.client';
import { SourceRevokeService } from './source-revoke.service';

const TENANT = 'tn-1';
const REPO = 'RodReis/war-room';
const PAT = 'pat-em-claro:cifrado';

interface LinhaLicenca {
  id: string;
  sourceAccess: string;
  githubUsername: string | null;
  githubInvitationId: string | null;
}

/**
 * A revogação do acesso ao repo (SPEC-039 §Revogação).
 *
 * **O que este arquivo protege é uma única distinção, e ela é a razão de o
 * `sourceInvited: Boolean` ter morrido no PR-1:** convite pendente se cancela por
 * `DELETE /invitations/:id`; colaborador aceito se remove por
 * `DELETE /collaborators/:username`. **Chamar a errada é no-op silencioso** — a
 * API responde sem erro, nada aparece em log, e o reembolsado continua com acesso
 * ao código-fonte.
 *
 * Por isso os dois caminhos são testados **separadamente**, como o critério de
 * aceite exige: um teste que aceitasse qualquer uma das duas chamadas passaria
 * com a implementação errada.
 */
function montar(
  opcoes: {
    licenca?: LinhaLicenca | null;
    pat?: string | null;
    repo?: string | null;
    cancelar?: Error;
    remover?: Error;
    cifraQuebrada?: boolean;
    updateQuebrado?: boolean;
  } = {},
) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

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
      findFirst: jest.fn(async () => (opcoes.licenca === undefined ? null : opcoes.licenca)),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        if (opcoes.updateQuebrado) throw new Error('banco fora');
        updates.push({ id: args.where.id, data: args.data });
        return {};
      }),
    },
  } as unknown as PrismaService;

  const github = {
    cancelInvitation: jest.fn(async () => {
      if (opcoes.cancelar) throw opcoes.cancelar;
    }),
    removeCollaborator: jest.fn(async () => {
      if (opcoes.remover) throw opcoes.remover;
    }),
  } as unknown as GithubSourceClient;

  const crypto = {
    decrypt: jest.fn((v: string) => {
      if (opcoes.cifraQuebrada) throw new Error('bad tag');
      return `pat-em-claro:${v}`;
    }),
  } as unknown as CryptoService;

  return {
    service: new SourceRevokeService(prisma, github, crypto),
    prisma,
    github,
    crypto,
    updates,
  };
}

describe('convite pendente: cancela a INVITATION', () => {
  const convidada: LinhaLicenca = {
    id: 'lic-1',
    sourceAccess: 'INVITED',
    githubUsername: 'RodReis',
    githubInvitationId: '42',
  };

  it('cancela pelo id e NÃO chama remover colaborador', async () => {
    const c = montar({ licenca: convidada });

    const r = await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    // **A metade que o booleano não expressava.** O convite existe e não foi
    // aceito: há invitation para cancelar, e não há assento de colaborador.
    expect(c.github.cancelInvitation).toHaveBeenCalledWith(PAT, REPO, '42');
    // Chamar `removeCollaborator` aqui seria no-op silencioso (`204` para quem não
    // é colaborador) e o convite continuaria de pé, esperando ser aceito.
    expect(c.github.removeCollaborator).not.toHaveBeenCalled();
    expect(r).toBe('invitation_canceled');
  });

  it('grava `REMOVED` e limpa o id da invitation', async () => {
    const c = montar({ licenca: convidada });

    await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    const gravado = c.updates[0].data as Record<string, unknown>;
    expect(gravado.sourceAccess).toBe('REMOVED');
    // O id aponta para uma invitation que já não existe. Mantê-lo faria uma
    // retentativa futura cancelar convite inexistente em vez de remover o
    // colaborador de uma recompra.
    expect(gravado.githubInvitationId).toBeNull();
    expect(gravado.sourceAccessError).toBeNull();
  });

  it('o username NÃO é apagado', async () => {
    const c = montar({ licenca: convidada });

    await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    // É a trilha de quem teve acesso. Quem o apaga é a exclusão a pedido (LGPD,
    // §7 do MVP4), não a revogação.
    expect(Object.keys(c.updates[0].data)).not.toContain('githubUsername');
  });

  it('registra `source_access_removed` nomeando a chamada feita', async () => {
    const c = montar({ licenca: convidada });

    await c.service.revoke(TENANT, 'lic-1', 'chargeback');

    const trilha = (c.updates[0].data as { events: { create: Record<string, unknown> } })
      .events.create;
    expect(trilha).toMatchObject({
      type: 'source_access_removed',
      // `via` é o que permite auditar, meses depois, se o acesso morreu pelo
      // caminho certo.
      payload: { username: 'RodReis', motivo: 'chargeback', via: 'invitation_canceled' },
    });
  });

  it('`INVITED` sem id cai para remover colaborador', async () => {
    const c = montar({
      licenca: { ...convidada, githubInvitationId: null },
    });

    const r = await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    // O `201` do GitHub pode vir sem `id`. Sem ele não há o que cancelar — e
    // `removeCollaborator` é seguro no estado errado (`204` para quem não é
    // colaborador). O inverso não vale, e é por isso que o fallback é este.
    expect(c.github.removeCollaborator).toHaveBeenCalledWith(PAT, REPO, 'RodReis');
    expect(c.github.cancelInvitation).not.toHaveBeenCalled();
    expect(r).toBe('collaborator_removed');
  });
});

describe('colaborador aceito: remove o COLABORADOR', () => {
  const ativa: LinhaLicenca = {
    id: 'lic-2',
    sourceAccess: 'ACTIVE',
    githubUsername: 'RodReis',
    githubInvitationId: null,
  };

  it('remove pelo username e NÃO chama cancelar convite', async () => {
    const c = montar({ licenca: ativa });

    const r = await c.service.revoke(TENANT, 'lic-2', 'reembolso');

    // **A outra metade.** O convite foi aceito: não existe mais invitation para
    // cancelar, existe assento de colaborador para remover.
    expect(c.github.removeCollaborator).toHaveBeenCalledWith(PAT, REPO, 'RodReis');
    expect(c.github.cancelInvitation).not.toHaveBeenCalled();
    expect(r).toBe('collaborator_removed');
  });

  it('grava `REMOVED` com `via: collaborator_removed`', async () => {
    const c = montar({ licenca: ativa });

    await c.service.revoke(TENANT, 'lic-2', 'reembolso');

    expect(c.updates[0].data).toMatchObject({ sourceAccess: 'REMOVED' });
    const trilha = (c.updates[0].data as { events: { create: { payload: { via: string } } } })
      .events.create;
    expect(trilha.payload.via).toBe('collaborator_removed');
  });

  it('convite aceito com id remanescente ainda remove o colaborador', async () => {
    // `ACTIVE` com `githubInvitationId` preenchido: o job promoveu por
    // reconciliação e o id ficou. O estado é que manda, não a presença do id —
    // cancelar a invitation de quem já aceitou é no-op, e o colaborador ficaria.
    const c = montar({ licenca: { ...ativa, githubInvitationId: '42' } });

    const r = await c.service.revoke(TENANT, 'lic-2', 'reembolso');

    expect(c.github.removeCollaborator).toHaveBeenCalled();
    expect(c.github.cancelInvitation).not.toHaveBeenCalled();
    expect(r).toBe('collaborator_removed');
  });
});

describe('nada a desfazer', () => {
  it.each(['NONE', 'PENDING', 'REMOVED'])('%s não fala com o GitHub', async (estado) => {
    const c = montar({
      licenca: {
        id: 'lic-3',
        sourceAccess: estado,
        githubUsername: 'RodReis',
        githubInvitationId: null,
      },
    });

    const r = await c.service.revoke(TENANT, 'lic-3', 'reembolso');

    // `PENDING` é o reembolso ANTES do 8º dia: o convite nunca saiu, e quem limpa
    // o agendamento é o webhook-processor. `REMOVED` é a 2ª passada —
    // idempotência. Nenhum dos três tem acesso no GitHub para desfazer.
    expect(c.github.cancelInvitation).not.toHaveBeenCalled();
    expect(c.github.removeCollaborator).not.toHaveBeenCalled();
    expect(c.updates).toEqual([]);
    expect(r).toBe('nothing_to_do');
  });

  it('idempotente: revogar duas vezes não erra na segunda', async () => {
    const c = montar({
      licenca: {
        id: 'lic-1',
        sourceAccess: 'INVITED',
        githubUsername: 'RodReis',
        githubInvitationId: '42',
      },
    });

    expect(await c.service.revoke(TENANT, 'lic-1', 'reembolso')).toBe('invitation_canceled');

    // 2ª passada com a licença já em `REMOVED` (é o que o banco teria).
    (c.prisma.license.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'lic-1',
      sourceAccess: 'REMOVED',
      githubUsername: 'RodReis',
      githubInvitationId: null,
    });

    expect(await c.service.revoke(TENANT, 'lic-1', 'reembolso')).toBe('nothing_to_do');
    expect(c.github.cancelInvitation).toHaveBeenCalledTimes(1);
  });

  it('licença inexistente não lança', async () => {
    const c = montar({ licenca: null });

    // Quem chama é o processamento do webhook. Lançar derrubaria o reembolso
    // inteiro — e o `status = REVOKED` já foi gravado.
    expect(await c.service.revoke(TENANT, 'lic-x', 'reembolso')).toBe('nothing_to_do');
    expect(c.updates).toEqual([]);
  });

  it('`FAILED` NÃO é tratado como nada a fazer', async () => {
    const c = montar({
      licenca: {
        id: 'lic-4',
        sourceAccess: 'FAILED',
        githubUsername: 'RodReis',
        githubInvitationId: null,
      },
    });

    const r = await c.service.revoke(TENANT, 'lic-4', 'retentativa do admin');

    // `FAILED` é exatamente o estado que precisa de nova tentativa. Incluí-lo na
    // lista de "nada a fazer" faria a retentativa do admin (PR-5) responder
    // sucesso sem remover ninguém — o reembolsado ficaria com o acesso e a
    // pendência desapareceria da lista.
    expect(c.github.removeCollaborator).toHaveBeenCalledWith(PAT, REPO, 'RodReis');
    expect(r).toBe('collaborator_removed');
  });
});

describe('falha do GitHub é visível e retentável', () => {
  const convidada: LinhaLicenca = {
    id: 'lic-1',
    sourceAccess: 'INVITED',
    githubUsername: 'RodReis',
    githubInvitationId: '42',
  };

  it.each([
    [401, 'token inválido ou expirado'],
    [403, 'token sem permissão de administração no repositório'],
  ])('%s vira `FAILED` com motivo legível', async (status, motivo) => {
    const c = montar({
      licenca: convidada,
      cancelar: new GithubSourceError(motivo, status),
    });

    const r = await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    // "Reembolsado que continua colaborador" é a falha que custa dinheiro — ela
    // não pode viver só no log, onde ninguém olha sem motivo.
    expect(c.updates[0].data).toMatchObject({
      sourceAccess: 'FAILED',
      sourceAccessError: motivo,
    });
    expect(r).toBe('failed');
  });

  it('`FAILED` preserva username e id — sem eles a retentativa é um beco', async () => {
    const c = montar({
      licenca: convidada,
      cancelar: new GithubSourceError('rede', 500),
    });

    await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    // São o que a retentativa usa para escolher a chamada. Limpá-los faria o
    // `FAILED` virar pendência visível e insolúvel.
    const gravado = Object.keys(c.updates[0].data);
    expect(gravado).not.toContain('githubUsername');
    expect(gravado).not.toContain('githubInvitationId');
  });

  it('a licença fica intacta além do estado do acesso', async () => {
    const c = montar({
      licenca: convidada,
      cancelar: new GithubSourceError('rede', 500),
    });

    await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    // Critério de aceite: falha do GitHub não mexe na licença. O corte do que o
    // comprador pagou é do `status`, escrito pelo webhook-processor.
    const gravado = Object.keys(c.updates[0].data);
    expect(gravado).not.toContain('status');
    expect(gravado).not.toContain('revokedAt');
    expect(gravado).not.toContain('expiresAt');
  });

  it('falha ao remover colaborador também vira `FAILED`', async () => {
    const c = montar({
      licenca: {
        id: 'lic-2',
        sourceAccess: 'ACTIVE',
        githubUsername: 'RodReis',
        githubInvitationId: null,
      },
      remover: new GithubSourceError('token inválido ou expirado', 401),
    });

    expect(await c.service.revoke(TENANT, 'lic-2', 'reembolso')).toBe('failed');
    expect(c.updates[0].data).toMatchObject({ sourceAccess: 'FAILED' });
  });

  it('o motivo gravado não carrega o PAT', async () => {
    const c = montar({
      licenca: convidada,
      cancelar: new Error('request failed: Bearer pat-em-claro:cifrado'),
    });

    await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    // `sourceAccessError` é EXIBIDO na tela do admin, e a mensagem de um erro
    // qualquer de `fetch` pode arrastar o header `Authorization` inteiro —
    // entregando `administration:write` no repositório privado a quem abrir a
    // página de pendências.
    const erro = (c.updates[0].data as { sourceAccessError: string }).sourceAccessError;
    expect(erro).not.toContain('pat-em-claro');
    expect(erro).toMatch(/ver o log do servidor/);
  });

  it('nem o log carrega o PAT', async () => {
    const c = montar({
      licenca: convidada,
      cancelar: new Error('request failed: Bearer pat-em-claro:cifrado'),
    });
    const logger = (c.service as unknown as { logger: { error: (m: string) => void } }).logger;
    const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    await c.service.revoke(TENANT, 'lic-1', 'reembolso');

    const registrado = error.mock.calls.map((ch) => String(ch[0])).join('\n');
    expect(registrado).toContain('[redigido]');
    expect(registrado).not.toContain('pat-em-claro');
  });
});

describe('configuração ausente NÃO passa como sucesso', () => {
  const ativa: LinhaLicenca = {
    id: 'lic-2',
    sourceAccess: 'ACTIVE',
    githubUsername: 'RodReis',
    githubInvitationId: null,
  };

  it.each([
    ['sem PAT', { pat: null }],
    ['sem repo', { repo: null }],
    ['PAT ilegível', { cifraQuebrada: true }],
  ])('%s vira `FAILED`, não silêncio', async (_caso, opcoes) => {
    const c = montar({ licenca: ativa, ...opcoes });

    const r = await c.service.revoke(TENANT, 'lic-2', 'reembolso');

    // **Diferente do job de convite**, onde a ausência de PAT é só pendência de
    // configuração e nada acontece. Aqui o silêncio custa dinheiro: o reembolsado
    // continua com acesso ao código-fonte, e ninguém saberia.
    expect(r).toBe('failed');
    const erro = (c.updates[0].data as { sourceAccessError: string }).sourceAccessError;
    expect(erro).toMatch(/NÃO foi removido/);
    expect(c.github.removeCollaborator).not.toHaveBeenCalled();
  });

  it('estado incoerente (sem username) vira pendência, não exceção', async () => {
    const c = montar({
      licenca: { ...ativa, githubUsername: null },
    });

    const r = await c.service.revoke(TENANT, 'lic-2', 'reembolso');

    // Não deveria existir: o job só promove licença com username. Vira pendência
    // visível para o admin corrigir e retentar.
    expect(r).toBe('failed');
    expect(c.github.removeCollaborator).not.toHaveBeenCalled();
    expect(c.github.cancelInvitation).not.toHaveBeenCalled();
  });

  it('o PAT é descriptografado, nunca usado cifrado', async () => {
    const c = montar({ licenca: ativa });

    await c.service.revoke(TENANT, 'lic-2', 'reembolso');

    // Mandar o valor cifrado no header daria `401` em toda chamada, e a lista de
    // pendências diria "token inválido" sobre um token perfeitamente válido.
    expect(c.crypto.decrypt).toHaveBeenCalledWith('cifrado');
    expect(c.github.removeCollaborator).toHaveBeenCalledWith(PAT, REPO, 'RodReis');
  });
});
