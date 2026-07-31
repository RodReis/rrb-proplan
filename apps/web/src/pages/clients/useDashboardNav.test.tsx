import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getPendingCount: vi.fn(),
  // O hook consulta o tenant antes de chamar: sem ele a busca é adiada de
  // propósito, porque sairia sem o prefixo `/t/:tenant` e morreria em 404
  // (FIX #230). O padrão dos testes é "tenant fixado"; o caso sem tenant tem
  // bloco próprio no fim.
  getActiveTenant: vi.fn(() => 'tenant-uuid'),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { useDashboardNav, resetDashboardNavCache } = await import('./useDashboardNav');

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
    resetDashboardNavCache();
    apiMock.getActiveTenant.mockReturnValue('tenant-uuid');
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

/**
 * A corrida que o FIX #230 fecha, medida no navegador antes de virar teste.
 *
 * Numa navegação entre telas, o `GlobalNav` **ainda montado** reage ao novo
 * `pathname` e dispara a busca ANTES de o shell de destino fixar o tenant. Sem
 * tenant a URL sai sem `/t/:tenant`, a API devolve 404, e o componente é
 * desmontado logo depois — o `GlobalNav` novo nasce em `false` e nunca repete a
 * chamada, porque para ele o `pathname` já é o de destino.
 *
 * O sintoma era o item Dashboard sumindo ao clicar em ProPlan vindo de qualquer
 * tela de cliente. Com F5 aparecia; navegando, não — e é essa assimetria que o
 * denunciava como corrida, não como regra de negócio.
 */
describe('espera o tenant antes de buscar (FIX #230)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDashboardNavCache();
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: true });
    apiMock.getPendingCount.mockResolvedValue({ count: 3 });
    ocultarAba('visible');
  });

  it('sem tenant no primeiro quadro, NÃO chama a API', async () => {
    // Chamar aqui produziria `/dashboard` cru e um 404 garantido.
    apiMock.getActiveTenant.mockReturnValue(null);
    renderSonda();

    await waitFor(() => expect(apiMock.getActiveTenant).toHaveBeenCalled());
    expect(apiMock.getDashboard).not.toHaveBeenCalled();
  });

  it('tenant que chega no quadro seguinte é aproveitado — o item aparece', async () => {
    // A sequência real: o shell de destino fixa o tenant durante a própria
    // render, um quadro depois da primeira tentativa.
    apiMock.getActiveTenant.mockReturnValueOnce(null).mockReturnValue('tenant-uuid');
    renderSonda();

    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('visivel'));
    expect(apiMock.getDashboard).toHaveBeenCalled();
  });

  it('tenant que NUNCA chega não vira laço de tentativas', async () => {
    // Sessão sem membership: o item não deve aparecer, e a tela não pode ficar
    // reagendando para sempre.
    apiMock.getActiveTenant.mockReturnValue(null);
    renderSonda();

    await waitFor(() => expect(apiMock.getActiveTenant).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 60));

    expect(apiMock.getDashboard).not.toHaveBeenCalled();
    expect(screen.getByTestId('item')).toHaveTextContent('some');

    // O que importa é não virar laço: a contagem para de crescer. Afirmar um
    // número exato mediria a implementação (os inicializadores de estado também
    // consultam o tenant), não o comportamento.
    const estavel = apiMock.getActiveTenant.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(apiMock.getActiveTenant.mock.calls.length).toBe(estavel);
  });
});

/**
 * A tremida do menu (polish do PI, 2026-07-31).
 *
 * O `GlobalNav` é remontado a cada navegação, e o estado nascia em `false`: o
 * item sumia e voltava num intervalo **medido em 26 ms** no navegador — rápido
 * demais para ler, lento o bastante para o olho pegar.
 *
 * A resposta não é esperar menos, é **não esquecer**: o fato "este tenant tem
 * clientes" não muda entre duas telas. Quem esquecia era a montagem.
 */
describe('não pisca ao navegar (polish do FIX #230)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDashboardNavCache();
    apiMock.getActiveTenant.mockReturnValue('tenant-uuid');
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: true });
    apiMock.getPendingCount.mockResolvedValue({ count: 3 });
    ocultarAba('visible');
  });

  it('a 2ª montagem já nasce com o item visível', async () => {
    // 1ª visita: confirma no servidor.
    const { unmount } = renderSonda();
    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('visivel'));
    unmount();

    // 2ª montagem (outra tela): o item está lá ANTES de qualquer resposta.
    renderSonda();

    expect(screen.getByTestId('item')).toHaveTextContent('visivel');
  });

  it('o contador também não pisca entre montagens', async () => {
    const { unmount } = renderSonda();
    await screen.findByText('3');
    unmount();

    renderSonda();

    // Um badge que some e volta sugere que algo mudou quando nada mudou.
    expect(screen.getByTestId('contador')).toHaveTextContent('3');
  });

  it('a memória NÃO ressuscita o item quando o tenant perde os clientes', async () => {
    // O risco de lembrar: afirmar um fato velho. A resposta nova sempre vence.
    const { unmount } = renderSonda();
    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('visivel'));
    unmount();

    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: false });
    renderSonda();

    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('some'));
  });

  it('outro tenant NÃO herda o "tem clientes" do anterior', async () => {
    // A resposta é do tenant, não do app: trocar de workspace zera a suposição.
    const { unmount } = renderSonda();
    await waitFor(() => expect(screen.getByTestId('item')).toHaveTextContent('visivel'));
    unmount();

    apiMock.getActiveTenant.mockReturnValue('outro-tenant');
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: false });
    renderSonda();

    // Nasce escondido: para este tenant ninguém confirmou nada ainda.
    expect(screen.getByTestId('item')).toHaveTextContent('some');
  });
});
