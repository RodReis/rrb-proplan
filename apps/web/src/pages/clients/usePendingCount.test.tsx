import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ getPendingCount: vi.fn() }));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { usePendingCount } = await import('./usePendingCount');

/** Mostra o contador e oferece um botão que navega para outra rota. */
function Sonda({ enabled = true }: { enabled?: boolean }) {
  const count = usePendingCount(enabled);
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="contador">{count === null ? 'sem-badge' : String(count)}</span>
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

describe('usePendingCount (SPEC-035 §2.10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getPendingCount.mockResolvedValue({ count: 3 });
    ocultarAba('visible');
  });

  it('busca o contador ao montar', async () => {
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
    // Zero é uma afirmação: "nada espera por você" — e é a mais cara de errar,
    // porque a pessoa deixa de olhar. Sem número é honesto; zero falso não é.
    apiMock.getPendingCount.mockRejectedValue(new Error('rede'));
    renderSonda();

    expect(await screen.findByText('sem-badge')).toBeInTheDocument();
  });

  it('desabilitado não chama a API — o item some sem cliente (§2.12)', async () => {
    renderSonda(false);

    await waitFor(() => expect(screen.getByTestId('contador')).toHaveTextContent('sem-badge'));
    expect(apiMock.getPendingCount).not.toHaveBeenCalled();
  });
});
