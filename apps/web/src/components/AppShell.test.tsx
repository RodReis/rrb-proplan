import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../lib/api';

const apiMock = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getPendingCount: vi.fn(),
  setActiveTenant: vi.fn(),
  clearActiveTenant: vi.fn(),
  // O `useDashboardNav` consulta o tenant antes de buscar (FIX #230). Aqui o
  // shell sempre fixa um, então o mock reflete o estado pós-fixação.
  getActiveTenant: vi.fn(() => 'tenant-uuid'),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, ...apiMock };
});

const { AppShell } = await import('./AppShell');
const { ThemeProvider } = await import('../theme');

const user: SessionUser = {
  id: 'u1',
  login: 'rodrigo',
  name: 'Rodrigo',
  avatarUrl: null,
  tenants: [{ id: 'tenant-uuid', accountLogin: 'RodrigoReis', role: 'owner' }],
};

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <AppShell user={user} section="ProPlan" onLogout={() => {}} {...props}>
          <span>conteúdo</span>
        </AppShell>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

/**
 * FIX #230 — o item Dashboard sumia do menu nas telas GLOBAIS.
 *
 * Elas desenham o menu sem passar pelo `ClientsRoute`, que é quem fixa o tenant
 * ativo. Sem ele o `request()` não prefixa `/dashboard` com `/t/:tenant`, a API
 * devolve 404, e o `catch` do `useDashboardNav` deixa `hasClients` em `false`.
 * O item some por falta de tenant — não por falta de cliente, que é a única
 * razão que a SPEC-035 §2.12 admite.
 */
describe('AppShell — tenant ativo nas telas globais (FIX #230)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getActiveTenant.mockReturnValue('tenant-uuid');
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: true });
    apiMock.getPendingCount.mockResolvedValue({ count: 2 });
  });

  it('fixa o tenant da sessão ao montar', async () => {
    renderShell();

    expect(apiMock.setActiveTenant).toHaveBeenCalledWith('tenant-uuid');
    // Espera o menu assentar: o `useDashboardNav` resolve depois da asserção e
    // atualizaria estado fora de `act`.
    await screen.findByRole('button', { name: /Dashboard/ });
  });

  it('o item Dashboard aparece no Catálogo quando o tenant tem cliente', async () => {
    renderShell();

    expect(await screen.findByRole('button', { name: /Dashboard/ })).toBeInTheDocument();
  });

  it('sem cliente o item continua sumindo — a regra da §2.12 não mudou', async () => {
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: false });
    renderShell();

    await waitFor(() => expect(apiMock.getDashboard).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Dashboard/ })).not.toBeInTheDocument();
  });

  it('solta o tenant ao desmontar — senão uma chamada global sai escopada', async () => {
    const { unmount } = renderShell();
    await screen.findByRole('button', { name: /Dashboard/ });

    unmount();

    // `clearActiveTenant(id)`, não `setActiveTenant(null)`: o cleanup diz QUAL
    // tenant está soltando, para não apagar o de quem já assumiu (FIX #230).
    expect(apiMock.clearActiveTenant).toHaveBeenCalledWith('tenant-uuid');
  });

  it('tenant explícito na prop vence o primeiro da sessão', async () => {
    const outro = {
      ...user,
      tenants: [
        { id: 'outro-uuid', accountLogin: 'Outro', role: 'owner' as const },
        ...user.tenants,
      ],
    };
    renderShell({ user: outro, tenant: 'RodrigoReis' });

    expect(apiMock.setActiveTenant).toHaveBeenCalledWith('tenant-uuid');
    await screen.findByRole('button', { name: /Dashboard/ });
  });

  it('a URL de /dashboard sai COM o prefixo do tenant já na 1ª chamada', async () => {
    // O teste que faltava na 1ª rodada do FIX. Os outros mockam `getDashboard`,
    // que é *acima* de `withTenantPrefix` — o prefixo nunca aparecia neles, e
    // por isso passaram enquanto o bug seguia vivo em tela.
    //
    // Efeito de filho roda ANTES do efeito do pai: com o `setActiveTenant` num
    // `useEffect` do AppShell, o `useDashboardNav` (dentro do GlobalNav) já
    // tinha disparado a chamada sem prefixo. Ela morria em 404 e nada a
    // repetia. Aqui a prova é a URL real que o `fetch` recebe.
    // `getDashboard` E `setActiveTenant` reais: o mock do módulo troca os dois,
    // e sem o `setActiveTenant` de verdade não há `activeTenant` para o
    // `withTenantPrefix` real ler — o teste mediria o próprio mock.
    const real = await vi.importActual<typeof import('../lib/api')>('../lib/api');
    apiMock.getDashboard.mockImplementation(real.getDashboard as never);
    apiMock.setActiveTenant.mockImplementation(real.setActiveTenant as never);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ hasAnyClient: true }), { status: 200 }),
      );

    try {
      renderShell();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

      const url = String(fetchSpy.mock.calls[0][0]);
      expect(url).toContain('/t/tenant-uuid/dashboard');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('sessão sem tenant nenhum não fixa nada', async () => {
    renderShell({ user: { ...user, tenants: [] } });

    expect(apiMock.setActiveTenant).not.toHaveBeenCalled();
    // Sem tenant o hook nem chama a API — o menu fica sem o item.
    await waitFor(() => expect(apiMock.getDashboard).not.toHaveBeenCalled());
  });
});
