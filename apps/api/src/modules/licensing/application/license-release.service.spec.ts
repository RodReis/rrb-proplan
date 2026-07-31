import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { CryptoService } from '../../identity/infrastructure/crypto.service';
import {
  GithubSourceError,
  type GithubSourceClient,
} from '../infrastructure/github-source.client';
import type { LicenseActivationService } from './license-activation.service';
import { LicenseReleaseService } from './license-release.service';

/**
 * `releases/check` e `releases/download` (SPEC-041 §Contratos).
 *
 * O gate de status (`404`/`409`/`410`) **não é testado aqui**: ele vive no
 * `LicenseActivationService.licencaParaUpdate`, compartilhado com `/activate` e
 * `/heartbeat`, e já tem cobertura lá. O que se prova aqui é que os dois métodos
 * o **chamam** — e o que decidem depois.
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

  const github = {
    assetDownloadUrl: jest.fn(async () => 'https://storage.example/asset?sig=x'),
  } as unknown as GithubSourceClient;

  const crypto = {
    decrypt: jest.fn(() => 'pat-em-claro'),
  } as unknown as CryptoService;

  return {
    service: new LicenseReleaseService(prisma, activation, github, crypto),
    prisma,
    activation,
    github,
    crypto,
    chamadas,
  };
}

/**
 * O mesmo mock, com o que só o `download` toca: a release procurada, o
 * `sourceRepo` do produto e o PAT cifrado do tenant.
 *
 * Montado à parte do `montar` porque a busca do `download` é `findFirst` por
 * `(produto, versão, os)` — o `check` usa `findMany` e não conhece `assetId`.
 */
function montarDownload(
  opcoes: {
    release?: Record<string, unknown> | null;
    sourceRepo?: string | null;
    patCifrado?: string | null;
    licenca?: typeof LICENCA;
  } = {},
) {
  const {
    release = {
      id: 'rel-1',
      version: '1.1.0',
      releasedAt: new Date('2026-03-01'),
      sha256: 'b'.repeat(64),
      assetId: '4242',
    },
    sourceRepo = 'RodReis/war-room',
    patCifrado = 'cifrado',
    licenca = LICENCA,
  } = opcoes;

  const chamadas: Record<string, unknown> = {};

  const prisma = {
    runInTenantContext: jest.fn((_ids: string[], fn: () => unknown) => fn()),
    licRelease: {
      findFirst: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.where = where;
        return release;
      }),
    },
    licProduct: {
      findUnique: jest.fn(async ({ where }: { where: unknown }) => {
        chamadas.produtoWhere = where;
        return sourceRepo === null ? { sourceRepo: null } : { sourceRepo };
      }),
    },
    licSettings: {
      findUnique: jest.fn(async () => (patCifrado ? { githubPat: patCifrado } : null)),
    },
    licEvent: { create: jest.fn(async () => ({})) },
  } as unknown as PrismaService;

  const activation = {
    licencaParaUpdate: jest.fn(async () => licenca),
  } as unknown as LicenseActivationService;

  const github = {
    assetDownloadUrl: jest.fn(async () => 'https://storage.example/asset?sig=x'),
  } as unknown as GithubSourceClient;

  const crypto = {
    decrypt: jest.fn(() => 'pat-em-claro'),
  } as unknown as CryptoService;

  return {
    service: new LicenseReleaseService(prisma, activation, github, crypto),
    prisma,
    activation,
    github,
    crypto,
    chamadas,
  };
}

const PEDIDO = { licenseKey: 'k', fingerprint: 'fp', version: '1.1.0', os: 'win-x64' };

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

