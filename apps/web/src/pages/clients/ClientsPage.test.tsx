import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../../lib/api';
import { ThemeProvider } from '../../theme';
import { ClientsPage } from './ClientsPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiMock = vi.hoisted(() => ({
  listClients: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const client: Client = {
  id: 'c1',
  name: 'Rodrigo Reis Barros',
  cpf: '12345678900',
  company: 'RRB TRADING LTDA',
  cnpj: '11222333000144',
  email: 'rodreisb@gmail.com',
  phone: '11999990000',
  whatsapp: '11988880000',
  zipCode: '01001000',
  street: 'Praça da Sé',
  district: 'Sé',
  city: 'São Paulo',
  state: 'SP',
  notes: 'Cliente prioritário',
  createdAt: '2026-07-25T00:00:00.000Z',
};

function renderPage(canWrite = true) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/t/rodreisb/clients']}>
        <Routes>
          <Route path="/t/:tenant/clients" element={<ClientsPage canWrite={canWrite} />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ClientsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.listClients.mockResolvedValue([client]);
    apiMock.createClient.mockResolvedValue(client);
    apiMock.updateClient.mockResolvedValue(client);
    apiMock.deleteClient.mockResolvedValue({ deleted: true });
  });

  it('cria cliente com telefone e WhatsApp mascarados e envia só dígitos', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '+ Novo cliente' }));
    await user.type(screen.getByLabelText('Nome *'), 'Maria Cliente');
    await user.type(screen.getByLabelText('Telefone'), '11911112222');
    await user.type(screen.getByLabelText('WhatsApp'), '11933334444');

    expect(screen.getByLabelText('Telefone')).toHaveDisplayValue('(11) 91111-2222');
    expect(screen.getByLabelText('WhatsApp')).toHaveDisplayValue('(11) 93333-4444');

    await user.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() =>
      expect(apiMock.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Maria Cliente',
          phone: '11911112222',
          whatsapp: '11933334444',
        }),
      ),
    );
  });

  it('edita cliente existente com CPF/CNPJ mascarados e notas em largura total', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    expect(screen.getByLabelText('CPF')).toHaveDisplayValue('123.456.789-00');
    expect(screen.getByLabelText('CNPJ')).toHaveDisplayValue('11.222.333/0001-44');

    const phone = screen.getByLabelText('Telefone');
    await user.clear(phone);
    await user.type(phone, '11955556666');
    await user.clear(screen.getByLabelText('CPF'));
    await user.type(screen.getByLabelText('CPF'), '85790672191');
    await user.clear(screen.getByLabelText('CNPJ'));
    await user.type(screen.getByLabelText('CNPJ'), '60347383000109');

    expect(screen.getByLabelText('Notas internas').closest('label')).toHaveStyle({
      gridColumn: '1 / -1',
    });

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(apiMock.updateClient).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          cpf: '85790672191',
          cnpj: '60347383000109',
          phone: '11955556666',
        }),
      ),
    );
  });

  it('fecha o modal de edição com Esc', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(screen.getByRole('dialog', { name: 'Editar cliente' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Editar cliente' })).not.toBeInTheDocument();
  });

  it('não mostra ações de escrita para viewer', async () => {
    renderPage(false);

    expect(await screen.findByText('Rodrigo Reis Barros')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Novo cliente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
  });
});
