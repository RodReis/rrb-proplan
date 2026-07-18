import { computeScopeHash } from '../domain/scope-hash';
import { SYNC_COMPLETED, SyncService } from './sync.service';

/**
 * A ordem entre "sincronizar as issues" e "marcar o run como concluído".
 *
 * `status: success|noop` é o sinal que o cliente espera para recarregar a tela
 * — o `handleSync` do web polla o `SyncRun` e, ao vê-lo terminado, recarrega o
 * Kanban. Se o `SYNC_COMPLETED` (quem dispara o `syncIssues`) for emitido
 * **depois** do status, o front lê o board **antes** de as issues atualizarem:
 * o card só aparece na coluna certa depois de um F5.
 *
 * Bug reportado ao vivo pelo PI em 2026-07-16, exatamente assim.
 *
 * O teste grava a sequência real e falha se alguém inverter a ordem de novo —
 * trava o invariante, não a implementação.
 */
const EMPTY_SCOPE_HASH = computeScopeHash([]);

function makeSvc(over: { docsChanged: boolean }) {
  const order: string[] = [];

  const project = {
    id: 'p1',
    userId: 'u1',
    tenantId: 't1',
    owner: 'o',
    name: 'r',
    defaultBranch: 'main',
    // Igual ao hash do escopo vazio → noop. Diferente → success.
    docsScopeHash: over.docsChanged ? 'hash-de-outra-arvore' : EMPTY_SCOPE_HASH,
    installationId: 1,
  };

  const prisma = {
    project: { update: jest.fn().mockResolvedValue({}) },
    syncRun: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'run1',
        projectId: 'p1',
        project,
        expectPath: null,
        expectBlobSha: null,
      }),
      update: jest.fn((arg: { data: { status?: string } }) => {
        // `running` é ruído; só as marcas finais interessam à ordem.
        if (arg.data.status && arg.data.status !== 'running') {
          order.push(`finish:${arg.data.status}`);
        }
        return Promise.resolve({});
      }),
    },
    document: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
  } as any;

  const events = {
    emitAsync: jest.fn((name: string) => {
      order.push(`emit:${name}`);
      return Promise.resolve([]);
    }),
    emit: jest.fn((name: string) => {
      order.push(`emit:${name}`);
      return true;
    }),
  } as any;

  const svc = new SyncService(
    prisma,
    // O sync LÊ com token de usuário (ADR-015: leitura respeita a visibilidade
    // de quem pediu; installation token é só para escrita).
    { userToken: jest.fn().mockResolvedValue('tok') } as any,
    {} as any,
    events,
    { rebuildLinks: jest.fn().mockResolvedValue(undefined) } as any,
    { rebuild: jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,
  );

  // Privados que falam com o GitHub — duplos. O alvo é a ordem, não a coleta.
  jest.spyOn(svc as any, 'listScope').mockResolvedValue([]);
  jest.spyOn(svc as any, 'updateCommitMeta').mockResolvedValue(undefined);
  jest.spyOn(svc as any, 'updateDeploySignals').mockResolvedValue(undefined);
  jest.spyOn(svc as any, 'updateCiStatus').mockResolvedValue(undefined);

  return { svc, order, events };
}

describe('ordem: issues sincronizam antes de o run ser marcado concluído', () => {
  /**
   * O caminho do bug reportado: `noop` diz "os docs não mudaram" — e as issues
   * podem ter mudado (mover um card direto no GitHub não toca `docs/`).
   */
  it('no caminho noop, emite SYNC_COMPLETED antes de marcar o run', async () => {
    const { svc, order } = makeSvc({ docsChanged: false });

    await svc.runSync('run1');

    expect(order).toContain('finish:noop');
    expect(order.indexOf(`emit:${SYNC_COMPLETED}`)).toBeLessThan(
      order.indexOf('finish:noop'),
    );
  });

  it('no caminho success, emite SYNC_COMPLETED antes de marcar o run', async () => {
    const { svc, order } = makeSvc({ docsChanged: true });

    await svc.runSync('run1');

    expect(order).toContain('finish:success');
    expect(order.indexOf(`emit:${SYNC_COMPLETED}`)).toBeLessThan(
      order.indexOf('finish:success'),
    );
  });

  it('espera o handler (emitAsync), não dispara e esquece (emit)', async () => {
    const { svc, events } = makeSvc({ docsChanged: false });

    await svc.runSync('run1');

    expect(events.emitAsync).toHaveBeenCalledWith(SYNC_COMPLETED, expect.anything());
    // `emit` puro devolve na hora: o handler async ficaria pendente e a corrida
    // voltaria pela porta dos fundos.
    expect(events.emit).not.toHaveBeenCalledWith(SYNC_COMPLETED, expect.anything());
  });
});
