import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getPendingCount: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { useDashboardNav } = await import('./useDashboardNav');

/** Mostra o estado do menu e oferece um botão que navega para outra rota. */
function Sonda({ enabled = true }: { enabled?: boolean }) {
  const { hasClients, pendingCount } = useDashboardNav(enabled);
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="item">{hasClients ? 'visivel' : 'some'}</span>
      <span data-testid="contador">
        {pendingCount === null ? 'sem-badge' : String(pendingCount)}
      </span>
      <button onClick={() => navigate('/outra')}>ir</button>
    </>
  );
}

function renderSonda(enabled = true) {
  return render(
    <MemoryRouter initialEntries={['/inicial']}>
      <Routes>
        <Route path="/inicial" element={<Sonda enabled={enabled} />} />
        <Route path="/outra" element={<Sonda enabled={enabled} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function ocultarAba(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => estado,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useDashboardNav (SPEC-035 §2.10, §2.12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: true });
    apiMock.getPendingCount.mockResolvedValue({ count: 3 });
    ocultarAba('visible');
  });

  describe('o item some sem cliente nenhum (§2.12)', () => {
    it('tenant SEM cliente: o item não aparece', async () => {
      // Some ≠ aparecer vazio: uma tela de retomada sem nada a retomar não é
      // informação, é ruído no menu.
      apiMock.getDashboard.mockResolvedValue({ hasAnyClient: false });
      renderSonda();

      await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('some'));
    });

    it('tenant COM cliente: o item aparece', async () => {
      renderSonda();

      await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('visivel'));
    });

    it('sem cliente, o contador NEM é buscado — não há item para exibi-lo', async () => {
      apiMock.getDashboard.mockResolvedValue({ hasAnyClient: false });
      renderSonda();

      await waitFor(() => expect(apiMock.getDashboard).toHaveBeenCalled());
      expect(apiMock.getPendingCount).not.toHaveBeenCalled();
    });

    it('começa escondido e só liga quando o servidor confirma', () => {
      // Mostrar o item e escondê-lo meio segundo depois pisca na cara de quem
      // já ia clicar.
      renderSonda();

      expect(screen.getByTestId('item')).toHaveTextContent('some');
    });
  });

  describe('o contador (§2.10)', () => {
    it('busca ao montar', async () => {
      renderSonda();

      expect(await screen.findByText('3')).toBeInTheDocument();
    });

    it('atualiza AO NAVEGAR entre telas', async () => {
      const user = userEvent.setup();
      renderSonda();
      await screen.findByText('3');

      apiMock.getPendingCount.mockResolvedValue({ count: 5 });
      await user.click(screen.getByRole('button', { name: 'ir' }));

      expect(await screen.findByText('5')).toBeInTheDocument();
    });

    it('atualiza AO VOLTAR O FOCO da aba', async () => {
      renderSonda();
      await screen.findByText('3');

      apiMock.getPendingCount.mockResolvedValue({ count: 7 });
      ocultarAba('hidden');
      ocultarAba('visible');

      expect(await screen.findByText('7')).toBeInTheDocument();
    });

    it('aba indo para OCULTA não dispara request — não é "voltar"', async () => {
      renderSonda();
      await screen.findByText('3');
      const antes = apiMock.getPendingCount.mock.calls.length;

      ocultarAba('hidden');

      expect(apiMock.getPendingCount.mock.calls.length).toBe(antes);
    });

    it('NÃO faz polling — sem request novo com o tempo passando', async () => {
      // O §5 cobra a ausência de `setInterval` por nome. Aqui a prova é de
      // comportamento: o relógio anda e nada é buscado.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        renderSonda();
        await waitFor(() => expect(apiMock.getPendingCount).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

        expect(apiMock.getPendingCount).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('falha vira `null` (sem badge), NUNCA zero', async () => {
      // Zero é a afirmação "nada espera por você" — a mais cara de errar,
      // porque a pessoa deixa de olhar. Sem número é honesto; zero falso não é.
      apiMock.getPendingCount.mockRejectedValue(new Error('rede'));
      renderSonda();

      await waitFor(() =>
        expect(screen.getByTestId('contador')).toHaveTextContent('sem-badge'),
      );
    });

    it('falha de rede NÃO esconde o item já exibido', async () => {
      // Falha de rede não é evidência de que os clientes sumiram.
      const user = userEvent.setup();
      renderSonda();
      await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('visivel'));

      apiMock.getDashboard.mockRejectedValue(new Error('rede'));
      await user.click(screen.getByRole('button', { name: 'ir' }));

      await waitFor(() =>
        expect(screen.getByTestId('contador')).toHaveTextContent('sem-badge'),
      );
      expect(screen.getByTestId('item')).toHaveTextContent('visivel');
    });

    it('desabilitado não chama a API', async () => {
      renderSonda(false);

      await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('some'));
      expect(apiMock.getDashboard).not.toHaveBeenCalled();
      expect(apiMock.getPendingCount).not.toHaveBeenCalled();
    });
  });
});
