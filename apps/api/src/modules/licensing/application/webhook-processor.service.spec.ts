import { WebhookProcessorService } from './webhook-processor.service';

/**
 * O que o evento significa para a licença (SPEC-038 §Escopo).
 *
 * Os cinco desfechos da fatia, e as decisões do PI que eles carregam:
 * inadimplência **não** revoga (#3), cancelamento **preserva** o ciclo pago
 * (#2), e a renovação **limpa** o atraso — o caminho de volta obrigatório, sem o
 * qual o corte automático vira fila de suporte.
 */
describe('WebhookProcessorService', () => {
  const findUniqueEvento = jest.fn();
  const updateEvento = jest.fn();
  const findFirstLicenca = jest.fn();
  const createLicenca = jest.fn();
  const updateLicenca = jest.fn();
  const findFirstMapeamento = jest.fn();
  const findFirstLicEvent = jest.fn();
  const send = jest.fn();

  const prisma = {
    licWebhookEvent: { findUnique: findUniqueEvento, update: updateEvento },
    license: { findFirst: findFirstLicenca, create: createLicenca, update: updateLicenca },
    licOfferMapping: { findFirst: findFirstMapeamento },
    licEvent: { findFirst: findFirstLicEvent },
  } as never;

  let service: WebhookProcessorService;

  const edicao = {
    id: 'edi_1',
    slug: 'closed',
    name: 'Sem código-fonte',
    billingModel: 'PERPETUAL',
    updatesMonths: 12,
    product: { keyPrefix: 'WR', name: 'War Room' },
  };

  const licencaExistente = {
    id: 'lic_1',
    status: 'ACTIVE',
    customerEmail: 'comprador@exemplo.com',
    customerName: 'Mario',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
    pastDueAt: null,
    edition: edicao,
  };

  /** Grava o payload no registro, como o intake faz. */
  const evento = (payload: Record<string, unknown>) => {
    findUniqueEvento.mockResolvedValue({ id: 'ev1', status: 'PENDING', payload });
    return 'ev1';
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findFirstLicenca.mockResolvedValue(null);
    findFirstLicEvent.mockResolvedValue(null);
    findFirstMapeamento.mockResolvedValue({ edition: edicao });
    createLicenca.mockResolvedValue({ id: 'lic_nova' });
    service = new WebhookProcessorService(prisma, { send } as never);
  });

  const compra = {
    order_id: 'ord_123',
    webhook_event_type: 'order_approved',
    Customer: { email: 'comprador@exemplo.com', full_name: 'Mario Chase' },
    Product: { product_id: 'prod_1' },
  };

  describe('compra aprovada', () => {
    it('emite a licença e enfileira o e-mail com a chave', async () => {
      await service.process(evento(compra), 't1');

      const gravada = createLicenca.mock.calls[0][0].data;
      expect(gravada.saleRef).toBe('ord_123');
      expect(gravada.customerEmail).toBe('comprador@exemplo.com');
      // A chave em claro NÃO é persistida — só o hash (SPEC-036).
      expect(gravada.keyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(gravada).not.toHaveProperty('key');

      // O e-mail vai pela FILA, nunca em linha: um Resend fora do ar não pode
      // desfazer a emissão de uma licença paga.
      const email = send.mock.calls[0][0];
      expect(email.template).toBe('license_key');
      expect(email.data.licenseKey).toMatch(/^WR-/);
      expect(email.licenseId).toBe('lic_nova');
    });

    it('carimba o evento como PROCESSED com a licença', async () => {
      await service.process(evento(compra), 't1');

      const carimbo = updateEvento.mock.calls[0][0].data;
      expect(carimbo.status).toBe('PROCESSED');
      expect(carimbo.licenseId).toBe('lic_nova');
      expect(carimbo.processedAt).toBeInstanceOf(Date);
      expect(carimbo.error).toBeNull();
    });

    it('grava o `subscriptionId` na trilha — é por ele que a renovação acha', async () => {
      // A cobrança de agosto traz `order_id` NOVO, que não casa com nenhum
      // `saleRef`. Sem este vínculo, toda renovação falharia e o acesso morreria
      // com a assinatura em dia.
      await service.process(evento({ ...compra, subscription_id: 'sub_1' }), 't1');

      const trilha = createLicenca.mock.calls[0][0].data.events.create;
      expect(trilha.type).toBe('webhook_issued');
      expect(trilha.payload.subscriptionId).toBe('sub_1');
      // A chave nunca entra no payload — seria persisti-la por outro nome.
      expect(JSON.stringify(trilha.payload)).not.toMatch(/WR-/);
    });

    it('venda já com licença não emite a segunda', async () => {
      // Reentrega que passou pela idempotência do recebimento para aqui. Achar
      // antes evita transformar reentrega em erro na lista do admin.
      findFirstLicenca.mockResolvedValue({ id: 'lic_ja' });

      await service.process(evento(compra), 't1');

      expect(createLicenca).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(updateEvento.mock.calls[0][0].data.status).toBe('PROCESSED');
    });

    it('SUBSCRIPTION vence no fim do ciclo; PERPETUAL nunca vence', async () => {
      findFirstMapeamento.mockResolvedValue({
        edition: { ...edicao, billingModel: 'SUBSCRIPTION' },
      });

      await service.process(
        evento({ ...compra, Subscription: { next_payment: '2026-09-01T00:00:00Z' } }),
        't1',
      );
      expect(createLicenca.mock.calls[0][0].data.expiresAt?.toISOString()).toBe(
        '2026-09-01T00:00:00.000Z',
      );

      jest.clearAllMocks();
      findFirstMapeamento.mockResolvedValue({ edition: edicao });
      createLicenca.mockResolvedValue({ id: 'lic_nova' });
      await service.process(
        evento({ ...compra, Subscription: { next_payment: '2026-09-01T00:00:00Z' } }),
        't1',
      );
      expect(createLicenca.mock.calls[0][0].data.expiresAt).toBeNull();
    });

    it('edição `source` agenda o convite para o 8º dia', async () => {
      // A data nasce aqui; o convite é da SPEC-039.
      findFirstMapeamento.mockResolvedValue({ edition: { ...edicao, slug: 'source' } });

      await service.process(evento(compra), 't1');

      const { issuedAt, sourceInviteAt } = createLicenca.mock.calls[0][0].data;
      const dias = (sourceInviteAt.getTime() - issuedAt.getTime()) / 86_400_000;
      expect(dias).toBe(8);
    });

    it('edição comum não agenda convite', async () => {
      await service.process(evento(compra), 't1');
      expect(createLicenca.mock.calls[0][0].data.sourceInviteAt).toBeNull();
    });
  });

  describe('oferta sem mapeamento', () => {
    it('vira FAILED com o identificador da oferta, e NÃO emite', async () => {
      // Adivinhar a edição pelo nome do produto emitiria a licença errada em
      // silêncio — e licença errada entregue por e-mail não se recolhe.
      findFirstMapeamento.mockResolvedValue(null);

      await service.process(evento(compra), 't1');

      expect(createLicenca).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();

      const carimbo = updateEvento.mock.calls[0][0].data;
      expect(carimbo.status).toBe('FAILED');
      // O identificador na mensagem é o que o admin precisa para cadastrar o
      // mapeamento e reprocessar.
      expect(carimbo.error).toContain('prod_1');
    });

    it('não relança — o retry não conserta falta de mapeamento', async () => {
      // Retentar 3 vezes o mesmo evento sem mapeamento só adiaria o mesmo
      // desfecho; o admin já tem o item na lista, com o motivo.
      findFirstMapeamento.mockResolvedValue(null);
      await expect(service.process(evento(compra), 't1')).resolves.toBeUndefined();
    });

    it('compra sem e-mail do comprador falha com motivo', async () => {
      const semEmail = { ...compra, Customer: {} };
      await service.process(evento(semEmail), 't1');

      expect(createLicenca).not.toHaveBeenCalled();
      expect(updateEvento.mock.calls[0][0].data.error).toMatch(/e-mail/i);
    });
  });

  describe('reembolso e chargeback', () => {
    beforeEach(() => findFirstLicenca.mockResolvedValue(licencaExistente));

    it.each([
      ['order_refunded', 'reembolso'],
      ['chargeback', 'chargeback'],
    ])('%s revoga com o motivo "%s" e avisa o comprador', async (tipo, motivo) => {
      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: tipo }),
        't1',
      );

      const gravado = updateLicenca.mock.calls[0][0].data;
      expect(gravado.status).toBe('REVOKED');
      expect(gravado.revokedReason).toBe(motivo);
      expect(gravado.revokedAt).toBeInstanceOf(Date);

      expect(send.mock.calls[0][0].template).toBe('license_revoked');
      expect(send.mock.calls[0][0].data.reason).toBe(motivo);
    });

    it('limpa o agendamento do convite ao repo', async () => {
      // Sem isto, quem pediu o dinheiro de volta ganharia acesso ao código uma
      // semana depois.
      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'order_refunded' }),
        't1',
      );
      expect(updateLicenca.mock.calls[0][0].data.sourceInviteAt).toBeNull();
    });

    it('revogar de novo não reescreve a data nem manda 2º e-mail', async () => {
      // A 1ª revogação é o fato; a 2ª é reentrega.
      findFirstLicenca.mockResolvedValue({ ...licencaExistente, status: 'REVOKED' });

      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'chargeback' }),
        't1',
      );

      expect(updateLicenca).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('ciclo da assinatura', () => {
    beforeEach(() => findFirstLicenca.mockResolvedValue(licencaExistente));

    it('renovação estende `expiresAt` E limpa `pastDueAt`', async () => {
      // O caminho de volta obrigatório (decisão PI #3): sem ele o cliente que
      // pagou fica travado até alguém mexer no admin.
      await service.process(
        evento({
          order_id: 'ord_ago',
          webhook_event_type: 'subscription_renewed',
          Subscription: { next_payment: '2026-10-01T00:00:00Z' },
        }),
        't1',
      );

      const gravado = updateLicenca.mock.calls[0][0].data;
      expect(gravado.expiresAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(gravado.pastDueAt).toBeNull();
    });

    it('renovação usa a data do EVENTO, não soma um mês', async () => {
      // Somar faria cada reentrega presentear o cliente com outro mês.
      await service.process(
        evento({
          order_id: 'ord_ago',
          webhook_event_type: 'subscription_renewed',
          Subscription: { next_payment: '2026-10-01T00:00:00Z' },
        }),
        't1',
      );
      expect(updateLicenca.mock.calls[0][0].data.expiresAt?.toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      );
    });

    it('renovação NÃO ressuscita licença revogada', async () => {
      // Reembolso e chargeback são decisões de dinheiro; uma renovação posterior
      // não desfaz um estorno.
      findFirstLicenca.mockResolvedValue({ ...licencaExistente, status: 'REVOKED' });

      await service.process(
        evento({ order_id: 'ord_1', webhook_event_type: 'subscription_renewed' }),
        't1',
      );

      expect(updateLicenca.mock.calls[0][0].data).not.toHaveProperty('status');
    });

    it('atraso marca `pastDueAt` e MANTÉM o acesso', async () => {
      // Decisão PI #3: cartão recusado é rotina e a plataforma retenta.
      // Derrubar no primeiro atraso pune o cliente por algo que se resolve só.
      await service.process(
        evento({ order_id: 'ord_1', webhook_event_type: 'subscription_late' }),
        't1',
      );

      const gravado = updateLicenca.mock.calls[0][0].data;
      expect(gravado.pastDueAt).toBeInstanceOf(Date);
      expect(gravado).not.toHaveProperty('status');
    });

    it('atraso repetido não reinicia o relógio da tolerância', async () => {
      // Reiniciar a cada retry da plataforma faria a tolerância nunca vencer.
      findFirstLicenca.mockResolvedValue({
        ...licencaExistente,
        pastDueAt: new Date('2026-07-01T00:00:00Z'),
      });

      await service.process(
        evento({ order_id: 'ord_1', webhook_event_type: 'subscription_late' }),
        't1',
      );

      expect(updateLicenca).not.toHaveBeenCalled();
    });

    it('cancelamento PRESERVA `expiresAt`', async () => {
      // Decisão PI #2: quem cancelou pagou o ciclo corrente. Corte imediato é
      // só para reembolso e chargeback, onde o dinheiro voltou.
      await service.process(
        evento({ order_id: 'ord_1', webhook_event_type: 'subscription_canceled' }),
        't1',
      );

      const gravado = updateLicenca.mock.calls[0][0].data;
      expect(gravado).not.toHaveProperty('expiresAt');
      expect(gravado).not.toHaveProperty('status');
      expect(gravado.events.create.type).toBe('webhook_canceled');
    });

    it('acha a licença pelo `subscriptionId` quando o `order_id` é novo', async () => {
      // O caso real da renovação: `saleRef` não casa (é outra cobrança), e o
      // resgate vem da trilha do `webhook_issued`.
      findFirstLicenca.mockImplementation(({ where }: { where: { saleRef?: string } }) =>
        where.saleRef ? null : licencaExistente,
      );
      findFirstLicEvent.mockResolvedValue({ licenseId: 'lic_1' });

      await service.process(
        evento({
          order_id: 'ord_novo',
          subscription_id: 'sub_1',
          webhook_event_type: 'subscription_renewed',
        }),
        't1',
      );

      expect(updateLicenca).toHaveBeenCalled();
      expect(updateEvento.mock.calls[0][0].data.status).toBe('PROCESSED');
    });

    it('licença não encontrada vira FAILED com o que foi procurado', async () => {
      // É o que o admin lê para entender que o evento chegou antes da compra
      // (ordem invertida) ou que a venda veio de fora do mapeamento.
      findFirstLicenca.mockResolvedValue(null);

      await service.process(
        evento({ order_id: 'ord_x', webhook_event_type: 'chargeback' }),
        't1',
      );

      const carimbo = updateEvento.mock.calls[0][0].data;
      expect(carimbo.status).toBe('FAILED');
      expect(carimbo.error).toContain('ord_x');
    });
  });

  describe('tipos que não nos dizem respeito', () => {
    it('desconhecido vira IGNORED, não FAILED', async () => {
      // A plataforma acrescenta tipos sem avisar; tratar como falha encheria a
      // lista de pendências de coisas sem conserto.
      await service.process(
        evento({ order_id: 'x', webhook_event_type: 'pix_created' }),
        't1',
      );

      const carimbo = updateEvento.mock.calls[0][0].data;
      expect(carimbo.status).toBe('IGNORED');
      expect(carimbo.processedAt).toBeInstanceOf(Date);
      expect(carimbo.licenseId).toBeNull();
    });
  });

  describe('idempotência do processamento', () => {
    it('evento já PROCESSED não é reprocessado', async () => {
      // O BullMQ pode reentregar um job cujo worker morreu depois do commit.
      findUniqueEvento.mockResolvedValue({ id: 'ev1', status: 'PROCESSED', payload: compra });

      await service.process('ev1', 't1');

      expect(createLicenca).not.toHaveBeenCalled();
      expect(updateEvento).not.toHaveBeenCalled();
    });

    it('evento inexistente não quebra', async () => {
      findUniqueEvento.mockResolvedValue(null);
      await expect(service.process('sumiu', 't1')).resolves.toBeUndefined();
    });

    it('evento FAILED é reprocessável — é o botão do admin', async () => {
      // Cadastrar o mapeamento e reprocessar emite a licença, sem precisar que
      // a plataforma reenvie.
      findUniqueEvento.mockResolvedValue({ id: 'ev1', status: 'FAILED', payload: compra });

      await service.process('ev1', 't1');

      expect(createLicenca).toHaveBeenCalled();
      expect(updateEvento.mock.calls[0][0].data.status).toBe('PROCESSED');
    });
  });
});
