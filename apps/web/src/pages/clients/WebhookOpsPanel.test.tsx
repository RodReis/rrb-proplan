import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LicCatalogResponse,
  OfferMappingView,
  WebhookEventView,
} from '../../lib/api';

const apiMock = vi.hoisted(() => ({
  listWebhookEvents: vi.fn(),
  listOfferMappings: vi.fn(),
  getLicensingSettings: vi.fn(),
  reprocessWebhookEvent: vi.fn(),
  createOfferMapping: vi.fn(),
  deleteOfferMapping: vi.fn(),
  updateLicensingSettings: vi.fn(),
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
      editions: [
        {
          id: 'ed-1',
          slug: 'closed',
          name: 'Sem código-fonte',
          billingModel: 'PERPETUAL',
          maxMachines: 2,
          updatesMonths: 12,
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

const MAPEAMENTO: OfferMappingView = {
  id: 'map-1',
  platform: 'kiwify',
  externalProductId: 'prod-kiwify-1',
  externalOfferId: null,
  editionId: 'ed-1',
  createdAt: '2026-07-29T12:00:00.000Z',
  edition: { id: 'ed-1', slug: 'closed', name: 'Sem código-fonte' },
};

/**
 * O que estes testes protegem: a tela existe para responder *"a venda virou
 * licença?"* e, quando não virou, *"o que eu faço?"*. Cada afirmação errada aqui
 * é uma resposta errada a essa pergunta.
 */
describe('WebhookOpsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.listWebhookEvents.mockResolvedValue([]);
    apiMock.listOfferMappings.mockResolvedValue([]);
    apiMock.getLicensingSettings.mockResolvedValue({
      webhookSecretSet: true,
      pastDueToleranceDays: 15,
    });
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

  describe('mapeamentos', () => {
    it('diz curinga por extenso, não com travessão', async () => {
      apiMock.listOfferMappings.mockResolvedValue([MAPEAMENTO]);

      render(<WebhookOpsPanel catalogo={CATALOGO} />);

      expect(await screen.findByText(/qualquer oferta \(curinga\)/i)).toBeInTheDocument();
    });

    it('cadastra com oferta vazia como null (curinga), nunca string vazia', async () => {
      apiMock.createOfferMapping.mockResolvedValue(MAPEAMENTO);

      render(<WebhookOpsPanel catalogo={CATALOGO} />);

      await userEvent.type(
        await screen.findByLabelText('Id do produto na plataforma'),
        'prod-kiwify-1',
      );
      await userEvent.selectOptions(screen.getByLabelText('Edição'), 'ed-1');
      await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

      expect(apiMock.createOfferMapping).toHaveBeenCalledWith({
        externalProductId: 'prod-kiwify-1',
        externalOfferId: null,
        editionId: 'ed-1',
      });
    });

    it('o botão de cadastrar fica travado sem produto e sem edição', async () => {
      render(<WebhookOpsPanel catalogo={CATALOGO} />);

      expect(await screen.findByRole('button', { name: 'Cadastrar' })).toBeDisabled();
    });
  });

  describe('configuração', () => {
    /** O ponto de segurança: o valor do segredo nunca chega à tela. */
    it('nunca exibe o segredo — só diz que está configurado', async () => {
      render(<WebhookOpsPanel catalogo={CATALOGO} />);

      expect(await screen.findByText(/O valor não é exibido/i)).toBeInTheDocument();
      // O campo é de senha, e está vazio: ele serve para GRAVAR, não para ler.
      const campo = screen.getByLabelText('Segredo do webhook') as HTMLInputElement;
      expect(campo.type).toBe('password');
      expect(campo.value).toBe('');
    });

    it('sem segredo, avisa que toda entrega responde 401', async () => {
      apiMock.getLicensingSettings.mockResolvedValue({
        webhookSecretSet: false,
        pastDueToleranceDays: 15,
      });

      render(<WebhookOpsPanel catalogo={CATALOGO} />);

      expect(await screen.findByText(/responde 401/i)).toBeInTheDocument();
    });

    it('descreve o efeito da tolerância, não o número solto', async () => {
      render(<WebhookOpsPanel catalogo={CATALOGO} />);

      expect(
        await screen.findByText(/Corta 15 dias depois do aviso de atraso/i),
      ).toBeInTheDocument();
    });

    /**
     * A decisão PI #3 na tela: `null` é "nunca corta", não campo vazio. Se
     * aparecesse como `—`, alguém iria "consertar" configurando — e ligaria um
     * corte que o dono desligou de propósito.
     */
    it('com tolerância null, diz que o ProPlan nunca corta', async () => {
      apiMock.getLicensingSettings.mockResolvedValue({
        webhookSecretSet: true,
        pastDueToleranceDays: null,
      });

      render(<WebhookOpsPanel catalogo={CATALOGO} />);

      expect(await screen.findByText(/nunca corta por atraso/i)).toBeInTheDocument();
      // Já desligado: o botão de desligar não se repete.
      expect(
        screen.queryByRole('button', { name: /Desligar o corte/i }),
      ).toBeNull();
    });

    /** A mitigação sem deploy do risco aceito precisa estar alcançável. */
    it('desligar o corte manda null explícito', async () => {
      apiMock.updateLicensingSettings.mockResolvedValue({
        webhookSecretSet: true,
        pastDueToleranceDays: null,
      });

      render(<WebhookOpsPanel catalogo={CATALOGO} />);
      await userEvent.click(
        await screen.findByRole('button', { name: /Desligar o corte/i }),
      );

      expect(apiMock.updateLicensingSettings).toHaveBeenCalledWith({
        pastDueToleranceDays: null,
      });
    });

    it('salvar dias manda só a tolerância, sem tocar o segredo', async () => {
      apiMock.updateLicensingSettings.mockResolvedValue({
        webhookSecretSet: true,
        pastDueToleranceDays: 30,
      });

      render(<WebhookOpsPanel catalogo={CATALOGO} />);
      await userEvent.type(await screen.findByLabelText('Dias de tolerância'), '30');
      await userEvent.click(screen.getByRole('button', { name: 'Salvar dias' }));

      const enviado = apiMock.updateLicensingSettings.mock.calls[0][0];
      expect(enviado).toEqual({ pastDueToleranceDays: 30 });
      expect('webhookSecret' in enviado).toBe(false);
    });

    it('salvar segredo manda só o segredo, sem tocar a tolerância', async () => {
      apiMock.updateLicensingSettings.mockResolvedValue({
        webhookSecretSet: true,
        pastDueToleranceDays: 15,
      });

      render(<WebhookOpsPanel catalogo={CATALOGO} />);
      await userEvent.type(
        await screen.findByLabelText('Segredo do webhook'),
        'tok-da-kiwify',
      );
      await userEvent.click(screen.getByRole('button', { name: 'Salvar segredo' }));

      const enviado = apiMock.updateLicensingSettings.mock.calls[0][0];
      expect(enviado).toEqual({ webhookSecret: 'tok-da-kiwify' });
      expect('pastDueToleranceDays' in enviado).toBe(false);
    });
  });
});
