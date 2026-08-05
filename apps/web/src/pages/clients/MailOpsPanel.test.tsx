import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailDeliveryOpsView } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listMailDeliveries: vi.fn(),
  retryMailDelivery: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { MailOpsPanel } = await import('./MailOpsPanel');

function entrega(over: Partial<MailDeliveryOpsView> = {}): MailDeliveryOpsView {
  return {
    id: 'entrega-1',
    to: 'comprador@exemplo.com',
    template: 'license_revoked',
    subject: 'Sua licença foi encerrada',
    status: 'FAILED',
    attempts: 5,
    error: 'connect ECONNREFUSED',
    providerMessageId: null,
    licenseId: 'lic-1',
    createdAt: '2026-08-04T12:00:00.000Z',
    sentAt: null,
    canRetry: true,
    retryBlockedReason: null,
    ...over,
  };
}

/**
 * O que estes testes protegem: a seção existe para responder *"a chave chegou ao
 * comprador?"* (FIX #254). Antes dela, uma entrega em `FAILED` só existia dentro
 * do detalhe de uma licença — para achá-la era preciso já saber a resposta.
 */
describe('MailOpsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.listMailDeliveries.mockResolvedValue([]);
    apiMock.retryMailDelivery.mockResolvedValue({ enqueued: true });
  });

  it('abre nas falhas — é o único estado que pede ação', async () => {
    // Abrir em "todas" enterraria as falhas no histórico de envios que deram
    // certo, que é o oposto do que uma aba chamada Pendências promete.
    render(<MailOpsPanel />);

    await waitFor(() => expect(apiMock.listMailDeliveries).toHaveBeenCalledWith('FAILED'));
  });

  it('conta as falhas no badge da seção', async () => {
    apiMock.listMailDeliveries.mockResolvedValue([
      entrega(),
      entrega({ id: 'e2' }),
      entrega({ id: 'e3', status: 'SENT' }),
    ]);

    render(<MailOpsPanel />);

    expect(await screen.findByText('2 falhas')).toBeInTheDocument();
  });

  it('mostra o e-mail, o motivo do erro e as tentativas gastas', async () => {
    // As três coisas que decidem o que fazer: para quem não foi, por que parou,
    // e se o retry automático já se esgotou.
    apiMock.listMailDeliveries.mockResolvedValue([entrega()]);

    render(<MailOpsPanel />);

    expect(await screen.findByText('comprador@exemplo.com')).toBeInTheDocument();
    expect(screen.getByText('connect ECONNREFUSED')).toBeInTheDocument();
    expect(screen.getByText(/5 tentativas/)).toBeInTheDocument();
  });

  it('reenfileira a falha e não afirma que o e-mail chegou', async () => {
    // O job é assíncrono: dizer "enviada" aqui seria o fechamento frágil que
    // este produto existe para detectar.
    apiMock.listMailDeliveries.mockResolvedValue([entrega()]);
    const user = userEvent.setup();

    render(<MailOpsPanel />);
    await user.click(await screen.findByRole('button', { name: 'Reenfileirar' }));

    expect(apiMock.retryMailDelivery).toHaveBeenCalledWith('entrega-1');
    expect(toastMock.success.mock.calls[0][0]).toMatch(/reenfileirada/i);
    expect(toastMock.success.mock.calls[0][0]).not.toMatch(/enviada/i);
  });

  it('na chave da licença não oferece botão — mostra o caminho que resolve', async () => {
    // A decisão central do FIX: a chave em claro não existe mais, então
    // reenviar mandaria a mensagem com o campo vazio. Um botão que sempre
    // falha ensina a ignorar erro.
    apiMock.listMailDeliveries.mockResolvedValue([
      entrega({
        template: 'license_key',
        canRetry: false,
        retryBlockedReason: 'A chave não é guardada. Use Reemitir na licença.',
      }),
    ]);

    render(<MailOpsPanel />);

    expect(await screen.findByText(/Use Reemitir na licença/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenfileirar' })).not.toBeInTheDocument();
  });

  it('não oferece reenfileirar em entrega já enviada', async () => {
    // Reenfileirar o que deu certo mandaria o e-mail duas vezes ao comprador.
    apiMock.listMailDeliveries.mockResolvedValue([
      entrega({ status: 'SENT', sentAt: '2026-08-04T12:05:00.000Z' }),
    ]);

    render(<MailOpsPanel />);

    expect(await screen.findByText('Enviada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reenfileirar' })).not.toBeInTheDocument();
  });

  it('o vazio em Falhas afirma que nada falhou, não que nada existe', async () => {
    // "Nenhuma entrega" num filtro de falhas seria lido como "nenhum e-mail
    // foi enviado", que é uma afirmação diferente e alarmante.
    render(<MailOpsPanel />);

    expect(await screen.findByText(/Nenhuma entrega falhou/)).toBeInTheDocument();
  });

  it('troca o filtro sem recarregar a página', async () => {
    const user = userEvent.setup();
    render(<MailOpsPanel />);

    await user.click(await screen.findByRole('button', { name: 'Todas' }));

    await waitFor(() =>
      expect(apiMock.listMailDeliveries).toHaveBeenLastCalledWith(undefined),
    );
  });
});
