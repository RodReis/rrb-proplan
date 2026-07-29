import type { Request } from 'express';
import type { LicenseActivationService } from '../application/license-activation.service';
import type { WebhookIntakeService } from '../application/webhook-intake.service';
import { LicensingPublicController } from './licensing-public.controller';

const CHAVE = 'WR-AB23-CD45-EF67-GH89';

function pedido(ip = '10.0.0.1'): Request {
  return { ip, socket: { remoteAddress: ip } } as unknown as Request;
}

function montar() {
  const activation = {
    activate: jest.fn(async () => ({
      payload: { licenseId: 'lic-1' },
      signature: 'sig',
    })),
  } as unknown as LicenseActivationService;

  const webhook = {
    receive: jest.fn(async () => ({ received: true as const })),
  } as unknown as WebhookIntakeService;

  return {
    controller: new LicensingPublicController(activation, webhook),
    activation,
    webhook,
  };
}

describe('SPEC-036: rota pública /licensing/v1/activate', () => {
  it('encaminha ao service e devolve o license file', async () => {
    const { controller, activation } = montar();
    const file = await controller.activate(
      { key: CHAVE, fingerprint: 'fp-1' },
      pedido(),
    );

    expect(activation.activate).toHaveBeenCalledWith({
      key: CHAVE,
      fingerprint: 'fp-1',
    });
    expect(file).toMatchObject({ signature: 'sig' });
  });

  it('barra a 11ª tentativa do mesmo IP com 429', async () => {
    // Ativação legítima é rara — acontece uma vez por máquina. O que este
    // limite estreita é a varredura de chaves a partir de um IP.
    const { controller } = montar();
    const req = pedido('10.0.0.9');

    // Chaves diferentes: o limite exercido aqui é o de IP, não o de chave.
    for (let i = 0; i < 10; i += 1) {
      await controller.activate({ key: `WR-AB23-CD45-EF67-GH${i}9`, fingerprint: 'f' }, req);
    }

    await expect(
      controller.activate({ key: 'WR-ZZ23-CD45-EF67-GH89', fingerprint: 'f' }, req),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('barra a 6ª tentativa da mesma CHAVE, mesmo de IPs diferentes', async () => {
    // Só limitar por IP deixaria a chave vazada livre para ser ativada de mil
    // endereços. Uma chave legítima é ativada em 2 máquinas (o `maxMachines`
    // do piloto).
    const { controller } = montar();

    for (let i = 0; i < 5; i += 1) {
      await controller.activate({ key: CHAVE, fingerprint: 'f' }, pedido(`10.0.1.${i}`));
    }

    await expect(
      controller.activate({ key: CHAVE, fingerprint: 'f' }, pedido('10.0.1.99')),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('IPs diferentes com chaves diferentes não se atrapalham', async () => {
    // As duas janelas são independentes: um comprador não pode ser barrado
    // pelo tráfego de outro.
    const { controller } = montar();

    for (let i = 0; i < 8; i += 1) {
      await controller.activate(
        { key: `WR-AB23-CD45-EF67-GH${i}9`, fingerprint: 'f' },
        pedido(`10.0.2.${i}`),
      );
    }

    await expect(
      controller.activate({ key: 'WR-QQ23-CD45-EF67-GH89', fingerprint: 'f' }, pedido('10.0.2.50')),
    ).resolves.toBeDefined();
  });

  it('requisição sem chave ainda consome o limite de IP', async () => {
    // Senão, mandar `{}` mil vezes seria um caminho livre para sondar o
    // servidor sem gastar cota nenhuma.
    const { controller } = montar();
    const req = pedido('10.0.3.1');

    for (let i = 0; i < 10; i += 1) {
      await controller.activate({ fingerprint: 'f' }, req);
    }

    await expect(controller.activate({ fingerprint: 'f' }, req)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('a chave entra no limitador HASHEADA', async () => {
    // O mapa do limitador vive em memória e aparece em heap dump — guardar a
    // chave em claro ali desfaria, num despejo de memória, a decisão de nunca
    // persistí-la.
    const { controller } = montar();
    await controller.activate({ key: CHAVE, fingerprint: 'f' }, pedido('10.0.4.1'));

    const interno = controller as unknown as {
      keyLimiter: { hits: Map<string, number[]> };
    };
    const chaves = [...interno.keyLimiter.hits.keys()].join('|');
    expect(chaves).not.toContain('AB23');
    expect(chaves).toMatch(/^key:[0-9a-f]{64}$/);
  });

  it('normaliza a chave antes de limitar — caixa diferente é a mesma cota', async () => {
    // Senão, alternar entre maiúscula e minúscula dobraria a cota da mesma
    // chave sem esforço nenhum.
    const { controller } = montar();

    for (let i = 0; i < 5; i += 1) {
      const variante = i % 2 === 0 ? CHAVE : CHAVE.toLowerCase();
      await controller.activate({ key: variante, fingerprint: 'f' }, pedido(`10.0.5.${i}`));
    }

    await expect(
      controller.activate({ key: CHAVE, fingerprint: 'f' }, pedido('10.0.5.99')),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('IP ausente não derruba a rota', async () => {
    // Proxy mal configurado, socket sem endereço: cair aqui negaria ativação a
    // quem pagou por um detalhe de infraestrutura.
    const { controller } = montar();
    const semIp = { socket: {} } as unknown as Request;

    await expect(
      controller.activate({ key: CHAVE, fingerprint: 'f' }, semIp),
    ).resolves.toBeDefined();
  });
});

describe('SPEC-038: rota pública do webhook da Kiwify', () => {
  const corpo = { order_id: 'ord_1', webhook_event_type: 'order_approved' };

  /** Request como o Express o entrega, com `rawBody` ligado no `main.ts`. */
  const requisicao = (rawBody?: Buffer) =>
    ({
      ip: '10.0.0.1',
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'content-type': 'application/json' },
      rawBody,
    }) as unknown as Request & { rawBody?: Buffer };

  it('passa o `rawBody`, o payload e a assinatura da query ao service', async () => {
    const { controller, webhook } = montar();
    const cru = Buffer.from(JSON.stringify(corpo));

    await controller.kiwifyWebhook('rodreis', corpo, 'abc123', requisicao(cru));

    expect(webhook.receive).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantSlug: 'rodreis',
        rawBody: cru,
        payload: corpo,
        querySignature: 'abc123',
      }),
    );
  });

  it('reconstrói o corpo quando `rawBody` não vem', async () => {
    // O fallback existe para teste que monta o request à mão. Em produção o
    // `main.ts` liga `rawBody: true` — e a Kiwify assina o re-stringify de todo
    // modo, então este caminho continua verificável.
    const { controller, webhook } = montar();

    await controller.kiwifyWebhook('rodreis', corpo, 'abc', requisicao(undefined));

    const passado = (webhook.receive as jest.Mock).mock.calls[0][0];
    expect(passado.rawBody.toString()).toBe(JSON.stringify(corpo));
  });

  it('não consome o rate limit das rotas de ativação', async () => {
    // Recusar entrega legítima da plataforma por excesso de vendas numa
    // promoção seria transformar sucesso comercial em licença não emitida. A
    // assinatura já é a barreira: quem não a tem não passa.
    const { controller } = montar();

    for (let i = 0; i < 30; i++) {
      await controller.kiwifyWebhook('rodreis', corpo, 'abc', requisicao());
    }

    await expect(
      controller.activate({ key: CHAVE, fingerprint: 'f' }, pedido('10.0.9.1')),
    ).resolves.toBeDefined();
  });
});
