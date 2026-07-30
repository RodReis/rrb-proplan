import { UnprocessableEntityException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../identity/presentation/jwt-auth.guard';
import type { LicCatalogService } from '../application/lic-catalog.service';
import type { LicenseAdminService } from '../application/license-admin.service';
import type { LicenseSigningService } from '../application/license-signing.service';
import type { LicensingOpsService } from '../application/licensing-ops.service';
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
  return { tenantId: 't-1' } as AuthenticatedRequest;
}

function montar() {
  const licenses = {
    list: jest.fn(async () => []),
  } as unknown as LicenseAdminService;

  const controller = new LicensingAdminController(
    licenses,
    {} as LicCatalogService,
    {} as LicenseSigningService,
    {} as LicensingOpsService,
    {} as SourceAdminService,
  );

  return { controller, licenses };
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
