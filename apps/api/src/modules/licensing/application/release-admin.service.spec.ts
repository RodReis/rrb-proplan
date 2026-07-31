import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { ReleaseAdminService } from './release-admin.service';

/**
 * Admin das releases (SPEC-041 §Escopo item 2).
 *
 * O que se prova aqui é **validação no servidor**: os CHECKs do PR-1 recusariam
 * quase tudo isto, mas com `23514`, que a tela mostra como `500` — *"o ProPlan
 * quebrou"* sobre um erro que é *"você digitou o hash errado"*. Foi o FIX #216.
 */

const SHA = 'a'.repeat(64);

const VALIDO = {
  productId: 'prod-1',
  version: '1.2.0',
  os: 'win-x64',
  releasedAt: '2026-06-01T00:00:00.000Z',
  assetId: '12345',
  sha256: SHA,
};

/**
 * `existente` serve a DOIS caminhos que chamam o mesmo `findFirst`: no `create`
 * ele responde *"esta versão já está registrada?"* (e `null` é o caso feliz); no
 * `unpublish`/`publish` responde *"a release existe neste tenant?"* (e `null` é
 * o `404`). Por isso o default difere: `create` monta sem `existente`,
 * `unpublish` monta com um objeto.
 */
function montar(opts: { produto?: unknown; existente?: unknown } = {}) {
  const gravado: Record<string, unknown> = {};

  const prisma = {
    licProduct: {
      findFirst: jest.fn(async () =>
        'produto' in opts ? opts.produto : { id: 'prod-1' },
      ),
    },
    licRelease: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => opts.existente ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(gravado, data);
        return {
          id: 'rel-1',
          notes: null,
          published: true,
          ...data,
        };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'rel-1',
        productId: 'prod-1',
        version: '1.2.0',
        os: 'win-x64',
        releasedAt: new Date(VALIDO.releasedAt),
        assetId: '12345',
        sha256: SHA,
        notes: null,
        published: true,
        ...data,
      })),
    },
  } as unknown as PrismaService;

  return { service: new ReleaseAdminService(prisma), prisma, gravado };
}

describe('create — validação antes do banco', () => {
  it('registra uma release válida', async () => {
    const { service, gravado } = montar();

    const r = await service.create('tn-1', VALIDO);

    expect(r).toMatchObject({ version: '1.2.0', os: 'win-x64', published: true });
    expect(gravado).toMatchObject({ tenantId: 'tn-1', assetId: '12345' });
  });

  it('recusa `sha256` malformado, nomeando o formato', async () => {
    const { service } = montar();

    // **O campo que mais importa validar, pelo QUANDO ele falha**: o hash só é
    // conferido na máquina do cliente, depois de baixar. Um valor torto gastaria
    // 80 MB de transferência e apareceria como "download corrompido" — mandando
    // o operador caçar problema de rede num erro de digitação.
    await expect(
      service.create('tn-1', { ...VALIDO, sha256: 'abc' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('normaliza o `sha256` para minúsculas', async () => {
    const { service, gravado } = montar();

    // O CHECK do banco aceita as duas caixas; a comparação da máquina do cliente
    // não necessariamente. Gravar canônico evita um "hash não confere" que só
    // acontece com quem colou de uma fonte em maiúsculas.
    await service.create('tn-1', { ...VALIDO, sha256: SHA.toUpperCase() });

    expect(gravado.sha256).toBe(SHA);
  });

  it('recusa quando falta campo obrigatório', async () => {
    const { service } = montar();

    for (const campo of ['productId', 'version', 'os', 'assetId'] as const) {
      await expect(
        service.create('tn-1', { ...VALIDO, [campo]: '' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    }
  });

  it('recusa `releasedAt` ausente ou inválido — nunca assume `now()`', async () => {
    const { service } = montar();

    // **Informado, nunca `now()`**: registrar uma release antiga com a data de
    // hoje a tornaria indevidamente autorizada para quem já tem a janela
    // vencida — o oposto exato da promessa da licença perpétua.
    await expect(
      service.create('tn-1', { ...VALIDO, releasedAt: undefined }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.create('tn-1', { ...VALIDO, releasedAt: 'ontem' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('recusa produto de outro tenant', async () => {
    const { service } = montar({ produto: null });

    // Sem esta checagem o `create` cairia no FK e responderia `500` — ou, pior,
    // penduraria release no produto alheio se o id fosse conhecido.
    await expect(service.create('tn-1', VALIDO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('recusa versão já registrada, nomeando qual', async () => {
    const { service } = montar({ existente: { id: 'rel-velha' } });

    // O `@@unique` recusaria de todo modo, mas com `P2002` — erro genérico na
    // tela. Nomear é o que permite ao operador entender que já registrou esta.
    await expect(service.create('tn-1', VALIDO)).rejects.toThrow(/1\.2\.0/);
  });
});

describe('unpublish / publish', () => {
  it('despublicar marca `published: false` sem apagar a linha', async () => {
    const { service, prisma } = montar({ existente: { id: 'rel-1' } });

    const r = await service.unpublish('tn-1', 'rel-1');

    // **Não apaga**: a trilha de quem já baixou aponta para esta release, e o
    // artefato continua no GitHub. Apagar quebraria a referência do `LicEvent`
    // sem tirar o binário de circulação — o pior dos dois mundos.
    expect(r.published).toBe(false);
    expect(prisma.licRelease.update).toHaveBeenCalledWith({
      where: { id: 'rel-1' },
      data: { published: false },
    });
  });

  it('republicar volta `published: true`', async () => {
    const { service } = montar({ existente: { id: 'rel-1' } });

    // Despublicar por engano é o erro provável de um botão ao lado da lista, e
    // sem volta o operador teria de registrar a mesma versão de novo — que o
    // `@@unique` recusa.
    expect((await service.publish('tn-1', 'rel-1')).published).toBe(true);
  });

  it('release de outro tenant responde 404 nas duas ações', async () => {
    const { service } = montar({ existente: null });

    // O `where` das duas ações casa `id` E `tenantId`. Sem o segundo, quem
    // conhecesse o id despublicaria a release de outro tenant — e o efeito seria
    // a máquina dos clientes dele parando de receber update.
    await expect(service.unpublish('tn-1', 'alheia')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.publish('tn-1', 'alheia')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('list', () => {
  it('filtra por tenant e, quando pedido, por produto', async () => {
    const { service, prisma } = montar();

    await service.list('tn-1', 'prod-1');

    expect(prisma.licRelease.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tn-1', productId: 'prod-1' },
      orderBy: { releasedAt: 'desc' },
    });
  });

  it('sem produto, lista o tenant inteiro', async () => {
    const { service, prisma } = montar();

    await service.list('tn-1');

    expect(prisma.licRelease.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tn-1' },
      orderBy: { releasedAt: 'desc' },
    });
  });
});