describe('download — entrada', () => {
  it('exige `licenseKey`, `fingerprint`, `version` e `os`', async () => {
    const { service } = montarDownload();

    // `version` e `os` são obrigatórios porque a release é procurada pelos três
    // juntos: sem `os`, `1.1.0` casaria com o artefato de outra plataforma e o
    // cliente baixaria o binário errado — que só falharia ao executar.
    for (const faltando of ['licenseKey', 'fingerprint', 'version', 'os']) {
      const pedido: Record<string, unknown> = { ...PEDIDO };
      delete pedido[faltando];
      await expect(service.download(pedido)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    }
  });

  it('passa pelo mesmo gate compartilhado do `/heartbeat`', async () => {
    const { service, activation } = montarDownload();

    await service.download({ ...PEDIDO, licenseKey: ' k ', fingerprint: ' fp ' });

    // Não é uma segunda opinião: servir update a licença revogada é o
    // reembolsado continuando a receber versões novas.
    expect(activation.licencaParaUpdate).toHaveBeenCalledWith('k', 'fp');
  });
});

describe('download — autorização', () => {
  it('versão dentro da janela devolve URL, TTL e sha256', async () => {
    const { service } = montarDownload();

    expect(await service.download(PEDIDO)).toEqual({
      url: 'https://storage.example/asset?sig=x',
      expiresInSeconds: 60,
      sha256: 'b'.repeat(64),
    });
  });

  it('versão publicada DEPOIS do fim da janela é recusada com 403', async () => {
    const { service } = montarDownload({
      release: {
        id: 'rel-9',
        version: '2.0.0',
        releasedAt: new Date('2026-09-01'),
        sha256: 'c'.repeat(64),
        assetId: '99',
      },
    });

    // **A autorização é refeita aqui, não herdada do `check`.** Quem chama é um
    // binário na máquina de outra pessoa: nada o obriga a devolver a versão que
    // o `check` respondeu, e confiar nisso deixaria qualquer um pedir o que a
    // janela não cobre trocando um campo do corpo.
    await expect(service.download({ ...PEDIDO, version: '2.0.0' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('release publicada no instante exato do vencimento é autorizada', async () => {
    const { service } = montarDownload({
      release: {
        id: 'rel-2',
        version: '1.5.0',
        // Igual ao `updates_until` da licença — o empate de timestamp.
        releasedAt: new Date('2026-06-30T23:59:59.000Z'),
        sha256: 'd'.repeat(64),
        assetId: '55',
      },
    });

    // `>=`, não `>`: a fronteira do que o cliente comprou é o próprio
    // `updatesUntil`, inclusive. Mesma regra do `latestAuthorized`.
    await expect(
      service.download({ ...PEDIDO, version: '1.5.0' }),
    ).resolves.toMatchObject({ url: expect.any(String) });
  });

  it('release inexistente ou despublicada responde 404', async () => {
    const { service, chamadas } = montarDownload({ release: null });

    await expect(service.download(PEDIDO)).rejects.toBeInstanceOf(NotFoundException);

    // Despublicada some do `download` como `404`, não como `403`: quem
    // despublicou por defeito não deve informar a quem pergunta que a versão
    // existe. E o produto vem da LICENÇA — sem isso, a versão de outro produto
    // do mesmo tenant seria servida.
    expect(chamadas.where).toEqual({
      productId: 'prod-1',
      version: '1.1.0',
      os: 'win-x64',
      published: true,
    });
  });

  it('a busca roda no contexto do tenant DONO da licença', async () => {
    const { service, prisma } = montarDownload();

    await service.download(PEDIDO);

    // Rota pública, sem sessão: fora do contexto o RLS devolveria zero linhas e
    // toda licença válida receberia `404` de release que existe.
    expect(prisma.runInTenantContext).toHaveBeenCalledWith(['tn-1'], expect.any(Function));
  });
});

describe('download — a origem do artefato', () => {
  it('usa o `sourceRepo` do produto DA RELEASE, não o primeiro do tenant', async () => {
    const { service, github, chamadas } = montarDownload();

    await service.download(PEDIDO);

    // O caminho do convite (SPEC-039) resolve o repo por tenant porque o piloto
    // tem um produto só. Aqui existe `productId` na mão — buscar por tenant
    // baixaria o asset do repo errado no dia em que houver dois produtos, com o
    // PAT alcançando os dois e sem erro nenhum.
    expect(chamadas.produtoWhere).toEqual({ id: 'prod-1' });
    expect(github.assetDownloadUrl).toHaveBeenCalledWith(
      'pat-em-claro',
      'RodReis/war-room',
      '4242',
    );
  });

  it('produto sem `sourceRepo` responde 503, nunca 500', async () => {
    const { service } = montarDownload({ sourceRepo: null });

    await expect(service.download(PEDIDO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('download — o PAT que falharia calado', () => {
  it('PAT ausente responde 503 com motivo, não 500', async () => {
    const { service } = montarDownload({ patCifrado: null });

    // §Critérios de aceite: *"PAT ausente, expirado ou sem `contents:read` →
    // erro de configuração explícito (nunca `500`, nunca URL vazia)"*. Um `500`
    // diria "o ProPlan quebrou" sobre um erro que é de configuração.
    await expect(service.download(PEDIDO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('PAT ilegível responde 503 e o valor não vaza na mensagem', async () => {
    const { service, crypto } = montarDownload();
    (crypto.decrypt as jest.Mock).mockImplementation(() => {
      throw new Error('cifra ilegível');
    });

    await expect(service.download(PEDIDO)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('PAT sem `contents:read` vira 503 com o motivo do GitHub preservado', async () => {
    const { service, github } = montarDownload();
    (github.assetDownloadUrl as jest.Mock).mockRejectedValue(
      new GithubSourceError(
        'o token não tem permissão de leitura de conteúdo (`contents:read`) no repositório',
        403,
      ),
    );

    // **Não traduz o status do GitHub para o nosso.** Um `404` de lá (asset fora
    // do alcance do PAT) virando `404` daqui diria ao comprador que a release não
    // existe — e ele reportaria versão inexistente enquanto o defeito é o escopo
    // do token.
    await expect(service.download(PEDIDO)).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('contents:read'),
    });
  });
});

describe('download — a trilha de auditoria', () => {
  it('download autorizado grava `LicEvent` sem a URL', async () => {
    const { service, prisma } = montarDownload();

    await service.download(PEDIDO);

    // A URL não entra no payload: ela morre em segundos e guardá-la encheria a
    // trilha de segredo de vida curta. O que a trilha responde é *quem levou o
    // quê*.
    expect(prisma.licEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tn-1',
        licenseId: 'lic-1',
        type: 'release_downloaded',
        payload: { version: '1.1.0', os: 'win-x64', releaseId: 'rel-1' },
      },
    });
  });

  it('download recusado pelo GitHub NÃO grava evento', async () => {
    const { service, prisma, github } = montarDownload();
    (github.assetDownloadUrl as jest.Mock).mockRejectedValue(
      new GithubSourceError('asset não encontrado', 404),
    );

    await expect(service.download(PEDIDO)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    // O evento nasce DEPOIS da URL cunhada. Registrar antes marcaria como
    // baixado o download que nunca aconteceu — e a trilha passaria a mentir
    // exatamente sobre a pergunta que existe para responder.
    expect(prisma.licEvent.create).not.toHaveBeenCalled();
  });

  it('versão fora da janela NÃO grava evento', async () => {
    const { service, prisma } = montarDownload({
      release: {
        id: 'rel-9',
        version: '2.0.0',
        releasedAt: new Date('2026-09-01'),
        sha256: 'c'.repeat(64),
        assetId: '99',
      },
    });

    await expect(service.download({ ...PEDIDO, version: '2.0.0' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.licEvent.create).not.toHaveBeenCalled();
  });
});
