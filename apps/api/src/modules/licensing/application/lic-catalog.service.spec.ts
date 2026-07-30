import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { LicCatalogService } from './lic-catalog.service';

const EDICAO = {
  id: 'ed-1',
  productId: 'prod-1',
  slug: 'closed',
  name: 'Sem código-fonte',
  billingModel: 'PERPETUAL' as const,
  maxMachines: 2,
  updatesMonths: 12,
};

/** Erro que o Prisma levanta quando um unique é violado. */
function conflito() {
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: '5',
  });
}

function montar(
  opcoes: {
    produto?: { id: string } | null;
    edicao?: typeof EDICAO | null;
    createProductErro?: Error;
    createEditionErro?: Error;
    sourceRepoAtual?: string | null;
    listaVazia?: boolean;
  } = {},
) {
  /** O que `listProducts` devolve — usado pelo retorno do `updateProductSourceRepo`. */
  const produtoListado = {
    id: 'prod-1',
    slug: 'warroom',
    name: 'War Room',
    keyPrefix: 'WR',
    sourceRepo: opcoes.sourceRepoAtual ?? null,
    editions: [],
  };

  const prisma = {
    licProduct: {
      findMany: jest.fn(async () => (opcoes.listaVazia ? [] : [produtoListado])),
      findFirst: jest.fn(async () =>
        opcoes.produto === undefined ? { id: 'prod-1' } : opcoes.produto,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (opcoes.createProductErro) throw opcoes.createProductErro;
        return { id: 'prod-1', sourceRepo: null, ...data };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'prod-1',
        ...data,
      })),
    },
    licEdition: {
      findFirst: jest.fn(async () =>
        opcoes.edicao === undefined ? EDICAO : opcoes.edicao,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (opcoes.createEditionErro) throw opcoes.createEditionErro;
        return { id: 'ed-nova', ...data };
      }),
      update: jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => ({
          ...EDICAO,
          ...data,
          _count: { licenses: 3 },
        }),
      ),
    },
  } as unknown as PrismaService;

  return { service: new LicCatalogService(prisma), prisma };
}

