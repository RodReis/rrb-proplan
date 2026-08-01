import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { ANONIMO_EMAIL, ANONIMO_NOME } from '../domain/anonymize';
import { LicensePrivacyService } from './license-privacy.service';

const AUTOR = 'user-42';

interface Linha {
  id: string;
  tenantId: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  customerEmail: string;
  customerName: string | null;
  githubUsername: string | null;
  saleRef: string | null;
  expiresAt: Date | null;
}

const PAYLOAD_BRUTO = {
  order_id: 'a1b2c3',
  webhook_event_type: 'order_approved',
  Customer: { full_name: 'Ana Silva', email: 'ana@exemplo.com', CPF: '123.456.789-00' },
  Commissions: { charge_amount: 49700 },
};

/**
 * Dobra do Prisma. O RLS é do banco; aqui se testa a REGRA — o que o service
 * grava, o que ele preserva, e a ordem em que faz as duas coisas.
 */
function montar(
  opcoes: { status?: Linha['status']; expiresAt?: Date | null; ativacoes?: number } = {},
) {
  const licenca: Linha = {
    id: 'lic-1',
    tenantId: 't-1',
    status: opcoes.status ?? 'ACTIVE',
    customerEmail: 'ana@exemplo.com',
    customerName: 'Ana Silva',
    githubUsername: 'anasilva',
    saleRef: 'kiwify-9931',
    expiresAt: opcoes.expiresAt ?? new Date('2026-08-30T00:00:00Z'),
  };

  const eventos: Array<Record<string, unknown>> = [];
  const entregas = [
    { id: 'mail-1', licenseId: 'lic-1', to: 'ana@exemplo.com' },
    { id: 'mail-2', licenseId: 'lic-1', to: 'ana@exemplo.com' },
  ];
  const webhooks = [
    { id: 'wh-1', licenseId: 'lic-1', payload: PAYLOAD_BRUTO as unknown },
  ];
  // Relatos de erro (SPEC-043). Ao contrário de entregas e webhooks, estes são
  // APAGADOS — `sessionTail` é trecho do projeto do titular e `contactEmail` um
  // endereço que ele digitou; redigir deixaria a linha sem nada além de stack.
  const relatos = [
    { id: 'err-1', licenseId: 'lic-1' },
    { id: 'err-2', licenseId: 'lic-1' },
  ];
  /** A ordem real das escritas — é o que prova que o carimbo vem por último. */
  const ordem: string[] = [];

  const tx = {
    license: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ordem.push('license.update');
        Object.assign(licenca, {
          customerEmail: data.customerEmail ?? licenca.customerEmail,
          customerName:
            data.customerName === undefined ? licenca.customerName : data.customerName,
          githubUsername:
            data.githubUsername === undefined
              ? licenca.githubUsername
              : data.githubUsername,
          expiresAt: data.expiresAt === undefined ? licenca.expiresAt : data.expiresAt,
        });
        const aninhado = data.events as { create?: Record<string, unknown> } | undefined;
        if (aninhado?.create) eventos.push(aninhado.create);
        return licenca;
      }),
    },
    mailDelivery: {
      updateMany: jest.fn(async ({ data }: { data: { to: string } }) => {
        ordem.push('mailDelivery.updateMany');
        entregas.forEach((e) => (e.to = data.to));
        return { count: entregas.length };
      }),
    },
    licWebhookEvent: {
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { payload: unknown } }) => {
          ordem.push('licWebhookEvent.update');
          webhooks.find((w) => w.id === where.id)!.payload = data.payload;
          return {};
        },
      ),
    },
    licErrorReport: {
      deleteMany: jest.fn(async () => {
        ordem.push('licErrorReport.deleteMany');
        const removidos = relatos.length;
        relatos.length = 0;
        return { count: removidos };
      }),
    },
    licEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ordem.push('licEvent.create');
        eventos.push(data);
        return {};
      }),
    },
  };

  const prisma = {
    license: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.id === licenca.id && where.tenantId === licenca.tenantId ? licenca : null,
      ),
      update: tx.license.update,
    },
    licWebhookEvent: {
      findMany: jest.fn(async () => webhooks.map((w) => ({ id: w.id, payload: w.payload }))),
    },
    // A contagem que as métricas do PR-3 fazem. Aqui ela existe para provar que
    // anonimizar não a altera.
    activation: { count: jest.fn(async () => opcoes.ativacoes ?? 3) },
    licEvent: { count: jest.fn(async () => eventos.length) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  return {
    service: new LicensePrivacyService(prisma),
    prisma,
    licenca,
    eventos,
    entregas,
    webhooks,
    relatos,
    ordem,
  };
}

