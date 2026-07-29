import { PENDING_KINDS } from '../domain/pending';
import { DashboardService } from './dashboard.service';

const TENANT = 't1';
const AGORA = new Date('2026-08-15T15:00:00.000Z');

/** Os 6 colaboradores, todos devolvendo "nada" por padrão. */
function deps(over: Record<string, any> = {}) {
  const clients: any = {
    hasAnyClient: jest.fn().mockResolvedValue(true),
    funnel: jest.fn().mockResolvedValue([]),
    stalledProjects: jest.fn().mockResolvedValue([]),
    recentTransitions: jest.fn().mockResolvedValue([]),
  };
  const artifacts: any = { pendingReview: jest.fn().mockResolvedValue([]) };
  const estimates: any = { pending: jest.fn().mockResolvedValue([]) };
  const contracts: any = {
    unaccepted: jest.fn().mockResolvedValue([]),
    counts: jest.fn().mockResolvedValue({ issued: 0, accepted: 0, hasAny: false }),
  };
  const activity: any = {
    recentAudit: jest.fn().mockResolvedValue([]),
    recentSyncs: jest.fn().mockResolvedValue([]),
  };
  const settings: any = { stalledDays: jest.fn().mockResolvedValue(7) };

  Object.assign(clients, over.clients);
  Object.assign(artifacts, over.artifacts);
  Object.assign(estimates, over.estimates);
  Object.assign(contracts, over.contracts);
  Object.assign(activity, over.activity);
  Object.assign(settings, over.settings);

  return {
    svc: new DashboardService(clients, artifacts, estimates, contracts, activity, settings),
    clients,
    artifacts,
    estimates,
    contracts,
    activity,
    settings,
  };
}

