import { NotFoundException } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * `MailService` (SPEC-038): grava a entrega e enfileira — nunca envia.
 *
 * O que estes testes protegem é a garantia da fatia: **falha de envio nunca
 * desfaz o que já foi gravado**. Se este service esperasse o provedor, um
 * Resend fora do ar transformaria compra paga em licença não emitida.
 */
describe('MailService', () => {
  const create = jest.fn();
  const update = jest.fn();
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const add = jest.fn();

  const prisma = {
    mailDelivery: { create, update, findFirst, findMany },
  } as never;
  const fila = { add } as never;

  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({ id: 'entrega-1' });
    service = new MailService(prisma, fila);
  });

  const entrada = {
    tenantId: 't1',
    to: 'comprador@exemplo.com',
    template: 'license_key' as const,
    data: {
      customerName: 'Maria',
      licenseKey: 'WR-AB12-CD34-EF56-GH78',
      productName: 'War Room',
      editionName: 'Com código-fonte',
    },
  };

  it('grava a entrega antes de enfileirar', async () => {
    // A ordem é a decisão: com o Redis fora, a linha PENDING fica no banco e
    // aparece como pendência real. Na ordem inversa, um job sem linha seria um
    // envio que ninguém consegue auditar.
    const ordem: string[] = [];
    create.mockImplementation(async () => {
      ordem.push('create');
      return { id: 'entrega-1' };
    });
    add.mockImplementation(async () => {
      ordem.push('add');
    });

    await service.send(entrada);

    expect(ordem).toEqual(['create', 'add']);
  });

  it('não persiste o corpo do e-mail — só o nome do template e o assunto', async () => {
    // A garantia central da SPEC-036 aplicada aqui: guardar o corpo do
    // `license_key` seria guardar a chave em claro por outro nome.
    await service.send(entrada);

    const gravado = create.mock.calls[0][0].data;
    expect(gravado.template).toBe('license_key');
    expect(gravado.subject).toContain('War Room');
    expect(JSON.stringify(gravado)).not.toContain('WR-AB12-CD34-EF56-GH78');
    expect(gravado).not.toHaveProperty('html');
  });

  it('manda os dados do template no job, não no banco', async () => {
    // O corpo é reconstruído no worker a partir daqui. É o que permite ter
    // lista auditável de "o que foi enviado" sem guardar o que foi enviado.
    await service.send(entrada);

    const [, dados] = add.mock.calls[0];
    expect(dados.data.licenseKey).toBe('WR-AB12-CD34-EF56-GH78');
    expect(dados.deliveryId).toBe('entrega-1');
    expect(dados.tenantId).toBe('t1');
  });

  it('enfileira com 5 tentativas e backoff exponencial', async () => {
    // Mais que os 2–3 do resto da casa de propósito: os outros jobs releem uma
    // fonte que continua lá; um e-mail perdido não tem segunda via.
    await service.send(entrada);

    const opcoes = add.mock.calls[0][2];
    expect(opcoes.attempts).toBe(5);
    expect(opcoes.backoff).toEqual({ type: 'exponential', delay: 10_000 });
  });

  it('grava `licenseId` quando ele veio', async () => {
    await service.send({ ...entrada, licenseId: 'lic-1' });
    expect(create.mock.calls[0][0].data.licenseId).toBe('lic-1');
  });

  it('grava `licenseId` nulo quando não veio — o módulo é compartilhado', async () => {
    // O MVP3 vai mandar e-mail sem licença nenhuma por trás.
    await service.send(entrada);
    expect(create.mock.calls[0][0].data.licenseId).toBeNull();
  });

  describe('retry', () => {
    it('volta a entrega para PENDING e limpa o erro', async () => {
      // Sem isto, a entrega reenfileirada continuaria FAILED na lista até o
      // worker pegá-la, e o admin clicaria de novo achando que não pegou.
      findFirst.mockResolvedValue({ id: 'entrega-1', template: 'license_revoked' });

      await service.retry('t1', 'entrega-1', { productName: 'War Room' });

      expect(update.mock.calls[0][0].data).toEqual({ status: 'PENDING', error: null });
      expect(add).toHaveBeenCalled();
    });

    it('recusa entrega de outro tenant como inexistente', async () => {
      // `tenantId` no `findFirst` além do RLS: mesma resposta para "não existe"
      // e "é de outro" — distinguir permitiria enumerar entregas alheias.
      findFirst.mockResolvedValue(null);

      await expect(service.retry('t1', 'alheia', {})).rejects.toThrow(NotFoundException);
      expect(add).not.toHaveBeenCalled();
    });
  });

  describe('find', () => {
    it('busca por id dentro do tenant e devolve a view', async () => {
      // Existe separado do `list` porque aquele trunca em 200: procurar ali a
      // entrega a reenfileirar acharia só as recentes (FIX #254).
      findFirst.mockResolvedValue({
        id: 'entrega-1',
        to: 'comprador@exemplo.com',
        template: 'license_revoked',
        subject: 'assunto',
        status: 'FAILED',
        attempts: 5,
        error: 'timeout',
        providerMessageId: null,
        licenseId: 'lic-1',
        createdAt: new Date('2026-08-04T10:00:00.000Z'),
        sentAt: null,
      });

      const entrega = await service.find('t1', 'entrega-1');

      expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'entrega-1', tenantId: 't1' });
      expect(entrega?.createdAt).toBe('2026-08-04T10:00:00.000Z');
      expect(entrega?.sentAt).toBeNull();
    });

    it('devolve null para entrega de outro tenant', async () => {
      findFirst.mockResolvedValue(null);
      expect(await service.find('t1', 'alheia')).toBeNull();
    });
  });

  describe('list', () => {
    beforeEach(() => findMany.mockResolvedValue([]));

    it('filtra por status quando ele é válido', async () => {
      await service.list('t1', 'FAILED');
      expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', status: 'FAILED' });
    });

    it('ignora status inválido em vez de devolver vazio', async () => {
      // Filtro desconhecido vindo da query string não pode virar "nenhuma
      // entrega": o admin leria isso como "nada foi enviado".
      await service.list('t1', 'SEI-LA');
      expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
    });
  });
});
