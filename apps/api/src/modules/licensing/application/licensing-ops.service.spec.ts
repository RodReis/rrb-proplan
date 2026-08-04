import { LicensingOpsService } from './licensing-ops.service';
import { PLATFORM_KIWIFY } from '../licensing.constants';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { Queue } from 'bullmq';

/**
 * O que estes testes protegem — os quatro modos de errar que não aparecem em log:
 *
 * 1. **`platform` divergente no cadastro.** O processador (PR-3) busca o
 *    mapeamento filtrando por `'kiwify'`. Gravar `'Kiwify'` produz mapeamento
 *    visível na tela e compra ainda falhando como "oferta não mapeada".
 * 2. **`null` vs ausente na tolerância.** `null` desliga o corte (decisão PI #3);
 *    ausente é "não mexe". Confundir os dois torna impossível desligar o corte
 *    pela tela — que é para o que a tela existe.
 * 3. **Segredo vazando no `GET`.** O valor nunca deve sair.
 * 4. **Segredo vazio gravado.** Toda entrega legítima passaria a falhar com
 *    `401`, indistinguível de ataque.
 */
describe('LicensingOpsService', () => {
  function montar(overrides: Record<string, unknown> = {}) {
    const add = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      licWebhookEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'ev-1', status: 'FAILED' }),
        update: jest.fn().mockResolvedValue({}),
      },
      licSettings: {
        findUnique: jest.fn().mockResolvedValue({
          webhookSecret: 'tok-abc',
          pastDueToleranceDays: 15,
        }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      licOfferMapping: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ id: 'map-1' }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
        delete: jest.fn().mockResolvedValue({}),
      },
      licEdition: { findFirst: jest.fn().mockResolvedValue({ id: 'edi-1' }) },
      ...overrides,
    } as unknown as PrismaService;
    const queue = { add } as unknown as Queue;
    return { prisma, add, service: new LicensingOpsService(prisma, queue) };
  }

  describe('listWebhookEvents', () => {
    it('não devolve o payload bruto na lista', async () => {
      const { service, prisma } = montar();

      await service.listWebhookEvents();

      const select = (prisma.licWebhookEvent.findMany as jest.Mock).mock.calls[0][0].select;
      expect(select.payload).toBeUndefined();
      expect(select.status).toBe(true);
    });

    it('filtra por status quando informado, e não filtra quando ausente', async () => {
      const { service, prisma } = montar();
      const findMany = prisma.licWebhookEvent.findMany as jest.Mock;

      await service.listWebhookEvents('FAILED');
      expect(findMany.mock.calls[0][0].where).toEqual({ status: 'FAILED' });

      await service.listWebhookEvents();
      expect(findMany.mock.calls[1][0].where).toBeUndefined();
    });

    /** Lista de operação não pode virar dump da tabela. */
    it('limita a página a 100 itens, por mais que peçam', async () => {
      const { service, prisma } = montar();

      await service.listWebhookEvents(undefined, 100_000);

      expect((prisma.licWebhookEvent.findMany as jest.Mock).mock.calls[0][0].take).toBe(100);
    });
  });

  describe('reprocess', () => {
    it('volta o evento para PENDING antes de enfileirar', async () => {
      const { service, prisma, add } = montar();

      await service.reprocess('ev-1', 'tenant-1');

      const update = (prisma.licWebhookEvent.update as jest.Mock).mock.calls[0][0];
      // `processedAt: null` é obrigatório (FIX #216): o CHECK
      // `lic_webhook_events_processed_coherent` recusa `PENDING` com data, e sem
      // ele o reprocessar responde `500` — o botão que existe para tirar a venda
      // do beco seria o único que não funciona.
      expect(update.data).toEqual({ status: 'PENDING', error: null, processedAt: null });
      expect(add).toHaveBeenCalledWith('webhook', {
        webhookEventId: 'ev-1',
        tenantId: 'tenant-1',
      });
    });

    /**
     * A idempotência do PR-3 mora no `UNIQUE` do **recebimento**, não do
     * processamento: reprocessar um `PROCESSED` rodaria o job sobre uma venda já
     * emitida.
     */
    it('recusa reprocessar entrega já PROCESSED', async () => {
      const { service, add } = montar({
        licWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'ev-9', status: 'PROCESSED' }),
          update: jest.fn(),
          findMany: jest.fn(),
        },
      });

      await expect(service.reprocess('ev-9', 'tenant-1')).rejects.toMatchObject({
        status: 422,
      });
      expect(add).not.toHaveBeenCalled();
    });

    it('404 em entrega inexistente (ou de outro tenant, que o RLS já esconde)', async () => {
      const { service } = montar({
        licWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
          findMany: jest.fn(),
        },
      });

      await expect(service.reprocess('ev-x', 'tenant-1')).rejects.toMatchObject({
        status: 404,
      });
    });

    /**
     * **Reprocessar não ressuscita** (SPEC-045). O caminho de volta é o
     * *Reabrir*, com carimbo próprio: descartar e reabrir são dois atos
     * deliberados. Deixar o reprocess desfazer o descarte apagaria o segundo.
     */
    it('recusa reprocessar entrega DISCARDED, apontando o Reabrir', async () => {
      const { service, add } = montar({
        licWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'ev-d', status: 'DISCARDED' }),
          update: jest.fn(),
          findMany: jest.fn(),
        },
      });

      await expect(service.reprocess('ev-d', 'tenant-1')).rejects.toMatchObject({
        status: 409,
      });
      expect(add).not.toHaveBeenCalled();
    });
  });

  /**
   * O descarte da SPEC-045 — tirar da lista de pendências **sem apagar a
   * trilha**. O que estes testes protegem:
   *
   * 1. **Descarte sem motivo.** Produz o mesmo item ilegível que a lista já
   *    produzia, só que escondido.
   * 2. **`processedAt` esquecido.** É a armadilha do #216 espelhada: sem o
   *    carimbo, o CHECK do banco recusa e a tela recebe `500`. O mock não tem
   *    CHECK, então o teste olha o `data` do update.
   * 3. **`error` sobrescrito.** Ele responde "por que parou"; o motivo do
   *    descarte responde "por que desistimos". Uma não pode comer a outra.
   */
  describe('discard', () => {
    it('grava o carimbo completo e NÃO toca no `error` original', async () => {
      const { service, prisma } = montar();

      await service.discard('ev-1', 'tenant-1', 'user-7', 'disparo de teste da Kiwify');

      const { data } = (prisma.licWebhookEvent.update as jest.Mock).mock.calls[0][0];
      expect(data.status).toBe('DISCARDED');
      expect(data.discardedBy).toBe('user-7');
      expect(data.discardedReason).toBe('disparo de teste da Kiwify');
      expect(data.discardedAt).toBeInstanceOf(Date);
      // `DISCARDED` é desfecho, não espera — sem esta data o CHECK recusa.
      expect(data.processedAt).toBeInstanceOf(Date);
      // O motivo da falha original sobrevive ao descarte.
      expect(data.error).toBeUndefined();
      // Descartar de novo um reaberto zera o `reopenedAt`.
      expect(data.reopenedAt).toBeNull();
    });

    it.each([
      ['ausente', undefined],
      ['vazio', ''],
      ['só espaços', '   '],
      ['não-texto', 42],
    ])('recusa descarte com motivo %s, sem gravar nada', async (_caso, motivo) => {
      const { service, prisma } = montar();

      await expect(
        service.discard('ev-1', 'tenant-1', 'user-7', motivo),
      ).rejects.toMatchObject({ status: 422 });
      expect(prisma.licWebhookEvent.update).not.toHaveBeenCalled();
    });

    /**
     * A entrega que virou licença é o elo entre a venda e a chave emitida.
     * Escondê-la quebraria a pergunta "de onde veio esta licença" — e ela nem
     * aparece em pendências, então não há problema a resolver.
     */
    it('recusa descartar entrega PROCESSED', async () => {
      const { service, prisma } = montar({
        licWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'ev-p', status: 'PROCESSED' }),
          update: jest.fn(),
          findMany: jest.fn(),
        },
      });

      await expect(
        service.discard('ev-p', 'tenant-1', 'user-7', 'quero limpar a lista'),
      ).rejects.toMatchObject({ status: 409 });
      expect(prisma.licWebhookEvent.update).not.toHaveBeenCalled();
    });

    it('404 em entrega inexistente', async () => {
      const { service } = montar({
        licWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
          findMany: jest.fn(),
        },
      });

      await expect(
        service.discard('ev-x', 'tenant-1', 'user-7', 'motivo'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('reopen', () => {
    it('volta a PENDING, limpa `processedAt`/`error`, e enfileira', async () => {
      const { service, prisma, add } = montar({
        licWebhookEvent: {
          findUnique: jest.fn().mockResolvedValue({ id: 'ev-d', status: 'DISCARDED' }),
          update: jest.fn().mockResolvedValue({}),
          findMany: jest.fn(),
        },
      });

      await service.reopen('ev-d', 'tenant-1');

      const { data } = (prisma.licWebhookEvent.update as jest.Mock).mock.calls[0][0];
      expect(data.status).toBe('PENDING');
      // FIX #216: o carimbo do desfecho anterior não sobrevive à volta.
      expect(data.processedAt).toBeNull();
      expect(data.error).toBeNull();
      expect(data.reopenedAt).toBeInstanceOf(Date);
      // A trilha do descarte PERMANECE — é a prova de que já foi descartada.
      expect(data.discardedAt).toBeUndefined();
      expect(data.discardedReason).toBeUndefined();

      // Quem decide o desfecho é o job, nunca a rota.
      expect(add).toHaveBeenCalledWith('webhook', {
        webhookEventId: 'ev-d',
        tenantId: 'tenant-1',
      });
    });

    it.each(['FAILED', 'PENDING', 'PROCESSED', 'IGNORED'])(
      'recusa reabrir entrega %s — não há o que reabrir',
      async (status) => {
        const { service, prisma, add } = montar({
          licWebhookEvent: {
            findUnique: jest.fn().mockResolvedValue({ id: 'ev-1', status }),
            update: jest.fn(),
            findMany: jest.fn(),
          },
        });

        await expect(service.reopen('ev-1', 'tenant-1')).rejects.toMatchObject({
          status: 409,
        });
        expect(prisma.licWebhookEvent.update).not.toHaveBeenCalled();
        expect(add).not.toHaveBeenCalled();
      },
    );
  });

  /**
   * O agrupamento *Oferta → edição* (SPEC-045, decisão PI #3).
   *
   * É o critério que faz as 6 ofertas do dogfooding sumirem: descartados os
   * eventos, a aba fica vazia e o badge apaga — **sem `DELETE` no banco**. E o
   * filtro é no `where` de propósito: incluir descartadas gastaria linhas do
   * `take` com o que a regra jogaria fora adiante, e uma oferta ativa poderia
   * ficar de fora da página por causa de eventos já resolvidos.
   */
  describe('listSeenOffers', () => {
    it('não conta entregas DISCARDED ao agregar as ofertas vistas', async () => {
      const { service, prisma } = montar();

      await service.listSeenOffers();

      const { where } = (prisma.licWebhookEvent.findMany as jest.Mock).mock.calls[0][0];
      expect(where).toEqual({ status: { not: 'DISCARDED' } });
    });
  });

  describe('settings', () => {
    /** O ponto de segurança da fatia: o valor do segredo nunca sai. */
    it('devolve webhookSecretSet, NUNCA o segredo', async () => {
      const { service } = montar();

      const view = await service.settings('tenant-1');

      expect(view).toEqual({ webhookSecretSet: true, pastDueToleranceDays: 15 });
      expect(JSON.stringify(view)).not.toContain('tok-abc');
    });

    /**
     * Tenant sem linha: `15` descreve o efeito real (é o default do schema).
     * Devolver `null` diria "não corta" sobre um tenant que vai cortar.
     */
    it('sem linha de settings, descreve o default do schema', async () => {
      const { service } = montar({
        licSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      });

      await expect(service.settings('tenant-1')).resolves.toEqual({
        webhookSecretSet: false,
        pastDueToleranceDays: 15,
      });
    });

    it('segredo em branco no banco conta como não configurado', async () => {
      const { service } = montar({
        licSettings: {
          findUnique: jest.fn().mockResolvedValue({
            webhookSecret: '',
            pastDueToleranceDays: null,
          }),
          upsert: jest.fn(),
        },
      });

      await expect(service.settings('t')).resolves.toEqual({
        webhookSecretSet: false,
        pastDueToleranceDays: null,
      });
    });
  });

  describe('updateSettings', () => {
    /**
     * A mitigação sem deploy do risco aceito (decisão PI #3): `null` explícito
     * desliga o corte. Se o service tratasse `null` como ausente, desligar o
     * corte pela tela seria impossível.
     */
    it('grava null na tolerância — é como se DESLIGA o corte', async () => {
      const { service, prisma } = montar();

      await service.updateSettings('tenant-1', { pastDueToleranceDays: null });

      const upsert = (prisma.licSettings.upsert as jest.Mock).mock.calls[0][0];
      expect(upsert.update).toEqual({ pastDueToleranceDays: null });
    });

    it('campo ausente não é tocado', async () => {
      const { service, prisma } = montar();

      await service.updateSettings('tenant-1', { webhookSecret: 'novo-token' });

      const upsert = (prisma.licSettings.upsert as jest.Mock).mock.calls[0][0];
      expect(upsert.update).toEqual({ webhookSecret: 'novo-token' });
      expect('pastDueToleranceDays' in upsert.update).toBe(false);
    });

    /**
     * Segredo vazio faria TODA entrega legítima falhar com `401` — sintoma
     * indistinguível de ataque. Recusar é mais honesto que gravar.
     */
    it('recusa segredo vazio', async () => {
      const { service } = montar();

      await expect(
        service.updateSettings('tenant-1', { webhookSecret: '   ' }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('recusa tolerância negativa, fracionária ou absurda', async () => {
      const { service } = montar();

      for (const valor of [-1, 1.5, 4000, 'quinze']) {
        await expect(
          service.updateSettings('tenant-1', { pastDueToleranceDays: valor }),
        ).rejects.toMatchObject({ status: 422 });
      }
    });

    it('aceita zero — cortar no dia é escolha legítima', async () => {
      const { service, prisma } = montar();

      await service.updateSettings('tenant-1', { pastDueToleranceDays: 0 });

      expect((prisma.licSettings.upsert as jest.Mock).mock.calls[0][0].update).toEqual({
        pastDueToleranceDays: 0,
      });
    });

    it('recusa corpo sem nada a atualizar', async () => {
      const { service } = montar();
      await expect(service.updateSettings('tenant-1', {})).rejects.toMatchObject({
        status: 422,
      });
    });

    /**
     * A tolerância cria a linha sozinha desde o FIX #212.
     *
     * Antes isto lançava `422 "Configure o segredo do webhook antes da
     * tolerância"`, porque o `create` precisava de um `webhookSecret` e gravar
     * `''` deixaria a linha inválida para o webhook. Com a coluna `String?`, a
     * linha nasce sem segredo — e **ausente já significa "não configurou
     * webhook"**, o mesmo `401` no intake de quando não havia linha nenhuma.
     */
    it('cria a linha só com a tolerância, sem tocar no segredo', async () => {
      const upsert = jest.fn();
      const { service } = montar({
        licSettings: { findUnique: jest.fn().mockResolvedValue(null), upsert },
      });

      await service.updateSettings('tenant-1', { pastDueToleranceDays: 30 });

      // O `create` não pode carregar `webhookSecret: ''`: no dia em que o webhook
      // fosse configurado na Kiwify, toda entrega falharia com `401` e ninguém
      // ligaria o sintoma a "mudei a tolerância".
      expect(Object.keys(upsert.mock.calls[0][0].create)).not.toContain('webhookSecret');
      expect(upsert.mock.calls[0][0].create).toMatchObject({
        tenantId: 'tenant-1',
        pastDueToleranceDays: 30,
      });
    });

    /** O que NÃO mudou: string vazia explícita continua recusada. */
    it('string vazia continua recusada mesmo com a coluna opcional', async () => {
      const { service } = montar();

      // Gravar `''` num tenant que JÁ recebe entregas faria todas passarem a
      // falhar, com sintoma indistinguível de ataque. Opcional no schema ≠
      // apagável pela tela.
      await expect(
        service.updateSettings('tenant-1', { webhookSecret: '   ' }),
      ).rejects.toMatchObject({ status: 422 });
    });
  });

  describe('createOfferMapping', () => {
    /**
     * O modo de errar mais caro da fatia: `platform` tem de casar EXATAMENTE
     * com o filtro do processador, senão o mapeamento aparece na tela e a compra
     * continua falhando.
     */
    it('grava a MESMA platform que o processador busca', async () => {
      const { service, prisma } = montar();

      await service.createOfferMapping('tenant-1', {
        externalProductId: 'prod-x',
        editionId: 'edi-1',
      });

      const data = (prisma.licOfferMapping.create as jest.Mock).mock.calls[0][0].data;
      expect(data.platform).toBe(PLATFORM_KIWIFY);
      expect(data.platform).toBe('kiwify');
    });

    /** Oferta ausente é curinga do produto — não string vazia. */
    it('externalOfferId ausente vira null (curinga), nunca string vazia', async () => {
      const { service, prisma } = montar();

      await service.createOfferMapping('tenant-1', {
        externalProductId: 'prod-x',
        editionId: 'edi-1',
      });

      expect(
        (prisma.licOfferMapping.create as jest.Mock).mock.calls[0][0].data.externalOfferId,
      ).toBeNull();
    });

    it('exige externalProductId e editionId', async () => {
      const { service } = montar();

      await expect(
        service.createOfferMapping('t', { externalProductId: 'p' }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        service.createOfferMapping('t', { editionId: 'e' }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('404 quando a edição não é do tenant (RLS já a esconde)', async () => {
      const { service } = montar({
        licEdition: { findFirst: jest.fn().mockResolvedValue(null) },
      });

      await expect(
        service.createOfferMapping('t', { externalProductId: 'p', editionId: 'alheia' }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('deleteOfferMapping', () => {
    it('remove o mapeamento', async () => {
      const { service, prisma } = montar();

      await expect(service.deleteOfferMapping('map-1')).resolves.toEqual({ deleted: true });
      expect(prisma.licOfferMapping.delete).toHaveBeenCalledWith({
        where: { id: 'map-1' },
      });
    });

    it('404 em mapeamento inexistente', async () => {
      const { service } = montar({
        licOfferMapping: {
          findUnique: jest.fn().mockResolvedValue(null),
          delete: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
        },
      });

      await expect(service.deleteOfferMapping('x')).rejects.toMatchObject({ status: 404 });
    });
  });
});