describe('SPEC-036: catálogo de produtos e edições', () => {
  describe('createProduct', () => {
    it('normaliza slug para minúsculas e prefixo para maiúsculas', async () => {
      const { service } = montar();
      const p = await service.createProduct('t-1', {
        slug: '  WarRoom ',
        name: 'War Room',
        keyPrefix: 'wr',
      });

      expect(p.slug).toBe('warroom');
      expect(p.keyPrefix).toBe('WR');
    });

    it.each([
      ['slug vazio', { slug: '', name: 'X', keyPrefix: 'WR' }],
      ['slug com espaço', { slug: 'war room', name: 'X', keyPrefix: 'WR' }],
      ['slug com acento', { slug: 'sessão', name: 'X', keyPrefix: 'WR' }],
      ['nome vazio', { slug: 'warroom', name: '  ', keyPrefix: 'WR' }],
      ['prefixo de 1 letra', { slug: 'warroom', name: 'X', keyPrefix: 'W' }],
      ['prefixo longo demais', { slug: 'warroom', name: 'X', keyPrefix: 'ABCDEFG' }],
      ['prefixo com dígito', { slug: 'warroom', name: 'X', keyPrefix: 'W1' }],
    ])('recusa %s', async (_caso, entrada) => {
      const { service } = montar();
      await expect(service.createProduct('t-1', entrada)).rejects.toThrow();
    });

    it('slug duplicado vira 409, não erro cru do banco', async () => {
      // O unique `(tenant_id, slug)` é quem decide, não uma consulta prévia:
      // duas criações simultâneas passariam as duas por um `findFirst`.
      const { service } = montar({ createProductErro: conflito() });
      await expect(
        service.createProduct('t-1', { slug: 'warroom', name: 'X', keyPrefix: 'WR' }),
      ).rejects.toThrow('Já existe um produto');
    });
  });

  describe('createEdition', () => {
    it('usa os padrões da spec quando os limites não vêm', async () => {
      // 2 máquinas e 12 meses (decisão do PI, §Perguntas 1).
      const { service } = montar();
      const e = await service.createEdition('t-1', 'prod-1', {
        slug: 'source',
        name: 'Com código-fonte',
      });

      expect(e).toMatchObject({
        billingModel: 'PERPETUAL',
        maxMachines: 2,
        updatesMonths: 12,
      });
    });

    it('aceita SUBSCRIPTION', async () => {
      const { service } = montar();
      const e = await service.createEdition('t-1', 'prod-1', {
        slug: 'assinatura',
        name: 'Mensal',
        billingModel: 'SUBSCRIPTION',
      });
      expect(e.billingModel).toBe('SUBSCRIPTION');
    });

    it.each([
      ['modelo inventado', { billingModel: 'VITALICIO' }],
      ['zero máquinas', { maxMachines: 0 }],
      ['máquinas fracionárias', { maxMachines: 1.5 }],
      ['máquinas acima do teto', { maxMachines: 101 }],
      ['zero meses', { updatesMonths: 0 }],
      ['meses acima do teto', { updatesMonths: 121 }],
    ])('recusa %s', async (_caso, extra) => {
      // Zero máquinas emitiria licença que não ativa em lugar nenhum; teto sem
      // limite transforma licença de máquina em licença de site por digitação.
      const { service } = montar();
      await expect(
        service.createEdition('t-1', 'prod-1', { slug: 'x', name: 'X', ...extra }),
      ).rejects.toThrow();
    });

    it('produto de outro tenant é não-encontrado', async () => {
      const { service } = montar({ produto: null });
      await expect(
        service.createEdition('t-1', 'prod-de-outro', { slug: 'x', name: 'X' }),
      ).rejects.toThrow('Produto não encontrado');
    });

    it('slug duplicado no mesmo produto vira 409', async () => {
      const { service } = montar({ createEditionErro: conflito() });
      await expect(
        service.createEdition('t-1', 'prod-1', { slug: 'closed', name: 'X' }),
      ).rejects.toThrow('Já existe uma edição');
    });
  });

  describe('updateEditionLimits', () => {
    it('altera só o que veio; o resto mantém o valor atual', async () => {
      const { service, prisma } = montar();
      await service.updateEditionLimits('t-1', 'ed-1', { maxMachines: 3 });

      expect((prisma.licEdition.update as jest.Mock).mock.calls[0][0].data).toEqual({
        maxMachines: 3,
        updatesMonths: 12,
      });
    });

    it('não permite alterar slug nem billingModel', async () => {
      // O slug viaja no license file já emitido; o billingModel muda o
      // significado de `expiresAt` numa licença viva. Trocar qualquer um é
      // criar edição nova — a assinatura do método nem aceita os campos.
      const { service, prisma } = montar();
      await service.updateEditionLimits('t-1', 'ed-1', {
        maxMachines: 4,
        // @ts-expect-error — o tipo não aceita; o teste prova que o runtime
        // também ignora, caso a rota receba o campo por engano.
        slug: 'outro',
        billingModel: 'SUBSCRIPTION',
      });

      const gravado = (prisma.licEdition.update as jest.Mock).mock.calls[0][0].data;
      expect(gravado).not.toHaveProperty('slug');
      expect(gravado).not.toHaveProperty('billingModel');
    });

    it('edição de outro tenant é não-encontrada', async () => {
      const { service } = montar({ edicao: null });
      await expect(
        service.updateEditionLimits('t-1', 'ed-de-outro', { maxMachines: 3 }),
      ).rejects.toThrow('Edição não encontrada');
    });

    it('devolve quantas licenças já saíram da edição', async () => {
      // É o que impede apagá-la (ON DELETE RESTRICT do PR-1) e o que a tela
      // mostra para explicar por que não há botão de remover.
      const { service } = montar();
      const e = await service.updateEditionLimits('t-1', 'ed-1', { maxMachines: 3 });
      expect(e.licenseCount).toBe(3);
    });
  });

  /**
   * O repositório de código-fonte (SPEC-039), exposto no FIX #212.
   *
   * A coluna nasceu no PR-1 daquela fatia e **não tinha caminho pela interface**:
   * sem ela preenchida o convite não tem destino, e o operador só descobriria isso
   * no teste de conexão — depois de já ter cadastrado o PAT.
   */
  describe('updateProductSourceRepo', () => {
    it('grava `owner/name`', async () => {
      const { service, prisma } = montar({ sourceRepoAtual: 'RodReis/war-room' });

      const p = await service.updateProductSourceRepo('t-1', 'prod-1', 'RodReis/war-room');

      expect((prisma.licProduct.update as jest.Mock).mock.calls[0][0].data).toEqual({
        sourceRepo: 'RodReis/war-room',
      });
      expect(p.sourceRepo).toBe('RodReis/war-room');
    });

    it('string vazia LIMPA o campo', async () => {
      const { service, prisma } = montar();

      await service.updateProductSourceRepo('t-1', 'prod-1', '   ');

      // Desconfigurar é ação legítima (o produto deixou de vender código-fonte) e
      // não pode exigir SQL. Diferente do PAT: aqui não há segredo a perder nem
      // entrega que passe a falhar.
      expect((prisma.licProduct.update as jest.Mock).mock.calls[0][0].data).toEqual({
        sourceRepo: null,
      });
    });

    it.each([
      'https://github.com/RodReis/war-room',
      'RodReis/war-room/extra',
      'só-o-nome',
      'RodReis /war-room',
    ])('recusa formato inválido: %s', async (entrada) => {
      const { service, prisma } = montar();

      // Um valor com barra a mais, ou uma URL colada inteira, produziria `404` no
      // momento do convite — que a lista de pendências mostraria como "repositório
      // não encontrado", mandando o operador procurar problema de permissão num
      // erro de digitação.
      await expect(
        service.updateProductSourceRepo('t-1', 'prod-1', entrada),
      ).rejects.toMatchObject({ status: 422 });
      expect(prisma.licProduct.update).not.toHaveBeenCalled();
    });

    it('404 em produto de outro tenant', async () => {
      const { service } = montar({ produto: null });

      await expect(
        service.updateProductSourceRepo('t-1', 'prod-de-outro', 'a/b'),
      ).rejects.toThrow('Produto não encontrado');
    });
  });
});
