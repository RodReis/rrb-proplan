import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicCatalogResponse, WebhookEventView } from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listWebhookEvents: vi.fn(),
  createOfferMapping: vi.fn(),
  reprocessWebhookEvent: vi.fn(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, ...apiMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const { WebhookOpsPanel } = await import('./WebhookOpsPanel');

const CATALOGO: LicCatalogResponse = {
  signingConfigured: true,
  products: [
    {
      id: 'prod-1',
      slug: 'warroom',
      name: 'War Room',
      keyPrefix: 'WR',
      sourceRepo: null,
      downloadUrl: null,
      manualUrl: null,
      editions: [
        {
          id: 'ed-1',
          slug: 'closed',
          name: 'Sem código-fonte',
          billingModel: 'PERPETUAL',
          maxMachines: 2,
          updatesMonths: 12,
          grantsSourceAccess: false,
          licenseCount: 3,
        },
      ],
    },
  ],
};

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
    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    await waitFor(() => expect(apiMock.listWebhookEvents).toHaveBeenCalled());
    expect(apiMock.listWebhookEvents).toHaveBeenCalledWith('FAILED');
  });

  it('mostra o motivo da falha — é o que diz qual mapeamento cadastrar', async () => {
    apiMock.listWebhookEvents.mockResolvedValue([evento()]);

    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    expect(await screen.findByText('Oferta off-123 sem mapeamento')).toBeInTheDocument();
    expect(screen.getByText('Falhou')).toBeInTheDocument();
  });

  it('conta as falhas no título', async () => {
    apiMock.listWebhookEvents.mockResolvedValue([
      evento({ id: 'a' }),
      evento({ id: 'b' }),
    ]);

    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    expect(await screen.findByText('2 falhas')).toBeInTheDocument();
  });

  /** Estado vazio afirmativo: "nada falhou" é informação, não ausência dela. */
  it('sem falhas, diz que toda venda virou licença', async () => {
    render(<WebhookOpsPanel catalogo={CATALOGO} />);

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

    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    await screen.findByText('Processada');
    expect(screen.queryByRole('button', { name: 'Reprocessar' })).toBeNull();
  });

  it('reprocessa e avisa que o resultado vem depois — não afirma sucesso', async () => {
    apiMock.listWebhookEvents.mockResolvedValue([evento()]);
    apiMock.reprocessWebhookEvent.mockResolvedValue({ enqueued: true });

    render(<WebhookOpsPanel catalogo={CATALOGO} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reprocessar' }));

    expect(apiMock.reprocessWebhookEvent).toHaveBeenCalledWith('ev-1');
    // "reenfileirada", nunca "reprocessada": o job é assíncrono, e afirmar o
    // resultado aqui seria o fechamento frágil que este produto detecta.
    const msg = toastMock.success.mock.calls[0][0] as string;
    expect(msg).toMatch(/reenfileirada/i);
    expect(msg).not.toMatch(/emitida|sucesso na emissão/i);
  });

});

/**
 * Resolver a oferta sem par **na própria linha que falhou** (FIX do dogfooding,
 * 2026-07-31).
 *
 * O id do produto está no erro; o que faltava era dizer qual edição a venda
 * entrega. Antes, o caminho era ir a outra aba e transcrever um uuid à mão — e
 * é justamente o passo que fazia a venda continuar parada.
 */
describe('mapear a oferta na entrega que falhou', () => {
  beforeEach(() => {
    apiMock.listWebhookEvents.mockResolvedValue([
      evento({
        status: 'FAILED',
        error: 'Oferta sem mapeamento: produto prod-kiwify-1, oferta (nenhuma)',
      }),
    ]);
  });

  it('oferece a edição junto do erro, sem pedir o id', async () => {
    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    expect(
      await screen.findByLabelText(/Edição para o produto prod-kiwify-1/i),
    ).toBeInTheDocument();
  });

  it('mapeia como CURINGA usando o id que veio do erro', async () => {
    apiMock.createOfferMapping.mockResolvedValue({});
    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    await userEvent.selectOptions(
      await screen.findByLabelText(/Edição para o produto prod-kiwify-1/i),
      'ed-1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mapear' }));

    await waitFor(() =>
      expect(apiMock.createOfferMapping).toHaveBeenCalledWith({
        externalProductId: 'prod-kiwify-1',
        // A Kiwify não manda oferta: o par que resolve é o do produto inteiro.
        externalOfferId: null,
        editionId: 'ed-1',
      }),
    );
  });

  it('o toast manda REPROCESSAR — mapear sozinho não emite a licença', async () => {
    apiMock.createOfferMapping.mockResolvedValue({});
    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    await userEvent.selectOptions(
      await screen.findByLabelText(/Edição para o produto prod-kiwify-1/i),
      'ed-1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mapear' }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringMatching(/reprocesse esta entrega/i),
      ),
    );
  });

  it('erro de outra natureza NÃO oferece mapeamento', async () => {
    // Oferecer o seletor aqui sugeriria que o problema é de-para quando não é.
    apiMock.listWebhookEvents.mockResolvedValue([
      evento({ status: 'FAILED', error: 'Licença não encontrada para a assinatura' }),
    ]);
    render(<WebhookOpsPanel catalogo={CATALOGO} />);

    await screen.findByText(/Licença não encontrada/i);
    expect(screen.queryByRole('button', { name: 'Mapear' })).toBeNull();
  });

  it('sem edição cadastrada, manda cadastrar em vez de oferecer seletor vazio', async () => {
    render(<WebhookOpsPanel catalogo={{ signingConfigured: true, products: [] }} />);

    expect(await screen.findByText(/Cadastre uma edição em/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mapear' })).toBeNull();
  });
});
