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
  /** O link de coleta do username (SPEC-039) — só a compra source o dispara. */
  const createAndSend = jest.fn();
  /** A remoção do acesso ao repo (SPEC-039 PR-4) — reembolso e chargeback. */
  const revoke = jest.fn();

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
    // A coluna que decide o agendamento do convite (SPEC-039). Era o slug até o
    // PR-1 daquela fatia.
    grantsSourceAccess: false,
    product: {
      keyPrefix: 'WR',
      name: 'War Room',
      // SPEC-042: o padrão do fixture é NÃO configurado — é o estado de todo
      // produto antes de alguém preencher a tela, e o que o e-mail antigo já
      // esperava.
      downloadUrl: null,
      manualUrl: null,
    },
  };

  /** A edição que concede código-fonte — nome diferente de `source` de propósito. */
  const edicaoSource = {
    ...edicao,
    id: 'edi_src',
    // **Slug que NÃO é `source`.** É o que prova que a decisão vem da coluna: com
    // o hardcode antigo (`slug === 'source'`) esta edição não agendaria convite
    // nenhum, e o comprador da edição mais cara nunca receberia o código.
    slug: 'completa',
    name: 'Completa com código-fonte',
    grantsSourceAccess: true,
  };

  const licencaExistente = {
    id: 'lic_1',
    status: 'ACTIVE',
    customerEmail: 'comprador@exemplo.com',
    customerName: 'Mario',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
    pastDueAt: null,
    sourceAccess: 'NONE',
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
    createAndSend.mockResolvedValue({ token: 'tok' });
    revoke.mockResolvedValue('nothing_to_do');
    service = new WebhookProcessorService(
      prisma,
      { send } as never,
      { createAndSend } as never,
      { revoke } as never,
    );
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

    it('passa as URLs do produto ao e-mail (SPEC-042)', async () => {
      const DOWNLOAD = 'https://github.com/RodReis/war-room-releases/releases/latest';
      const MANUAL = 'https://war-room.rrbtrading.com.br/manual';
      findFirstMapeamento.mockResolvedValue({
        edition: {
          ...edicao,
          product: { ...edicao.product, downloadUrl: DOWNLOAD, manualUrl: MANUAL },
        },
      });

      await service.process(evento(compra), 't1');

      // Sem estes dois campos o template renderiza a variante sem passos — e o
      // e-mail sairia igual ao antigo com as URLs cadastradas e ignoradas, que é
      // uma falha muda: ninguém vê, exceto quem comprou.
      const { data } = send.mock.calls[0][0];
      expect(data.downloadUrl).toBe(DOWNLOAD);
      expect(data.manualUrl).toBe(MANUAL);
    });

    it('produto sem URLs manda `null`, não `undefined`', async () => {
      await service.process(evento(compra), 't1');

      // `undefined` some no `JSON.stringify` do job no Redis. O template trata os
      // dois igual hoje, mas o dado que chega ao worker precisa dizer
      // explicitamente "não configurado" em vez de não dizer nada.
      const { data } = send.mock.calls[0][0];
      expect(data.downloadUrl).toBeNull();
      expect(data.manualUrl).toBeNull();
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

    it('edição que concede source agenda o convite para o 8º dia', async () => {
      findFirstMapeamento.mockResolvedValue({ edition: edicaoSource });

      await service.process(evento(compra), 't1');

      const { issuedAt, sourceInviteAt } = createLicenca.mock.calls[0][0].data;
      // 8 dias = prazo legal de arrependimento (CDC art. 49, decisão #5 do MVP4).
      const dias = (sourceInviteAt.getTime() - issuedAt.getTime()) / 86_400_000;
      expect(dias).toBe(8);
    });

    it('decide pela COLUNA, não pelo slug `source`', async () => {
      // `edicaoSource.slug` é `completa`, não `source`. Com o hardcode antigo
      // (`slug === 'source'`) este caso não agendaria convite nenhum: a licença
      // sairia normal, o comprador da edição mais cara nunca receberia o código,
      // e nada apareceria em log. É o bug que a coluna fecha.
      findFirstMapeamento.mockResolvedValue({ edition: edicaoSource });

      await service.process(evento(compra), 't1');

      expect(edicaoSource.slug).not.toBe('source');
      expect(createLicenca.mock.calls[0][0].data.sourceInviteAt).not.toBeNull();
      expect(createLicenca.mock.calls[0][0].data.sourceAccess).toBe('PENDING');
    });

    it('nasce `PENDING` para entrar na lista de pendências do admin', async () => {
      findFirstMapeamento.mockResolvedValue({ edition: edicaoSource });

      await service.process(evento(compra), 't1');

      // `PENDING` já na compra, antes de o comprador informar o username: é o que
      // faz a licença sem username APARECER para o operador, em vez de
      // simplesmente não existir para ninguém.
      expect(createLicenca.mock.calls[0][0].data.sourceAccess).toBe('PENDING');
    });

    it('manda o link de coleta DEPOIS da chave', async () => {
      findFirstMapeamento.mockResolvedValue({ edition: edicaoSource });

      await service.process(evento(compra), 't1');

      // A ordem importa: o que o comprador pagou é a chave; o convite vem no 8º
      // dia. Invertida, o e-mail mais urgente chegaria depois do menos urgente.
      expect(send).toHaveBeenCalled();
      expect(createAndSend).toHaveBeenCalledWith('t1', 'lic_nova');
      expect(send.mock.invocationCallOrder[0]).toBeLessThan(
        createAndSend.mock.invocationCallOrder[0],
      );
    });

    it('falha no link de coleta NÃO desfaz a emissão', async () => {
      findFirstMapeamento.mockResolvedValue({ edition: edicaoSource });
      createAndSend.mockRejectedValue(new Error('redis fora'));

      // A licença já está gravada e a chave já foi enfileirada. Derrubar a compra
      // aqui trocaria um problema recuperável (reemitir o link pelo admin) por um
      // irrecuperável — a plataforma não reenvia o evento de compra por erro
      // nosso.
      await service.process(evento(compra), 't1');

      expect(createLicenca).toHaveBeenCalled();
      expect(updateEvento).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
      );
    });

    it('edição comum não agenda convite nem manda link', async () => {
      await service.process(evento(compra), 't1');

      expect(createLicenca.mock.calls[0][0].data.sourceInviteAt).toBeNull();
      expect(createLicenca.mock.calls[0][0].data.sourceAccess).toBe('NONE');
      // O e-mail de coleta pedindo username a quem não comprou código-fonte
      // seria confuso e pediria dado pessoal sem finalidade (LGPD).
      expect(createAndSend).not.toHaveBeenCalled();
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

    it('`PENDING` volta a `NONE` — sai da fila do job', async () => {
      findFirstLicenca.mockResolvedValue({
        ...licencaExistente,
        sourceAccess: 'PENDING',
      });

      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'order_refunded' }),
        't1',
      );

      // Sem isto a licença revogada ficaria em `PENDING` para sempre na lista de
      // pendências: um convite que nunca sai (o job exige `ACTIVE`) e que ninguém
      // consegue resolver.
      expect(updateLicenca.mock.calls[0][0].data.sourceAccess).toBe('NONE');
    });

    it.each(['INVITED', 'ACTIVE'])(
      '`%s` NÃO é sobrescrito — o PR-4 precisa saber qual chamada desfaz',
      async (estado) => {
        findFirstLicenca.mockResolvedValue({
          ...licencaExistente,
          sourceAccess: estado,
        });

        await service.process(
          evento({ order_id: 'ord_123', webhook_event_type: 'order_refunded' }),
          't1',
        );

        // **A razão de o enum existir.** `INVITED` cancela a *invitation* pelo
        // `githubInvitationId`; `ACTIVE` remove o colaborador pelo username. Se
        // a revogação apagasse o estado com `NONE`, o PR-4 chamaria a errada —
        // que é no-op silencioso na API do GitHub — e o reembolsado ficaria com o
        // código-fonte. Era exatamente o que o `sourceInvited: Boolean` não
        // distinguia.
        const gravado = updateLicenca.mock.calls[0][0].data;
        expect(gravado.sourceAccess).toBeUndefined();
        // E a revogação em si acontece: o que se preserva é só o estado do acesso.
        expect(gravado.status).toBe('REVOKED');
      },
    );

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

    it('manda remover o acesso ao repo, com o motivo', async () => {
      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'order_refunded' }),
        't1',
      );

      // Quem escolhe a chamada (cancelar invitation vs. remover colaborador) é o
      // `SourceRevokeService`, pelo `sourceAccess` — aqui só se garante que ele é
      // chamado. Sem esta linha, o reembolso cortaria a licença e deixaria o
      // comprador no repositório privado.
      expect(revoke).toHaveBeenCalledWith('t1', 'lic_1', 'reembolso');
    });

    it('a remoção vem DEPOIS da escrita do `REVOKED`', async () => {
      const ordem: string[] = [];
      updateLicenca.mockImplementation(async () => {
        ordem.push('update');
        return {};
      });
      revoke.mockImplementation(async () => {
        ordem.push('revoke');
        return 'collaborator_removed';
      });

      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'order_refunded' }),
        't1',
      );

      // O `REVOKED` no banco é o que corta a validação (`/activate`,
      // `/heartbeat`) — ele não pode depender de o GitHub responder. Invertida, a
      // ordem faria uma API fora do ar impedir a revogação da licença.
      expect(ordem).toEqual(['update', 'revoke']);
    });

    it('reentrega retenta a remoção mesmo com a licença já `REVOKED`', async () => {
      findFirstLicenca.mockResolvedValue({ ...licencaExistente, status: 'REVOKED' });

      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'chargeback' }),
        't1',
      );

      // A 1ª revogação pode ter gravado `REVOKED` e falhado no GitHub (rede, PAT
      // expirado). Sair antes deixaria a reentrega da plataforma — a chance grátis
      // de consertar — passar por cima de um reembolsado que continua colaborador.
      // O service é idempotente: se o acesso já morreu, não fala com o GitHub.
      expect(revoke).toHaveBeenCalledWith('t1', 'lic_1', 'chargeback');
      expect(updateLicenca).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('falha inesperada na remoção NÃO derruba o processamento', async () => {
      revoke.mockRejectedValue(new Error('banco fora'));

      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'order_refunded' }),
        't1',
      );

      // Uma exceção aqui carimbaria o evento como `FAILED`, e o admin, ao
      // reprocessar, repetiria o e-mail de revogação. Pior: um erro do GitHub
      // apareceria como "falha no webhook", mandando investigar a Kiwify por um
      // problema do PAT. A pendência pertence à licença, não ao evento.
      expect(updateEvento.mock.calls[0][0].data.status).toBe('PROCESSED');
    });

    it('licença sem source: a remoção é chamada e resolve sozinha', async () => {
      revoke.mockResolvedValue('nothing_to_do');

      await service.process(
        evento({ order_id: 'ord_123', webhook_event_type: 'order_refunded' }),
        't1',
      );

      // Não há ramo aqui decidindo se chama ou não: o estado do acesso mora na
      // licença, e quem o lê é o service. Duplicar a decisão neste arquivo abriria
      // a chance de os dois discordarem.
      expect(revoke).toHaveBeenCalled();
      expect(updateEvento.mock.calls[0][0].data.status).toBe('PROCESSED');
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