describe('DashboardService (SPEC-035)', () => {
  describe('composição e fronteira (§2.1, §5)', () => {
    it('não recebe PrismaService — não há como consultar tabela de outro módulo', () => {
      // Não é estilo: é o mecanismo. Sem o cliente injetado, a fronteira do
      // ADR-001 não depende de ninguém lembrar dela. O arch test prova por
      // varredura; este teste prova pelo construtor.
      const { svc } = deps();
      for (const dep of Object.values(svc as unknown as Record<string, unknown>)) {
        expect(dep).not.toHaveProperty('$transaction');
      }
    });

    it('a view não tem nenhum total cruzando as duas frentes (ADR-023, §2.4)', async () => {
      // Auditável por ausência, como o §5 pede: o board de repos nem viaja
      // nesta resposta — vai em rota própria.
      const { svc } = deps();

      const out = await svc.view(TENANT, '30', AGORA);

      expect(Object.keys(out).sort()).toEqual([
        'activity',
        'contracts',
        'funnel',
        'hasAnyClient',
        'pending',
        'period',
      ]);
      expect(out).not.toHaveProperty('total');
      expect(out).not.toHaveProperty('repos');
    });
  });

  describe('o contador é EXATAMENTE o tamanho da lista (§2.3, §5)', () => {
    it('conta pelo mesmo caminho de dado que monta a lista', async () => {
      // O critério de aceite exige comparar os dois pelo mesmo caminho. Se o
      // contador somasse por conta própria, divergiria na primeira regra que
      // mudasse só de um lado — e o contador vira enfeite.
      const { svc } = deps({
        artifacts: {
          pendingReview: jest
            .fn()
            .mockResolvedValue([
              { artifactId: 'a1', clientProjectId: 'cp1', title: 'X', kind: 'SCOPE', since: 'i' },
            ]),
        },
        estimates: {
          pending: jest
            .fn()
            .mockResolvedValue([
              { clientProjectId: 'cp2', title: 'Y', reason: 'missing', since: 'i' },
            ]),
        },
        contracts: {
          unaccepted: jest
            .fn()
            .mockResolvedValue([
              { contractId: 'ct1', clientProjectId: 'cp3', title: 'Z', version: 1, since: 'i' },
            ]),
          counts: jest.fn().mockResolvedValue({ issued: 1, accepted: 0, hasAny: true }),
        },
        clients: {
          stalledProjects: jest.fn().mockResolvedValue([
            {
              clientProjectId: 'cp4',
              title: 'W',
              state: 'DRAFT',
              clientName: 'Ana',
              since: 'i',
            },
          ]),
        },
      });

      const lista = await svc.pending(TENANT, AGORA);
      const { count } = await svc.pendingCount(TENANT, AGORA);

      expect(lista).toHaveLength(4);
      expect(count).toBe(lista.length);
    });

    it('lista vazia → contador zero', async () => {
      const { svc } = deps();
      expect((await svc.pendingCount(TENANT, AGORA)).count).toBe(0);
    });

    it('só os 4 tipos da lista fechada aparecem', async () => {
      const { svc } = deps({
        artifacts: {
          pendingReview: jest
            .fn()
            .mockResolvedValue([
              { artifactId: 'a1', clientProjectId: 'cp1', title: 'X', kind: 'SCOPE', since: 'i' },
            ]),
        },
      });

      const lista = await svc.pending(TENANT, AGORA);

      for (const item of lista) expect(PENDING_KINDS).toContain(item.kind);
    });
  });

  describe('"Esperando você" é estado corrente, não janela (§2.8)', () => {
    it('o período NÃO chega nas fontes de pendência', async () => {
      // Algo que espera há 200 dias espera hoje. Escondê-lo por estar fora dos
      // últimos 30 seria a pior forma de mentir nesta tela.
      const { svc, artifacts, contracts, estimates } = deps();

      await svc.view(TENANT, '7', AGORA);

      expect(artifacts.pendingReview).toHaveBeenCalledWith(TENANT);
      expect(estimates.pending).toHaveBeenCalledWith(TENANT);
      expect(contracts.unaccepted).toHaveBeenCalledWith(TENANT);
    });

    it('mas o período CHEGA nas contagens', async () => {
      const { svc, clients, contracts } = deps();

      await svc.view(TENANT, 'current_month', AGORA);

      // 01/08 00:00 BRT = 01/08 03:00 UTC (§2.9).
      const inicioDoMes = new Date('2026-08-01T03:00:00.000Z');
      expect(clients.funnel).toHaveBeenCalledWith(TENANT, inicioDoMes);
      expect(contracts.counts).toHaveBeenCalledWith(TENANT, inicioDoMes);
    });
  });

  describe('"parado" usa o limite configurado, não 7 literal (§5)', () => {
    it('repassa o valor de TenantSettings e o cita no texto do item', async () => {
      const { svc, clients } = deps({
        settings: { stalledDays: jest.fn().mockResolvedValue(21) },
        clients: {
          stalledProjects: jest.fn().mockResolvedValue([
            {
              clientProjectId: 'cp1',
              title: 'W',
              state: 'DRAFT',
              clientName: 'Ana',
              since: 'i',
            },
          ]),
        },
      });

      const lista = await svc.pending(TENANT, AGORA);

      expect(clients.stalledProjects).toHaveBeenCalledWith(TENANT, 21, AGORA);
      expect(lista[0].detail).toContain('21 dias');
    });
  });

  describe('zero é resultado; ausência é outra coisa (§2.7, §5)', () => {
    it('`hasAnyClient` viaja na resposta para a tela distinguir os dois', async () => {
      const { svc } = deps({ clients: { hasAnyClient: jest.fn().mockResolvedValue(false) } });

      expect((await svc.view(TENANT, '30', AGORA)).hasAnyClient).toBe(false);
    });

    it('contrato: issued 0 com hasAny true é diferente de hasAny false', async () => {
      const { svc } = deps({
        contracts: {
          counts: jest.fn().mockResolvedValue({ issued: 0, accepted: 0, hasAny: true }),
        },
      });

      const out = await svc.view(TENANT, '30', AGORA);

      expect(out.contracts).toEqual({ issued: 0, accepted: 0, hasAny: true });
    });
  });

  describe('"O que andou por aqui" (§2.2)', () => {
    it('junta as três trilhas e ordena por data, mais recente primeiro', async () => {
      const { svc } = deps({
        clients: {
          recentTransitions: jest.fn().mockResolvedValue([
            {
              kind: 'funnel',
              at: '2026-08-10T12:00:00.000Z',
              clientProjectId: 'cp1',
              title: 'Loja',
              detail: 'DRAFT → LINK_SENT',
            },
          ]),
        },
        activity: {
          recentAudit: jest
            .fn()
            .mockResolvedValue([
              { kind: 'audit', at: '2026-08-12T12:00:00.000Z', detail: 'a', projectId: null },
            ]),
          recentSyncs: jest
            .fn()
            .mockResolvedValue([
              { kind: 'sync', at: '2026-08-11T12:00:00.000Z', detail: 's', projectId: 'p1' },
            ]),
        },
      });

      const out = await svc.view(TENANT, '30', AGORA);

      expect(out.activity.map((e) => e.kind)).toEqual(['audit', 'sync', 'funnel']);
    });

    it('sem trilha nenhuma devolve lista vazia — a tela mostra texto, não branco', async () => {
      const { svc } = deps();
      expect((await svc.view(TENANT, '30', AGORA)).activity).toEqual([]);
    });
  });
});
