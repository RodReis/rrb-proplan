import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, ClientDetail } from '../../lib/api';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const apiMock = vi.hoisted(() => ({
  getClient: vi.fn(),
  createClientProject: vi.fn(),
  getBriefingLink: vi.fn(),
  createBriefingLink: vi.fn(),
  revokeBriefingLink: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const { ClientDetailPanel } = await import('./ClientDetailPanel');

const client: Client = {
  id: 'c1',
  name: 'Rafaela M M Barros',
  cpf: null,
  company: 'EPG Trindade',
  cnpj: null,
  email: 'rafaela@epg.com.br',
  phone: null,
  whatsapp: null,
  zipCode: null,
  street: null,
  district: null,
  city: null,
  state: null,
  notes: null,
  createdAt: '2026-07-26T10:00:00Z',
};

function detail(projects: ClientDetail['projects'] = []): ClientDetail {
  return { ...client, projects };
}

function renderPanel(canWrite = true) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <ClientDetailPanel
      client={client}
      canWrite={canWrite}
      onClose={onClose}
      onChanged={onChanged}
    />,
  );
  return { onChanged, onClose };
}

describe('ClientDetailPanel', () => {
  beforeEach(() => {
    Object.values(apiMock).forEach((fn) => fn.mockReset());
    apiMock.getClient.mockResolvedValue(detail());
    apiMock.getBriefingLink.mockResolvedValue({ active: false });
    apiMock.createBriefingLink.mockResolvedValue({
      id: 'l1',
      token: 'tok-secreto-256',
      expiresAt: null,
    });
    apiMock.revokeBriefingLink.mockResolvedValue({ revoked: 1 });
  });

  it('lista os projetos do cliente com o estado de cada um', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site institucional',
          description: 'landing + blog',
          state: 'DRAFT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    renderPanel();

    expect(await screen.findByText('Site institucional')).toBeInTheDocument();
    expect(screen.getByText('landing + blog')).toBeInTheDocument();
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
  });

  it('cliente sem projeto explica que criar é o que alimenta o funil', async () => {
    renderPanel();
    expect(
      await screen.findByText(/crie o primeiro para ele aparecer no funil/i),
    ).toBeInTheDocument();
  });

  // ESTE é o teste que faltava e deixou o bug passar: nada afirmava que a UI
  // consegue CRIAR um projeto, então o funil ficava vazio para sempre.
  it('cria projeto pela UI e avisa o pai para recarregar o funil', async () => {
    apiMock.createClientProject.mockResolvedValue({
      id: 'p-novo',
      clientId: 'c1',
      title: 'Loja virtual',
      description: null,
      state: 'DRAFT',
      createdAt: '2026-07-26T13:00:00Z',
      updatedAt: '2026-07-26T13:00:00Z',
    });
    const { onChanged } = renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /novo projeto/i }),
    );
    await userEvent.type(screen.getByLabelText(/título/i), 'Loja virtual');
    await userEvent.click(screen.getByRole('button', { name: /criar projeto/i }));

    await waitFor(() =>
      expect(apiMock.createClientProject).toHaveBeenCalledWith('c1', {
        title: 'Loja virtual',
        description: null,
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('título vazio não dispara request', async () => {
    renderPanel();
    await userEvent.click(
      await screen.findByRole('button', { name: /novo projeto/i }),
    );

    expect(screen.getByRole('button', { name: /criar projeto/i })).toBeDisabled();
    expect(apiMock.createClientProject).not.toHaveBeenCalled();
  });

  it('após criar, abre o link de briefing e o token aparece uma vez', async () => {
    apiMock.createClientProject.mockResolvedValue({
      id: 'p-novo',
      clientId: 'c1',
      title: 'Loja virtual',
      description: null,
      state: 'DRAFT',
      createdAt: '2026-07-26T13:00:00Z',
      updatedAt: '2026-07-26T13:00:00Z',
    });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /novo projeto/i }),
    );
    await userEvent.type(screen.getByLabelText(/título/i), 'Loja virtual');
    await userEvent.click(screen.getByRole('button', { name: /criar projeto/i }));

    expect(
      await screen.findByRole('dialog', { name: /link de briefing/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /gerar link/i }));

    // O token completo só existe na resposta do POST — a UI o mostra com o aviso.
    const campo = await screen.findByDisplayValue(/\/b\/tok-secreto-256$/);
    expect(campo).toHaveAttribute('readonly');
    expect(
      screen.getByText(/não será exibido novamente/i),
    ).toBeInTheDocument();
  });

  it('link válido oferece Revogar e o botão diz Regenerar, não Gerar', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site',
          description: null,
          state: 'LINK_SENT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    apiMock.getBriefingLink.mockResolvedValue({
      active: true,
      id: 'l1',
      expiresAt: null,
      createdAt: '2026-07-26T12:00:00Z',
      status: 'valid',
    });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );

    expect(await screen.findByText('link ativo')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /regenerar link/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^gerar link$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revogar/i })).toBeInTheDocument();
  });

  it('regenerar pede confirmação — invalida o link que o cliente já recebeu', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site',
          description: null,
          state: 'LINK_SENT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    apiMock.getBriefingLink.mockResolvedValue({
      active: true,
      id: 'l1',
      expiresAt: null,
      createdAt: '2026-07-26T12:00:00Z',
      status: 'valid',
    });
    renderPanel();

    await userEvent.click(
      await screen.findByRole('button', { name: /link de briefing/i }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /regenerar link/i }),
    );

    expect(await screen.findByText(/deixa de funcionar imediatamente/i)).toBeInTheDocument();
    expect(apiMock.createBriefingLink).not.toHaveBeenCalled();
  });

  it('viewer lê os projetos mas não vê criar nem gerar link', async () => {
    apiMock.getClient.mockResolvedValue(
      detail([
        {
          id: 'p1',
          clientId: 'c1',
          title: 'Site',
          description: null,
          state: 'DRAFT',
          createdAt: '2026-07-26T12:00:00Z',
          updatedAt: '2026-07-26T12:00:00Z',
        },
      ]),
    );
    renderPanel(false);

    expect(await screen.findByText('Site')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /novo projeto/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /link de briefing/i }),
    ).not.toBeInTheDocument();
  });

  it('Esc fecha a gaveta', async () => {
    const { onClose } = renderPanel();
    await screen.findByText(/nenhum projeto ainda/i);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('falha ao carregar mostra aviso com "tentar de novo", não painel em branco', async () => {
    apiMock.getClient.mockRejectedValue(new Error('API 500: db down'));
    renderPanel();

    expect(
      await screen.findByText(/não foi possível carregar os projetos/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/db down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
  });
});
