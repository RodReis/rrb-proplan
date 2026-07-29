import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { WebhookIntakeService } from './webhook-intake.service';

/**
 * O recebimento do webhook (SPEC-038 §Contratos).
 *
 * **Receber ≠ processar**: este service grava e responde `200`; quem entende o
 * evento é o worker. A Kiwify tem 40 s de timeout e reenvia até 5 vezes o que
 * não recebe `2xx` — processar na request transformaria emissão lenta em
 * enxurrada de duplicatas.
 */
describe('WebhookIntakeService', () => {
  const findFirstTenant = jest.fn();
  const findUniqueSettings = jest.fn();
  const createEvento = jest.fn();
  const runInTenantContext = jest.fn();
  const add = jest.fn();

  const prisma = {
    tenant: { findFirst: findFirstTenant },
    licSettings: { findUnique: findUniqueSettings },
    licWebhookEvent: { create: createEvento },
    runInTenantContext,
  } as never;

  let service: WebhookIntakeService;

  const secret = '7ih5upe3rvb';
  const payload = {
    order_id: 'ord_123',
    webhook_event_type: 'order_approved',
    Customer: { email: 'comprador@exemplo.com' },
    Product: { product_id: 'prod_1' },
  };

  /** Como a Kiwify assina: SHA1 do re-stringify, na query. */
  const assinatura = (corpo: unknown = payload, chave = secret) =>
    createHmac('sha1', chave).update(JSON.stringify(corpo)).digest('hex');

  const entrada = (over: Record<string, unknown> = {}) => ({
    tenantSlug: 'rodreis',
    rawBody: Buffer.from(JSON.stringify(payload)),
    payload,
    querySignature: assinatura(),
    headers: {},
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    runInTenantContext.mockImplementation((_t: string[], fn: () => unknown) => fn());
    findFirstTenant.mockResolvedValue({ id: 't1' });
    findUniqueSettings.mockResolvedValue({ webhookSecret: secret });
    createEvento.mockResolvedValue({ id: 'ev1' });
    service = new WebhookIntakeService(prisma, { add } as never);
  });

  it('grava o evento bruto e enfileira o processamento', async () => {
    await expect(service.receive(entrada())).resolves.toEqual({ received: true });

    const gravado = createEvento.mock.calls[0][0].data;
    expect(gravado.tenantId).toBe('t1');
    expect(gravado.platform).toBe('kiwify');
    expect(gravado.externalEventId).toBe('ord_123');
    expect(gravado.eventType).toBe('order_approved');
    // O payload BRUTO: é o que torna o reprocessamento possível sem pedir
    // reenvio, e o que guarda o preço (que não vira coluna — MVP4 decisão 4).
    expect(gravado.payload).toBe(payload);

    expect(add.mock.calls[0][1]).toEqual({ webhookEventId: 'ev1', tenantId: 't1' });
  });

  it('grava sob o contexto do tenant da URL', async () => {
    // A rota é pública e não tem sessão. Sem o contexto, o RLS fail-closed
    // gravaria ZERO LINHAS sem erro — e a venda desapareceria em silêncio.
    await service.receive(entrada());
    expect(runInTenantContext).toHaveBeenCalledWith(['t1'], expect.any(Function));
  });

  it('resolve o tenant pelo slug da URL, nunca pelo payload', async () => {
    // É o que faz o evento de oferta não mapeada CONTINUAR TENDO DONO — o item
    // que mais precisa aparecer no admin de alguém.
    await service.receive(entrada());
    expect(findFirstTenant.mock.calls[0][0].where).toEqual({ accountLogin: 'rodreis' });
  });

  describe('recusa com 401', () => {
    it('assinatura inválida', async () => {
      await expect(
        service.receive(entrada({ querySignature: 'a'.repeat(40) })),
      ).rejects.toThrow(UnauthorizedException);
      expect(createEvento).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it('assinatura ausente', async () => {
      await expect(
        service.receive(entrada({ querySignature: undefined })),
      ).rejects.toThrow(UnauthorizedException);
      expect(createEvento).not.toHaveBeenCalled();
    });

    it('segredo do tenant A na URL do tenant B', async () => {
      // O critério de aceite da decisão PI #1, na fronteira onde ele importa.
      await expect(
        service.receive(entrada({ querySignature: assinatura(payload, 'token-do-outro') })),
      ).rejects.toThrow(UnauthorizedException);
      expect(createEvento).not.toHaveBeenCalled();
    });

    it('tenant inexistente — mesma resposta de assinatura inválida', async () => {
      // Dois fatos diferentes, uma resposta só: distinguir diria a quem sonda
      // quais slugs existem, e a rota é pública.
      findFirstTenant.mockResolvedValue(null);
      await expect(service.receive(entrada())).rejects.toThrow(UnauthorizedException);
    });

    it('tenant sem configuração de webhook', async () => {
      // Ele não configurou webhook nenhum, então nenhuma entrega para ele é
      // legítima — aceitar sem segredo abriria a emissão a quem descobrir o slug.
      findUniqueSettings.mockResolvedValue(null);
      await expect(service.receive(entrada())).rejects.toThrow(UnauthorizedException);
      expect(createEvento).not.toHaveBeenCalled();
    });

    it('payload sem identificador de venda', async () => {
      // Sem chave de idempotência, a segunda entrega viraria outra licença.
      const semId = { webhook_event_type: 'order_approved' };
      await expect(
        service.receive(
          entrada({
            payload: semId,
            rawBody: Buffer.from(JSON.stringify(semId)),
            querySignature: assinatura(semId),
          }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(createEvento).not.toHaveBeenCalled();
    });
  });

  it('reentrega da plataforma responde 200 sem gravar nem enfileirar', async () => {
    // A Kiwify reenvia até 5 vezes o que não recebe 2xx — reentrega é NORMAL. O
    // unique do banco é a barreira real (um `if` prévio não protegeria duas
    // entregas simultâneas), e P2002 é o sinal dela.
    createEvento.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }),
    );

    await expect(service.receive(entrada())).resolves.toEqual({ received: true });
    expect(add).not.toHaveBeenCalled();
  });

  it('erro de banco que NÃO é duplicidade sobe', async () => {
    // Um `200` aqui faria a plataforma parar de reenviar uma venda que não
    // gravamos — e a licença nunca seria emitida, sem nada na lista de
    // pendências, porque não há linha.
    createEvento.mockRejectedValue(
      Object.assign(new Error('conexão caiu'), { code: 'P1001' }),
    );

    await expect(service.receive(entrada())).rejects.toThrow('conexão caiu');
  });

  it('evento de tipo desconhecido é gravado e responde 200', async () => {
    // `IGNORED` é decidido no processamento; aqui ele entra como qualquer outro.
    // Recusar na porta faria a plataforma reenviar 5 vezes um tipo que nunca
    // vamos tratar.
    const desconhecido = { order_id: 'ord_9', webhook_event_type: 'pix_created' };
    await expect(
      service.receive(
        entrada({
          payload: desconhecido,
          rawBody: Buffer.from(JSON.stringify(desconhecido)),
          querySignature: assinatura(desconhecido),
        }),
      ),
    ).resolves.toEqual({ received: true });
    expect(createEvento).toHaveBeenCalled();
  });
});
