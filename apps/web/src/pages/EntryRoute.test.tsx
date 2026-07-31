import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../lib/api';

const apiMock = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  setActiveTenant: vi.fn(),
}));

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return { ...actual, ...apiMock };
});

const { EntryRoute } = await import('./EntryRoute');

const user: SessionUser = {
  id: 'u1',
  login: 'rodrigo',
  name: 'Rodrigo',
  avatarUrl: null,
  tenants: [{ id: 'tenant-uuid', accountLogin: 'RodrigoReis', role: 'owner' }],
};

/** Mostra o token de tenant que a URL de destino realmente carregou. */
function Destino() {
  const { tenant } = useParams();
  return <span>dashboard de {tenant}</span>;
}

function renderEntrada(sessionUser: SessionUser = user) {
  return render(
    <MemoryRouter initialEntries={['/entrar']}>
      <Routes>
        <Route path="/entrar" element={<EntryRoute user={sessionUser} />} />
        <Route path="/" element={<span>catálogo</span>} />
        <Route path="/t/:tenant/dashboard" element={<Destino />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntryRoute — porta de entrada do login (FIX #230)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: true });
  });

  it('tenant COM cliente → Dashboard', async () => {
    renderEntrada();

    expect(await screen.findByText(/^dashboard de/)).toBeInTheDocument();
  });

  it('tenant SEM cliente → Catálogo', async () => {
    // A SPEC-035 §2.12 esconde o item de menu neste caso; mandar para uma tela
    // que o menu não mostra seria contradizê-la.
    apiMock.getDashboard.mockResolvedValue({ hasAnyClient: false });
    renderEntrada();

    expect(await screen.findByText('catálogo')).toBeInTheDocument();
  });

  it('falha na chamada → Catálogo, que funciona em qualquer estado', async () => {
    apiMock.getDashboard.mockRejectedValue(new Error('rede'));
    renderEntrada();

    expect(await screen.findByText('catálogo')).toBeInTheDocument();
  });

  it('sem tenant nenhum → Catálogo, sem chamar a API', async () => {
    renderEntrada({ ...user, tenants: [] });

    expect(await screen.findByText('catálogo')).toBeInTheDocument();
    expect(apiMock.getDashboard).not.toHaveBeenCalled();
  });

  it('fixa o tenant ANTES da chamada e o solta depois', async () => {
    // Sem o tenant fixo, `/dashboard` sai sem o prefixo `/t/:tenant` e a API
    // devolve 404 — o mesmo laço que escondia o item do menu. E deixá-lo fixo
    // depois faria uma chamada global seguinte sair escopada por engano.
    renderEntrada();
    await screen.findByText(/^dashboard de/);

    expect(apiMock.setActiveTenant.mock.calls).toEqual([['tenant-uuid'], [null]]);
  });

  it('a URL do dashboard usa o slug em MINÚSCULAS, como as demais rotas', async () => {
    // A sessão traz `RodrigoReis`; a barra de endereço mostra `rodrigoreis`.
    renderEntrada();

    expect(await screen.findByText('dashboard de rodrigoreis')).toBeInTheDocument();
  });
});
