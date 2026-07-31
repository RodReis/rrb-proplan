import { UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { LicenseActivationService } from './license-activation.service';
import { LicenseReleaseService } from './license-release.service';

/**
 * `releases/check` (SPEC-041 §Contratos).
 *
 * O gate de status (`404`/`409`/`410`) **não é testado aqui**: ele vive no
 * `LicenseActivationService.licencaParaUpdate`, compartilhado com `/activate` e
 * `/heartbeat`, e já tem cobertura lá. O que se prova aqui é que este serviço o
 * **chama** — e o que ele decide depois.
 */

const LICENCA = {
  id: 'lic-1',
  tenant_id: 'tn-1',
  status: 'ACTIVE',
  issued_at: new Date('2026-01-01'),
  expires_at: null,
  past_due_at: null,
  updates_until: new Date('2026-06-30T23:59:59.000Z'),
  max_machines: 2,
  edition_slug: 'source',
  billing_model: 'PERPETUAL',
  product_id: 'prod-1',
};

interface Release {
  version: string;
  releasedAt: Date;
  sha256: string;
  notes: string | null;
}

function montar(releases: Release[] = [], licenca = LICENCA) {
  /** O `where` que a busca recebeu — é como se prova o filtro de `published`. */
  const chamadas: Record<string, unknown> = {};

  const prisma = {
    runInTenantContext: jest.fn((_ids: string[], fn: () => unknown) => fn()),
    licRelease: {
      findMany: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.where = where;
        return releases;
      }),
    },
  } as unknown as PrismaService;

  const activation = {
    licencaParaUpdate: jest.fn(async () => licenca),
  } as unknown as LicenseActivationService;

  return {
    service: new LicenseReleaseService(prisma, activation),
    prisma,
    activation,
    chamadas,
  };
}

const r = (
  version: string,
  releasedAt: string,
  notes: string | null = null,
): Release => ({
  version,
  releasedAt: new Date(releasedAt),
  sha256: 'a'.repeat(64),
  notes,
});

