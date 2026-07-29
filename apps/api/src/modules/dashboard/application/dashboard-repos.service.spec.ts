import { RateLimitError } from '../../board/domain/rate-limit';
import { MAX_REPOS_POR_CARGA } from '../domain/repos';
import { DashboardReposService } from './dashboard-repos.service';

const TENANT = 't1';

function alvo(n: number) {
  return { projectId: `p${n}`, owner: 'RodReis', name: `repo${n}`, userId: 'u1' };
}

const COLUNAS_ZERADAS = [
  { column: 'backlog', count: 0 },
  { column: 'todo', count: 0 },
  { column: 'doing', count: 0 },
  { column: 'done', count: 0 },
  { column: 'finalized', count: 0 },
  { column: 'discarded', count: 0 },
];

function boardFake(over: Record<string, any> = {}): any {
  return {
    reposDoTenant: jest.fn().mockResolvedValue([alvo(1)]),
    contagemAoVivo: jest.fn().mockResolvedValue(COLUNAS_ZERADAS),
    ...over,
  };
}

describe('DashboardReposService — as 4 salvaguardas (SPEC-035 §2.11)', () => {
  describe('1. falha isolada: um repo ruim não derruba a tela', () => {
    it('o repo que falha vem NOMEADO e os outros vêm normais', async () => {
      // O §2.11 é literal: o bloco mostra "não foi possível carregar" nomeando o
      // repo, e o resto do dashboard renderiza.
      const board = boardFake({
        reposDoTenant: jest.fn().mockResolvedValue([alvo(1), alvo(2), alvo(3)]),
        contagemAoVivo: jest.fn().mockImplementation((a: any) =>
          a.name === 'repo2'
            ? Promise.reject(new Error('GitHub 500'))
            : Promise.resolve(COLUNAS_ZERADAS),
        ),
      });

      const out = await new DashboardReposService(board).block(TENANT);

      expect(out.repos.map((r) => [r.repo, r.status])).toEqual([
        ['RodReis/repo1', 'ok'],
        ['RodReis/repo2', 'failed'],
        ['RodReis/repo3', 'ok'],
      ]);
    });

    it('TODOS falharem ainda devolve o bloco — a rota não estoura', async () => {
      // Se o `Promise.all` visse uma rejeição, o bloco inteiro viraria 500 e a
      // tela perderia o dashboard por causa de um terceiro fora do ar.
      const board = boardFake({
        reposDoTenant: jest.fn().mockResolvedValue([alvo(1), alvo(2)]),
        contagemAoVivo: jest.fn().mockRejectedValue(new Error('GitHub fora')),
      });

      const out = await new DashboardReposService(board).block(TENANT);

      expect(out.repos.every((r) => r.status === 'failed')).toBe(true);
      expect(out.repos).toHaveLength(2);
    });
  });

  describe('2. timeout curto por repo, em paralelo', () => {
    it('repo lento vira `timeout` sem esperar o timeout do client', async () => {
      jest.useFakeTimers();
      try {
        const board = boardFake({
          // Nunca resolve: só o relógio decide.
          contagemAoVivo: jest.fn().mockReturnValue(new Promise(() => {})),
        });

        const promessa = new DashboardReposService(board).block(TENANT);
        await jest.advanceTimersByTimeAsync(5_000);
        const out = await promessa;

        expect(out.repos[0]).toMatchObject({
          status: 'failed',
          reason: 'timeout',
          repo: 'RodReis/repo1',
          retryAt: null,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('os repos são lidos EM PARALELO, não em fila', async () => {
      // Em série, N repos custariam a soma; em paralelo, o tempo do mais lento.
      // A prova é de comportamento: todas as chamadas partem antes de a primeira
      // resolver.
      let emVoo = 0;
      let maxSimultaneo = 0;
      const board = boardFake({
        reposDoTenant: jest.fn().mockResolvedValue([alvo(1), alvo(2), alvo(3)]),
        contagemAoVivo: jest.fn().mockImplementation(async () => {
          emVoo++;
          maxSimultaneo = Math.max(maxSimultaneo, emVoo);
          await Promise.resolve();
          emVoo--;
          return COLUNAS_ZERADAS;
        }),
      });

      await new DashboardReposService(board).block(TENANT);

      expect(maxSimultaneo).toBe(3);
    });
  });

  describe('3. teto de repos por carga', () => {
    it('acima do teto, o excedente NÃO é consultado', async () => {
      // Sem isto, um tenant com 40 repos faz 40 chamadas ao GitHub por F5.
      const muitos = Array.from({ length: 25 }, (_, i) => alvo(i + 1));
      const board = boardFake({ reposDoTenant: jest.fn().mockResolvedValue(muitos) });

      const out = await new DashboardReposService(board).block(TENANT);

      expect(board.contagemAoVivo).toHaveBeenCalledTimes(MAX_REPOS_POR_CARGA);
      expect(out.repos).toHaveLength(MAX_REPOS_POR_CARGA);
    });

    it('o excedente viaja como NÚMERO — lista curta sem ele parece completa', async () => {
      const muitos = Array.from({ length: 17 }, (_, i) => alvo(i + 1));
      const board = boardFake({ reposDoTenant: jest.fn().mockResolvedValue(muitos) });

      const out = await new DashboardReposService(board).block(TENANT);

      expect(out.notLoaded).toBe(17 - MAX_REPOS_POR_CARGA);
    });

    it('abaixo do teto, nada fica de fora', async () => {
      const board = boardFake({
        reposDoTenant: jest.fn().mockResolvedValue([alvo(1), alvo(2)]),
      });

      const out = await new DashboardReposService(board).block(TENANT);

      expect(out.notLoaded).toBe(0);
      expect(out.repos).toHaveLength(2);
    });

    it('tenant sem repo nenhum devolve bloco vazio, não erro', async () => {
      const board = boardFake({ reposDoTenant: jest.fn().mockResolvedValue([]) });

      expect(await new DashboardReposService(board).block(TENANT)).toEqual({
        repos: [],
        notLoaded: 0,
      });
    });
  });

  describe('4. rate limit é explícito — NUNCA zero silencioso', () => {
    it('vira `rate_limit` com o horário de reposição, não contagem zero', async () => {
      // É a salvaguarda mais importante do bloco: contagem zero seria
      // indistinguível de "board vazio", e a pessoa concluiria que não há
      // trabalho nenhum naquele repo.
      const board = boardFake({
        contagemAoVivo: jest
          .fn()
          .mockRejectedValue(new RateLimitError('2026-08-15T16:00:00.000Z')),
      });

      const out = await new DashboardReposService(board).block(TENANT);

      expect(out.repos[0]).toMatchObject({
        status: 'failed',
        reason: 'rate_limit',
        retryAt: '2026-08-15T16:00:00.000Z',
      });
    });

    it('rate limit não devolve `columns` — não há contagem a mostrar', async () => {
      const board = boardFake({
        contagemAoVivo: jest.fn().mockRejectedValue(new RateLimitError(null)),
      });

      const out = await new DashboardReposService(board).block(TENANT);

      expect(out.repos[0]).not.toHaveProperty('columns');
    });
  });

  describe('leitura ao vivo, nada gravado (ADR-017)', () => {
    it('o service não tem prisma — não há como persistir nem por acidente', () => {
      const svc = new DashboardReposService(boardFake());

      for (const dep of Object.values(svc as unknown as Record<string, unknown>)) {
        expect(dep).not.toHaveProperty('$transaction');
      }
    });

    it('repo lido com sucesso devolve as 6 colunas, inclusive as vazias', async () => {
      // Coluna ausente faria a tela mostrar menos colunas para um repo que para
      // outro, e a pessoa leria como se aquele board fosse diferente.
      const out = await new DashboardReposService(boardFake()).block(TENANT);

      expect(out.repos[0]).toMatchObject({ status: 'ok', columns: COLUNAS_ZERADAS });
    });
  });
});
