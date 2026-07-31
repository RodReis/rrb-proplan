import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../lib/api';

const apiMock = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  getPendingCount: vi.fn(),
  setActiveTenant: vi.fn(),
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
    apiMock.setActiveTenant.mockClear();

    unmount();

    expect(apiMock.setActiveTenant).toHaveBeenCalledWith(null);
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

  it('sessão sem tenant nenhum não fixa nada', async () => {
    renderShell({ user: { ...user, tenants: [] } });

    expect(apiMock.setActiveTenant).not.toHaveBeenCalled();
    // Sem tenant o hook nem chama a API — o menu fica sem o item.
    await waitFor(() => expect(apiMock.getDashboard).not.toHaveBeenCalled());
  });
});