describe('check — entrada', () => {
  it('sem `licenseKey` ou sem `fingerprint`, recusa', async () => {
    const { service } = montar();

    await expect(service.check({ fingerprint: 'fp' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.check({ licenseKey: 'k' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('`fingerprint` longo demais é recusado', async () => {
    const { service } = montar();

    // Campo livre que vem de fora sem sessão — o teto é o mesmo do `/activate`.
    await expect(
      service.check({ licenseKey: 'k', fingerprint: 'x'.repeat(129) }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('passa chave e fingerprint pelo gate compartilhado', async () => {
    const { service, activation } = montar([r('1.0.0', '2026-01-10')]);

    await service.check({ licenseKey: ' k ', fingerprint: ' fp ' });

    // **O gate é o do `/heartbeat`, não uma segunda opinião.** Se este serviço
    // resolvesse a chave sozinho, uma licença revogada receberia update — o
    // reembolsado continuando a ganhar versões novas.
    expect(activation.licencaParaUpdate).toHaveBeenCalledWith('k', 'fp');
  });
});

describe('check — autorização', () => {
  it('janela no futuro devolve a corrente com `reason: current`', async () => {
    const { service } = montar(
      [r('1.0.0', '2026-01-10'), r('1.2.0', '2026-06-01', 'correções')],
      { ...LICENCA, updates_until: new Date('2027-01-01') },
    );

    expect(await service.check({ licenseKey: 'k', fingerprint: 'fp' })).toEqual({
      update: true,
      version: '1.2.0',
      releasedAt: new Date('2026-06-01').toISOString(),
      sha256: 'a'.repeat(64),
      notes: 'correções',
      reason: 'current',
    });
  });

  it('janela vencida devolve a última autorizada com `reason: last-authorized`', async () => {
    const { service } = montar([
      r('1.0.0', '2026-01-10'),
      r('1.1.0', '2026-03-01'),
      r('2.0.0', '2026-09-01'),
    ]);

    // **O critério que prova a promessa da licença perpétua** — e o `reason` é o
    // que permite ao War Room oferecer renovação sem dizer "você está
    // atualizado", que seria mentira.
    const resposta = await service.check({ licenseKey: 'k', fingerprint: 'fp' });

    expect(resposta).toMatchObject({
      update: true,
      version: '1.1.0',
      reason: 'last-authorized',
    });
  });

  it('nenhuma release cabe na janela devolve `update: false`', async () => {
    const { service } = montar([r('2.0.0', '2026-09-01')]);

    expect(await service.check({ licenseKey: 'k', fingerprint: 'fp' })).toEqual({
      update: false,
    });
  });

  it('cliente já na versão autorizada mais nova devolve `update: false`', async () => {
    const { service } = montar([r('1.0.0', '2026-01-10'), r('1.1.0', '2026-03-01')]);

    expect(
      await service.check({
        licenseKey: 'k',
        fingerprint: 'fp',
        currentVersion: '1.1.0',
      }),
    ).toEqual({ update: false });
  });

  it('`currentVersion` desatualizada continua devolvendo update', async () => {
    const { service } = montar([r('1.0.0', '2026-01-10'), r('1.1.0', '2026-03-01')]);

    expect(
      await service.check({
        licenseKey: 'k',
        fingerprint: 'fp',
        currentVersion: '1.0.0',
      }),
    ).toMatchObject({ update: true, version: '1.1.0' });
  });

  it('sem release nenhuma devolve `update: false`', async () => {
    const { service } = montar([]);

    expect(await service.check({ licenseKey: 'k', fingerprint: 'fp' })).toEqual({
      update: false,
    });
  });
});

describe('check — o que a busca filtra', () => {
  it('só releases PUBLICADAS e só do produto DA LICENÇA', async () => {
    const { service, chamadas } = montar([r('1.0.0', '2026-01-10')]);

    await service.check({ licenseKey: 'k', fingerprint: 'fp' });

    // `published` filtrado na consulta, não na decisão: uma release retirada por
    // defeito não pode virar resposta nem sequer como `last-authorized`.
    // `productId` vem da licença — sem ele, a resposta seria a release mais nova
    // de QUALQUER produto do tenant.
    expect(chamadas.where).toEqual({ productId: 'prod-1', published: true });
  });

  it('a busca roda no contexto do tenant DONO da licença', async () => {
    const { service, prisma } = montar([r('1.0.0', '2026-01-10')]);

    await service.check({ licenseKey: 'k', fingerprint: 'fp' });

    // Rota pública, sem sessão: fora do contexto o RLS devolveria zero linhas e a
    // resposta seria "nenhuma atualização" para toda licença válida — falha muda.
    expect(prisma.runInTenantContext).toHaveBeenCalledWith(
      ['tn-1'],
      expect.any(Function),
    );
  });

  it('não escreve nada — nem `lastSeenAt`, nem evento', async () => {
    const { service, prisma } = montar([r('1.0.0', '2026-01-10')]);

    // As escritas que este serviço poderia fazer por engano, todas armadas para
    // falhar. Perguntar se há atualização não é sinal de vida (isso é do
    // `heartbeat`) e não é download (o `LicEvent` de auditoria nasce no PR-3):
    // registrar aqui encheria a trilha de "perguntou" e afogaria os "baixou",
    // que são os que respondem *quem levou o quê*.
    const escrever = jest.fn(() => {
      throw new Error('o check não pode escrever');
    });
    Object.assign(prisma, {
      licEvent: { create: escrever, createMany: escrever },
      activation: { update: escrever, updateMany: escrever },
      licRelease: {
        ...(prisma as unknown as { licRelease: object }).licRelease,
        update: escrever,
      },
    });

    await expect(
      service.check({ licenseKey: 'k', fingerprint: 'fp' }),
    ).resolves.toMatchObject({ update: true });
    expect(escrever).not.toHaveBeenCalled();
  });
});
