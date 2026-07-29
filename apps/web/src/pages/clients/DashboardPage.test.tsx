import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardView, ReposBlock } from '../../lib/api';
import { ThemeProvider } from '../../theme';

const apiMock = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getDashboardRepos: vi.fn(),
  getPendingCount: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { DashboardPage } = await import('./DashboardPage');

const FUNIL = [
  { column: 'novo' as const, count: 2 },
  { column: 'briefing' as const, count: 1 },
  { column: 'prompt_contrato' as const, count: 0 },
  { column: 'producao_entrega' as const, count: 3 },
];

function view(over: Partial<DashboardView> = {}): DashboardView {
  return {
    period: '30',
    hasAnyClient: true,
    activity: [],
    pending: [],
    funnel: FUNIL,
    contracts: { issued: 0, accepted: 0, hasAny: false },
    ...over,
  };
}

function repos(over: Partial<ReposBlock> = {}): ReposBlock {
  return { repos: [], notLoaded: 0, ...over };
}

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/t/rodreisb/dashboard']}>
        <Routes>
          <Route path="/t/:tenant/dashboard" element={<DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('DashboardPage (SPEC-035)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getDashboard.mockResolvedValue(view());
    apiMock.getDashboardRepos.mockResolvedValue(repos());
    apiMock.getPendingCount.mockResolvedValue({ count: 0 });
  });

  describe('os quatro blocos, e nenhum número cruzando os domínios (§2.4)', () => {
    it('renderiza os quatro blocos da tela de retomada', async () => {
      renderPage();

      expect(await screen.findByRole('heading', { name: 'Esperando você' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'O que andou por aqui' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Funil de clientes' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Kanban de repos' })).toBeInTheDocument();
    });

    it('o funil mostra as 4 colunas, incluindo a que está zerada', async () => {
      // Coluna ausente faria a pessoa concluir que ela não existe — ausência e
      // zero são coisas diferentes (§2.7).
      renderPage();

      const funil = (await screen.findByRole('heading', { name: 'Funil de clientes' }))
        .closest('section')!;
      for (const rotulo of ['Novo', 'Briefing', 'Prompt & contrato', 'Produção & entrega']) {
        expect(within(funil).getByText(rotulo)).toBeInTheDocument();
      }
      expect(within(funil).getByText('0')).toBeInTheDocument();
    });
  });

  describe('zero é resultado; ausência é outra coisa (§2.7, §5)', () => {
    it('tenant que NUNCA emitiu contrato lê outra frase, não "0"', async () => {
      apiMock.getDashboard.mockResolvedValue(
        view({ contracts: { issued: 0, accepted: 0, hasAny: false } }),
      );
      renderPage();

      expect(await screen.findByText('Você ainda não emitiu contrato')).toBeInTheDocument();
    });

    it('tenant que emitiu e teve zero NO PERÍODO lê um resultado', async () => {
      apiMock.getDashboard.mockResolvedValue(
        view({ contracts: { issued: 0, accepted: 0, hasAny: true } }),
      );
      renderPage();

      expect(
        await screen.findByText('Nenhum contrato emitido no período'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Você ainda não emitiu contrato')).not.toBeInTheDocument();
    });
  });

  describe('drill-down: link quando há destino, texto quando não (§7.3)', () => {
    it('item com destino é LINK para o painel certo', async () => {
      apiMock.getDashboard.mockResolvedValue(
        view({
          pending: [
            {
              kind: 'artifact_review',
              clientId: 'c1',
              clientProjectId: 'p1',
              title: 'Loja nova',
              detail: 'Artefato SCOPE aguardando revisão',
              target: 'artefatos',
              since: '2026-08-01T00:00:00.000Z',
            },
          ],
        }),
      );
      renderPage();

      const link = await screen.findByRole('link', { name: /Loja nova/ });
      expect(link).toHaveAttribute(
        'href',
        '/t/rodreisb/clients?cliente=c1&projeto=p1&painel=artefatos',
      );
    });

    it('item SEM destino é TEXTO — nunca link morto', async () => {
      // Um link que leva a 404 ensina a pessoa a desconfiar de todos os outros.
      apiMock.getDashboard.mockResolvedValue(
        view({
          pending: [
            {
              kind: 'stalled',
              clientId: 'c1',
              clientProjectId: 'p1',
              title: 'Projeto parado',
              detail: 'Parado há mais de 7 dias',
              target: null,
              since: '2026-06-01T00:00:00.000Z',
            },
          ],
        }),
      );
      renderPage();

      expect(await screen.findByText('Projeto parado')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Projeto parado/ })).not.toBeInTheDocument();
    });
  });

  describe('estados vazios têm TEXTO, não lista em branco (§5)', () => {
    it('sem trilha, "O que andou por aqui" explica', async () => {
      renderPage();

      expect(await screen.findByText('Nada registrado no período.')).toBeInTheDocument();
    });

    it('sem pendência, o bloco diz que não há nada esperando', async () => {
      renderPage();

      expect(await screen.findByText('Nada esperando por você agora.')).toBeInTheDocument();
    });
  });

  describe('período: lista fechada, padrão 30 (§2.8)', () => {
    it('abre em 30 dias', async () => {
      renderPage();

      await waitFor(() => expect(apiMock.getDashboard).toHaveBeenCalledWith('30'));
      expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('trocar o período recarrega SÓ os blocos locais', async () => {
      // O bloco de repos é a contagem do momento, não de uma janela (§2.6) —
      // trocar o período não deve gastar N chamadas ao GitHub de novo.
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('heading', { name: 'Funil de clientes' });
      const reposAntes = apiMock.getDashboardRepos.mock.calls.length;

      await user.click(screen.getByRole('button', { name: '90 dias' }));

      await waitFor(() => expect(apiMock.getDashboard).toHaveBeenCalledWith('90'));
      expect(apiMock.getDashboardRepos.mock.calls.length).toBe(reposAntes);
    });
  });

  describe('o bloco de repos e as salvaguardas (§2.11)', () => {
    it('repo lido mostra as contagens por coluna', async () => {
      apiMock.getDashboardRepos.mockResolvedValue(
        repos({
          repos: [
            {
              status: 'ok',
              projectId: 'p1',
              repo: 'RodReis/rrb-proplan',
              columns: [
                { column: 'backlog', count: 4 },
                { column: 'doing', count: 2 },
              ],
            },
          ],
        }),
      );
      renderPage();

      expect(await screen.findByText('RodReis/rrb-proplan')).toBeInTheDocument();
      expect(screen.getByText('Backlog')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('repo que falha é NOMEADO e o resto da tela continua', async () => {
      apiMock.getDashboardRepos.mockResolvedValue(
        repos({
          repos: [
            {
              status: 'failed',
              projectId: 'p1',
              repo: 'RodReis/quebrado',
              reason: 'error',
              retryAt: null,
            },
          ],
        }),
      );
      renderPage();

      expect(await screen.findByText('RodReis/quebrado')).toBeInTheDocument();
      expect(screen.getByText('Não foi possível carregar')).toBeInTheDocument();
      // O resto do dashboard renderizou.
      expect(screen.getByRole('heading', { name: 'Funil de clientes' })).toBeInTheDocument();
    });

    it('rate limit diz que é limite e quando volta — NUNCA zero', async () => {
      // Zero seria indistinguível de "board vazio", e a pessoa concluiria que
      // não há trabalho nenhum naquele repo.
      apiMock.getDashboardRepos.mockResolvedValue(
        repos({
          repos: [
            {
              status: 'failed',
              projectId: 'p1',
              repo: 'RodReis/limitado',
              reason: 'rate_limit',
              retryAt: '2026-08-15T16:30:00.000Z',
            },
          ],
        }),
      );
      renderPage();

      const texto = await screen.findByText(/Limite do GitHub atingido/);
      expect(texto).toBeInTheDocument();
      expect(texto.textContent).toMatch(/\d{2}:\d{2}/);
    });

    it('acima do teto, a tela diz quantos ficaram de fora', async () => {
      // Lista curta sem o número leria como "são só estes".
      apiMock.getDashboardRepos.mockResolvedValue(
        repos({
          repos: [{ status: 'ok', projectId: 'p1', repo: 'a/b', columns: [] }],
          notLoaded: 7,
        }),
      );
      renderPage();

      expect(await screen.findByText(/Mais 7 repositórios não consultados/)).toBeInTheDocument();
    });

    it('a falha do bloco INTEIRO não derruba a tela', async () => {
      // A salvaguarda 1 em pixels: o dashboard já renderizou, e o bloco isolado
      // mostra o próprio erro.
      apiMock.getDashboardRepos.mockRejectedValue(new Error('rede'));
      renderPage();

      expect(
        await screen.findByText('Não foi possível consultar o GitHub agora.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Funil de clientes' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Esperando você' })).toBeInTheDocument();
    });
  });

  describe('falha do dashboard principal', () => {
    it('mostra o erro em vez de tela em branco', async () => {
      apiMock.getDashboard.mockRejectedValue(new Error('API 500: caiu'));
      renderPage();

      expect(await screen.findByText(/caiu/)).toBeInTheDocument();
    });
  });
});
