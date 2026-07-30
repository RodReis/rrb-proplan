import { UnprocessableEntityException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/presentation/jwt-auth.guard';
import type { LicCatalogService } from '../application/lic-catalog.service';
import type { LicenseAdminService } from '../application/license-admin.service';
import type { LicensePrivacyService } from '../application/license-privacy.service';
import type { LicenseSigningService } from '../application/license-signing.service';
import type { LicensingOpsService } from '../application/licensing-ops.service';
import type { LicensingSummaryService } from '../application/licensing-summary.service';
import type { SourceAdminService } from '../application/source-admin.service';
import { LicensingAdminController } from './licensing-admin.controller';

/**
 * A rota de busca do admin (SPEC-040 §Busca e detalhe).
 *
 * O que se testa aqui é o que **só existe na rota**: a validação do `status` da
 * query e o repasse do termo. A busca em si — quais colunas o `OR` casa — é do
 * service, e tem teste lá.
 */

function pedido(): AuthenticatedRequest {
  return { tenantId: 't-1', userId: 'user-42' } as AuthenticatedRequest;
}

function montar() {
  const licenses = {
    list: jest.fn(async () => []),
  } as unknown as LicenseAdminService;

  const privacy = {
    extend: jest.fn(async () => ({ id: 'lic-1' })),
    anonymize: jest.fn(async () => ({ id: 'lic-1' })),
  } as unknown as LicensePrivacyService;

  const summaries = {
    summary: jest.fn(async () => ({ period: '30' })),
  } as unknown as LicensingSummaryService;

  const controller = new LicensingAdminController(
    licenses,
    {} as LicCatalogService,
    {} as LicenseSigningService,
    {} as LicensingOpsService,
    {} as SourceAdminService,
    privacy,
    summaries,
  );

  return { controller, licenses, privacy, summaries };
}

describe('SPEC-040: busca de licenças no admin', () => {
  it('repassa o termo e o status ao service', async () => {
    const { controller, licenses } = montar();
    await controller.list(pedido(), 'ana@exemplo.com', 'REVOKED');

    expect(licenses.list).toHaveBeenCalledWith('t-1', 'ana@exemplo.com', 'REVOKED');
  });

  it('sem termo nem status, lista tudo do tenant', async () => {
    const { controller, licenses } = montar();
    await controller.list(pedido());

    expect(licenses.list).toHaveBeenCalledWith('t-1', undefined, undefined);
  });

  it('status inválido é RECUSADO, nunca ignorado em silêncio', async () => {
    // Ignorar faria uma lista completa passar por lista filtrada: o operador
    // pediria as revogadas, receberia todas, e concluiria que não há revogada
    // nenhuma — quando só errou o valor. É o mesmo princípio do período fora da
    // lista fechada da SPEC-035 §6.
    const { controller, licenses } = montar();

    await expect(controller.list(pedido(), '', 'CANCELADA')).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(licenses.list).not.toHaveBeenCalled();
  });

  it('aceita os três status que o enum tem, e só eles', async () => {
    // Prende os dois lados: se `LicenseStatus` ganhar um estado no schema e a
    // rota não souber dele, este teste fica desatualizado de forma visível —
    // em vez de a busca por ele responder 422 na cara do operador.
    const { controller } = montar();

    for (const status of ['ACTIVE', 'REVOKED', 'EXPIRED']) {
      await expect(controller.list(pedido(), '', status)).resolves.toEqual([]);
    }
  });
});

describe('SPEC-040: período das métricas', () => {
  it('período fora da lista fechada é RECUSADO, nunca corrigido', () => {
    // Corrigir em silêncio para o padrão faria um erro de front virar contagem
    // plausível de uma janela que ninguém pediu — e ninguém descobriria,
    // porque o número apareceria normal (§6 da SPEC-035).
    //
    // Síncrono de propósito: a rota lança ANTES de devolver a Promise, então
    // `rejects` não pega nada. Este teste falhou exatamente assim quando eu o
    // escrevi com `await expect(...).rejects` — e um `expect` que não observa o
    // que pensa observar passa por qualquer implementação.
    const { controller, summaries } = montar();

    for (const invalido of ['60', '365', 'last_month', 'CURRENT_MONTH']) {
      expect(() => controller.summary(pedido(), invalido)).toThrow(
        UnprocessableEntityException,
      );
    }
    expect(summaries.summary).not.toHaveBeenCalled();
  });

  it('aceita os quatro da lista', async () => {
    const { controller, summaries } = montar();

    for (const valido of ['7', '30', '90', 'current_month']) {
      await controller.summary(pedido(), valido);
      expect(summaries.summary).toHaveBeenLastCalledWith('t-1', valido);
    }
  });

  it('sem período, usa o padrão explícito de 30 dias', async () => {
    // Passar `undefined` adiante deixaria o padrão morar em dois lugares — a
    // rota e o service — e eles divergiriam na primeira mudança.
    const { controller, summaries } = montar();
    await controller.summary(pedido());

    expect(summaries.summary).toHaveBeenCalledWith('t-1', '30');
  });
});

describe('SPEC-040: estender e excluir a pedido', () => {
  it('estender carrega o AUTOR da sessão, não do corpo', async () => {
    // O autor vem do JWT. Aceitá-lo do corpo deixaria a trilha afirmar que
    // fulano estendeu a licença porque foi isso que o cliente HTTP mandou — um
    // carimbo de auditoria que quem é auditado escreve.
    const { controller, privacy } = montar();
    await controller.extend(pedido(), 'lic-1', {
      until: '2026-12-31',
      reason: 'cortesia',
      // @ts-expect-error — o corpo não tem `authorId`; o teste prova que, se
      // alguém o mandar assim mesmo, ele não vira o autor gravado.
      authorId: 'user-falsificado',
    });

    expect(privacy.extend).toHaveBeenCalledWith(
      't-1',
      'lic-1',
      'user-42',
      expect.objectContaining({ reason: 'cortesia' }),
    );
  });

  it('anonimizar carrega o autor da sessão', async () => {
    const { controller, privacy } = montar();
    await controller.anonymize(pedido(), 'lic-1', { reason: 'pedido do titular' });

    expect(privacy.anonymize).toHaveBeenCalledWith('t-1', 'lic-1', 'user-42', {
      reason: 'pedido do titular',
    });
  });

  it('corpo ausente não quebra a rota — a validação é do service', async () => {
    // O service recusa por motivo vazio, com mensagem em português. Um
    // `TypeError` aqui viraria 500 e diria "o ProPlan quebrou" sobre um campo
    // em branco.
    const { controller, privacy } = montar();
    await controller.anonymize(
      pedido(),
      'lic-1',
      undefined as unknown as { reason?: unknown },
    );

    expect(privacy.anonymize).toHaveBeenCalledWith('t-1', 'lic-1', 'user-42', {});
  });
});
