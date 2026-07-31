import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookEventView } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listWebhookEvents: vi.fn(),
  reprocessWebhookEvent: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { WebhookOpsPanel } = await import('./WebhookOpsPanel');

function evento(over: Partial<WebhookEventView> = {}): WebhookEventView {
  return {
    id: 'ev-1',
    platform: 'kiwify',
    eventType: 'order_approved',
    externalEventId: 'ord_1:order_approved',
    status: 'FAILED',
    error: 'Oferta off-123 sem mapeamento',
    receivedAt: '2026-07-29T12:00:00.000Z',
    processedAt: null,
    licenseId: null,
    ...over,
  };
}

/**
 * O que estes testes protegem: a tela existe para responder *"a venda virou
 * licença?"* e, quando não virou, *"o que eu faço?"*. Cada afirmação errada aqui
 * é uma resposta errada a essa pergunta.
 */
describe('WebhookOpsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.listWebhookEvents.mockResolvedValue([]);
  });

  /** Abrir em "todas" enterraria as falhas no histórico de sucessos. */
  it('abre filtrando por falhas — o único estado que pede ação', async () => {
    render(<WebhookOpsPanel />);

    await waitFor(() => expect(apiMock.listWebhookEvents).toHaveBeenCalled());
    expect(apiMock.listWebhookEvents).toHaveBeenCalledWith('FAILED');
  });

  it('mostra o motivo da falha — é o que diz qual mapeamento cadastrar', async () => {
    apiMock.listWebhookEvents.mockResolvedValue([evento()]);

    render(<WebhookOpsPanel />);

    expect(await screen.findByText('Oferta off-123 sem mapeamento')).toBeInTheDocument();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('conta as falhas no título', async () => {
    apiMock.listWebhookEvents.mockResolvedValue([
      evento({ id: 'a' }),
      evento({ id: 'b' }),
    ]);

    render(<WebhookOpsPanel />);

    expect(await screen.findByText('2 falhas')).toBeInTheDocument();
  });

  /** Estado vazio afirmativo: "nada falhou" é informação, não ausência dela. */
  it('sem falhas, diz que toda venda virou licença', async () => {
    render(<WebhookOpsPanel />);

    expect(
      await screen.findByText(/toda venda que chegou virou licença/i),
    ).toBeInTheDocument();
  });

  /**
   * A idempotência do PR-3 é do recebimento, não do processamento: reprocessar
   * um `PROCESSED` rodaria o job sobre venda já emitida. O servidor recusa com
   * 422, e um botão que sempre falha ensina a ignorar erro.
   */
  it('NÃO oferece reprocessar entrega já processada', async () => {
    apiMock.listWebhookEvents.mockResolvedValue([
      evento({ status: 'PROCESSED', error: null, processedAt: '2026-07-29T12:00:01Z' }),
    ]);

    render(<WebhookOpsPanel />);

    await screen.findByText('Processada');
    expect(screen.queryByRole('button', { name: 'Reprocessar' })).toBeNull();
  });

  it('reprocessa e avisa que o resultado vem depois — não afirma sucesso', async () => {
    apiMock.listWebhookEvents.mockResolvedValue([evento()]);
    apiMock.reprocessWebhookEvent.mockResolvedValue({ enqueued: true });

    render(<WebhookOpsPanel />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reprocessar' }));

    expect(apiMock.reprocessWebhookEvent).toHaveBeenCalledWith('ev-1');
    // "reenfileirada", nunca "reprocessada": o job é assíncrono, e afirmar o
    // resultado aqui seria o fechamento frágil que este produto detecta.
    const msg = toastMock.success.mock.calls[0][0] as string;
    expect(msg).toMatch(/reenfileirada/i);
    expect(msg).not.toMatch(/emitida|sucesso na emissão/i);
  });

});