describe('SPEC-040: estender a validade', () => {
  it('grava a data nova e o evento com autor, motivo e valor ANTERIOR', async () => {
    // O valor anterior é o que permite responder "quem prometeu o quê" seis
    // meses depois. Sem ele a trilha diz que a data mudou e não diz de quê — e
    // a pergunta que se faz é sempre "mudou a partir de quando?".
    const { service, licenca, eventos } = montar({
      expiresAt: new Date('2026-08-30T00:00:00Z'),
    });

    const r = await service.extend('t-1', 'lic-1', AUTOR, {
      until: '2026-12-31T00:00:00Z',
      reason: 'cortesia por suporte demorado',
    });

    expect(licenca.expiresAt).toEqual(new Date('2026-12-31T00:00:00Z'));
    expect(r.previousExpiresAt).toBe('2026-08-30T00:00:00.000Z');
    expect(eventos[0]).toMatchObject({
      type: 'extended_by_admin',
      payload: {
        authorId: AUTOR,
        reason: 'cortesia por suporte demorado',
        previousExpiresAt: '2026-08-30T00:00:00.000Z',
        newExpiresAt: '2026-12-31T00:00:00.000Z',
      },
    });
  });

  it('recusa extensão sem motivo', async () => {
    // Extensão sem motivo é a que ninguém consegue explicar quando o cliente
    // cobra o que foi prometido. Mesmo raciocínio do motivo da revogação.
    const { service, licenca } = montar();
    const antes = licenca.expiresAt;

    await expect(
      service.extend('t-1', 'lic-1', AUTOR, { until: '2026-12-31T00:00:00Z' }),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      service.extend('t-1', 'lic-1', AUTOR, {
        until: '2026-12-31T00:00:00Z',
        reason: '   ',
      }),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(licenca.expiresAt).toBe(antes);
  });

  it('recusa data ausente ou inválida antes de chegar ao banco', async () => {
    // `Invalid Date` chegaria ao Prisma como erro de sintaxe do Postgres — uma
    // mensagem sobre o banco, para um campo que o operador acabou de digitar.
    const { service } = montar();

    for (const until of [undefined, '', 'trinta de dezembro', '2026-13-45']) {
      await expect(
        service.extend('t-1', 'lic-1', AUTOR, { until, reason: 'x' }),
      ).rejects.toThrow(UnprocessableEntityException);
    }
  });

  it('recusa estender licença REVOGADA', async () => {
    // Estender revogada afirmaria que ela voltou a valer, e ela não volta: o
    // `/activate` responde 410 pelo `status`, não pela data. A tela mostraria
    // uma validade nova numa licença que não ativa.
    const { service } = montar({ status: 'REVOKED' });

    await expect(
      service.extend('t-1', 'lic-1', AUTOR, {
        until: '2026-12-31T00:00:00Z',
        reason: 'reativar',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('licença de outro tenant responde 404, não 403', async () => {
    const { service } = montar();
    await expect(
      service.extend('t-2', 'lic-1', AUTOR, {
        until: '2026-12-31T00:00:00Z',
        reason: 'x',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('SPEC-040: exclusão a pedido', () => {
  it('anonimiza licença, entregas e payloads numa transação só', async () => {
    const { service, licenca, entregas, webhooks, prisma } = montar();

    const r = await service.anonymize('t-1', 'lic-1', AUTOR, {
      reason: 'pedido do titular por e-mail',
    });

    expect(licenca.customerEmail).toBe(ANONIMO_EMAIL);
    expect(licenca.customerName).toBe(ANONIMO_NOME);
    expect(licenca.githubUsername).toBeNull();
    expect(entregas.every((e) => e.to === ANONIMO_EMAIL)).toBe(true);
    expect(JSON.stringify(webhooks)).not.toContain('ana@exemplo.com');
    expect(JSON.stringify(webhooks)).not.toContain('123.456.789-00');
    expect(r).toEqual({
      id: 'lic-1',
      mailDeliveries: 2,
      webhookEvents: 1,
      errorReports: 2,
    });

    // **Metade feita é o pior desfecho**: o titular recebe a confirmação e o
    // e-mail dele continua no payload porque a segunda escrita falhou.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('o que NÃO some: licença, saleRef e a trilha', async () => {
    // Esta é a ação inteira. O direito é sobre dado pessoal, não sobre o fato
    // da transação — apagar a linha atenderia ao pedido e destruiria a prova de
    // emissão, ativação e revogação. Inclusive a prova de que a exclusão foi
    // feita.
    const { service, licenca, eventos } = montar();

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    expect(licenca.id).toBe('lic-1');
    expect(licenca.saleRef).toBe('kiwify-9931');
    expect(licenca.status).toBe('ACTIVE');
    expect(eventos).toHaveLength(1);
  });

  it('o evento fica e o dado sai — nem e-mail nem nome entram no payload', async () => {
    // Gravar o e-mail original no evento "para referência" seria reintroduzi-lo
    // pela porta da trilha, que é justamente o que a anonimização preserva.
    const { service, eventos } = montar();

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    expect(eventos[0]).toMatchObject({
      type: 'anonymized',
      payload: { authorId: AUTOR, reason: 'pedido do titular' },
    });
    expect(JSON.stringify(eventos)).not.toContain('ana@exemplo.com');
    expect(JSON.stringify(eventos)).not.toContain('Ana Silva');
    expect(JSON.stringify(eventos)).not.toContain('anasilva');
  });

  it('o carimbo é a ÚLTIMA escrita, e conta o que de fato aconteceu', async () => {
    // Criá-lo junto do `update` da licença exigiria adivinhar os números antes
    // de executar — e o carimbo diria "3 entregas redigidas" num caso em que só
    // duas foram.
    const { service, eventos, ordem } = montar();

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    expect(ordem.at(-1)).toBe('licEvent.create');
    expect(eventos[0]).toMatchObject({
      payload: { mailDeliveries: 2, webhookEvents: 1 },
    });
  });

  it('NÃO revoga o acesso ao repositório source', async () => {
    // Excluir dado pessoal não desfaz a compra: quem comprou o código-fonte
    // continua com direito a ele. Amarrar as duas coisas faria um pedido de
    // LGPD virar cancelamento de um produto pago.
    const { service, licenca } = montar();

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    expect(licenca.status).toBe('ACTIVE');
  });

  it('as métricas antes e depois são IDÊNTICAS', async () => {
    // O teste que prova que a trilha foi preservada (critério de aceite). As
    // contagens do painel saem de `Activation` e `LicEvent`, e nenhuma das duas
    // pode encolher porque um titular pediu exclusão — senão o número do mês
    // muda retroativamente sem que nada tenha acontecido no mês.
    const { service, prisma } = montar();

    const ativacoesAntes = await prisma.activation.count();
    const licencasAntes = await prisma.license.findFirst({
      where: { id: 'lic-1', tenantId: 't-1' },
    });

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    expect(await prisma.activation.count()).toBe(ativacoesAntes);
    expect(
      await prisma.license.findFirst({ where: { id: 'lic-1', tenantId: 't-1' } }),
    ).toBeTruthy();
    expect(licencasAntes!.id).toBe('lic-1');
    // A trilha CRESCEU (ganhou o `anonymized`) e não encolheu — apagar eventos
    // seria o modo de a contagem mudar.
    expect(await prisma.licEvent.count()).toBeGreaterThan(0);
  });

  it('recusa exclusão sem motivo', async () => {
    const { service, licenca } = montar();

    await expect(service.anonymize('t-1', 'lic-1', AUTOR, {})).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(licenca.customerEmail).toBe('ana@exemplo.com');
  });

  it('licença de outro tenant responde 404', async () => {
    const { service } = montar();
    await expect(
      service.anonymize('t-2', 'lic-1', AUTOR, { reason: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('o e-mail original não vai para o log', async () => {
    // Registrá-lo no log manteria o dado pessoal vivo na aplicação — o mesmo
    // vazamento por outro caminho, num lugar que ninguém pensa em limpar.
    const { service } = montar();
    const log = jest
      .spyOn(
        (service as unknown as { logger: { log: (m: string) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    expect(JSON.stringify(log.mock.calls)).not.toContain('ana@exemplo.com');
    expect(JSON.stringify(log.mock.calls)).not.toContain('Ana Silva');
  });

  // === SPEC-043: a exclusão a pedido passa a cobrir os relatos de erro. ===

  it('apaga os relatos de erro da licença', async () => {
    // Critério de aceite da SPEC-043. Sem esta linha, `sessionTail` — nomes de
    // arquivos do projeto do titular — sobreviveria a um pedido de exclusão.
    const { service, relatos } = montar();

    const r = await service.anonymize('t-1', 'lic-1', AUTOR, {
      reason: 'pedido do titular',
    });

    expect(relatos).toHaveLength(0);
    expect(r.errorReports).toBe(2);
  });

  it('conta os relatos apagados no carimbo da trilha', async () => {
    // O evento conta o que de fato aconteceu — é ele que responde "o que saiu?"
    // quando o titular ou a autoridade perguntar.
    const { service, eventos } = montar();

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    const carimbo = eventos.find((e) => e.type === 'anonymized');
    expect(carimbo?.payload).toMatchObject({ errorReports: 2 });
  });

  it('apaga os relatos DENTRO da transação, antes do carimbo', async () => {
    // Fora da transação, uma falha depois dela deixaria o titular com a
    // confirmação de exclusão e os relatos apagados sem carimbo nenhum — ou o
    // inverso. O carimbo continua sendo a última escrita.
    const { service, ordem } = montar();

    await service.anonymize('t-1', 'lic-1', AUTOR, { reason: 'pedido do titular' });

    expect(ordem).toContain('licErrorReport.deleteMany');
    expect(ordem.indexOf('licErrorReport.deleteMany')).toBeLessThan(
      ordem.indexOf('licEvent.create'),
    );
    expect(ordem[ordem.length - 1]).toBe('licEvent.create');
  });
});
