import type { PrismaService } from '../../../prisma/prisma.service';
import { hashKey, isWellFormedKey } from '../domain/license-key';
import { LicenseAdminService } from './license-admin.service';

const EDICAO = {
  id: 'ed-1',
  slug: 'closed',
  name: 'Sem código-fonte',
  maxMachines: 2,
  updatesMonths: 12,
  product: { id: 'prod-1', slug: 'warroom', keyPrefix: 'WR' },
};

interface LinhaLicenca {
  id: string;
  tenantId: string;
  editionId: string;
  keyHash: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  customerEmail: string;
  customerName: string | null;
  issuedAt: Date;
  updatesUntil: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

/**
 * Dobra do Prisma. O RLS é do banco (provado no int-spec do PR-1); aqui o que
 * se testa é a REGRA em volta dele — o que o service grava, o que devolve, e o
 * que ele **não** devolve.
 */
function montar(
  opcoes: {
    edicao?: typeof EDICAO | null;
    licencas?: LinhaLicenca[];
    eventos?: Array<Record<string, unknown>>;
  } = {},
) {
  const licencas = opcoes.licencas ?? [];
  const eventos = opcoes.eventos ?? [];
  let seq = 0;

  const comEdicao = (l: LinhaLicenca) => ({
    ...l,
    edition: EDICAO,
    activations: [],
  });

  const prisma = {
    licEdition: {
      findFirst: jest.fn(async () =>
        opcoes.edicao === undefined ? EDICAO : opcoes.edicao,
      ),
    },
    license: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const linha: LinhaLicenca = {
          id: `lic-${++seq}`,
          tenantId: data.tenantId as string,
          editionId: data.editionId as string,
          keyHash: data.keyHash as string,
          status: 'ACTIVE',
          customerEmail: data.customerEmail as string,
          customerName: (data.customerName as string | null) ?? null,
          issuedAt: data.issuedAt as Date,
          updatesUntil: data.updatesUntil as Date,
          expiresAt: (data.expiresAt as Date | null) ?? null,
          revokedAt: null,
          revokedReason: null,
        };
        licencas.push(linha);
        const aninhado = data.events as { create?: Record<string, unknown> };
        if (aninhado?.create) eventos.push({ ...aninhado.create, licenseId: linha.id });
        return comEdicao(linha);
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const filtro = where.customerEmail as { contains?: string } | undefined;
        return licencas
          .filter((l) => l.tenantId === where.tenantId)
          .filter((l) => !filtro?.contains || l.customerEmail.includes(filtro.contains))
          .map(comEdicao);
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const achada = licencas.find(
          (l) =>
            (where.id === undefined || l.id === where.id) &&
            (where.keyHash === undefined || l.keyHash === where.keyHash) &&
            (where.tenantId === undefined || l.tenantId === where.tenantId),
        );
        return achada ? comEdicao(achada) : null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const linha = licencas.find((l) => l.id === where.id)!;
          Object.assign(linha, {
            status: data.status ?? linha.status,
            revokedAt: data.revokedAt ?? linha.revokedAt,
            revokedReason: data.revokedReason ?? linha.revokedReason,
          });
          const aninhado = data.events as { create?: Record<string, unknown> };
          if (aninhado?.create) eventos.push({ ...aninhado.create, licenseId: linha.id });
          return comEdicao(linha);
        },
      ),
    },
    activation: { count: jest.fn(async () => 0) },
    licEvent: {
      findMany: jest.fn(async ({ where }: { where: { licenseId: string } }) =>
        eventos
          .filter((e) => e.licenseId === where.licenseId)
          .map((e, i) => ({
            id: `evt-${i}`,
            type: e.type,
            payload: e.payload ?? null,
            createdAt: new Date('2026-07-29T12:00:00Z'),
          })),
      ),
    },
  } as unknown as PrismaService;

  return { service: new LicenseAdminService(prisma), prisma, licencas, eventos };
}

describe('SPEC-036: emissão e revogação de licença', () => {
  describe('issue', () => {
    it('devolve a chave no formato do produto', async () => {
      const { service } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      expect(emitida.key).toMatch(/^WR(-[2-9A-HJ-NP-Z]{4}){4}$/);
      expect(isWellFormedKey(emitida.key, 'WR')).toBe(true);
    });

    it('grava o HASH, nunca a chave em claro', async () => {
      // A garantia central da fatia. Se a chave aparecesse em qualquer campo
      // gravado, reconsultar a licença a revelaria — e o vazamento do banco
      // entregaria licenças ativas.
      const { service, prisma, licencas } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      const gravado = JSON.stringify(
        (prisma.license.create as jest.Mock).mock.calls[0][0],
      );
      expect(gravado).not.toContain(emitida.key);
      expect(licencas[0].keyHash).toBe(hashKey(emitida.key));
    });

    it('a chave não aparece na trilha', async () => {
      // O `LicEvent.payload` é o lugar mais fácil de vazar a chave "só para
      // referência" — e ele é lido pelo admin, então seria vazamento com tela.
      const { service, eventos } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      expect(JSON.stringify(eventos)).not.toContain(emitida.key);
      expect(eventos[0]).toMatchObject({ type: 'issued' });
    });

    it('calcula `updatesUntil` como emissão + meses da edição', async () => {
      const { service, licencas } = montar();
      await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      const { issuedAt, updatesUntil } = licencas[0];
      const esperado = new Date(issuedAt.getTime());
      esperado.setUTCMonth(esperado.getUTCMonth() + 12);
      expect(updatesUntil).toEqual(esperado);
    });

    it('`expiresAt` nasce nulo em PERPETUAL', async () => {
      const { service, licencas } = montar();
      await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });
      expect(licencas[0].expiresAt).toBeNull();
    });

    it('normaliza o e-mail para minúsculas', async () => {
      // Senão a mesma pessoa vira dois compradores na busca do suporte.
      const { service, licencas } = montar();
      await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: '  Comprador@Exemplo.COM ',
      });
      expect(licencas[0].customerEmail).toBe('comprador@exemplo.com');
    });

    it.each([
      ['sem edição', { customerEmail: 'x@exemplo.com' }],
      ['e-mail vazio', { editionId: 'ed-1', customerEmail: '' }],
      ['e-mail sem @', { editionId: 'ed-1', customerEmail: 'não-é-email' }],
      ['e-mail sem domínio', { editionId: 'ed-1', customerEmail: 'x@y' }],
      ['e-mail não-string', { editionId: 'ed-1', customerEmail: 42 }],
    ])('recusa %s', async (_caso, entrada) => {
      const { service } = montar();
      await expect(service.issue('t-1', entrada)).rejects.toThrow();
    });

    it('recusa edição de outro tenant como não-encontrada', async () => {
      // O `findFirst` filtra por `product.tenantId`; devolver 404 (e não 403)
      // não confirma que aquele id existe em outro lugar.
      const { service } = montar({ edicao: null });
      await expect(
        service.issue('t-1', { editionId: 'ed-de-outro', customerEmail: 'x@exemplo.com' }),
      ).rejects.toThrow('Edição não encontrada');
    });
  });

  describe('list e findByKey', () => {
    it('nenhuma leitura devolve a chave', async () => {
      // O tipo `LicenseView` não tem o campo — este teste afirma que nenhuma
      // rota de leitura o reintroduz por acidente.
      const { service } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      const lista = await service.list('t-1');
      const achada = await service.findByKey('t-1', emitida.key);

      expect(JSON.stringify(lista)).not.toContain(emitida.key);
      expect(JSON.stringify(achada)).not.toContain(emitida.key);
      expect(lista[0]).not.toHaveProperty('key');
      expect(achada).not.toHaveProperty('key');
    });

    it('acha a licença pela chave digitada em minúscula', async () => {
      // O modo de falhar mais caro: a mesma chave com outra caixa daria "não
      // encontrada" numa licença que existe.
      const { service } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      const achada = await service.findByKey('t-1', emitida.key.toLowerCase());
      expect(achada?.id).toBe(emitida.id);
    });

    it('chave inexistente devolve null, não erro', async () => {
      const { service } = montar();
      expect(await service.findByKey('t-1', 'WR-AB23-CD45-EF67-GH89')).toBeNull();
      expect(await service.findByKey('t-1', '')).toBeNull();
    });

    it('a busca por chave filtra por tenant além do RLS', async () => {
      // Duas barreiras para o mesmo corte: o índice de `key_hash` é único na
      // tabela inteira, então sem o filtro explícito o RLS seria a única coisa
      // entre o admin de um tenant e a licença de outro.
      const { service, prisma } = montar();
      await service.findByKey('t-1', 'WR-AB23-CD45-EF67-GH89');

      expect((prisma.license.findFirst as jest.Mock).mock.calls[0][0].where).toMatchObject({
        tenantId: 't-1',
      });
    });

    it('filtra a lista por e-mail', async () => {
      const { service } = montar();
      await service.issue('t-1', { editionId: 'ed-1', customerEmail: 'ana@exemplo.com' });
      await service.issue('t-1', { editionId: 'ed-1', customerEmail: 'bruno@exemplo.com' });

      const so = await service.list('t-1', 'ana@');
      expect(so).toHaveLength(1);
      expect(so[0].customerEmail).toBe('ana@exemplo.com');
    });
  });

  describe('revoke', () => {
    it('marca status, data e motivo juntos', async () => {
      // Os três vão juntos porque o CHECK do banco exige — e ele exige porque
      // status sem data deixa a trilha sem o dia em que a venda foi desfeita.
      const { service, licencas } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      const revogada = await service.revoke('t-1', emitida.id, 'reembolso Kiwify');

      expect(revogada.status).toBe('REVOKED');
      expect(revogada.revokedReason).toBe('reembolso Kiwify');
      expect(licencas[0].revokedAt).toBeInstanceOf(Date);
    });

    it('registra `revoked` na trilha', async () => {
      const { service, eventos } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });
      await service.revoke('t-1', emitida.id, 'chargeback');

      expect(eventos.map((e) => e.type)).toEqual(['issued', 'revoked']);
      expect(eventos[1].payload).toEqual({ reason: 'chargeback' });
    });

    it('é idempotente: revogar de novo não reescreve a data', async () => {
      // A 1ª revogação é o fato; a 2ª é um clique repetido. Reescrever a data
      // moveria para hoje o dia em que a venda foi desfeita.
      const { service, licencas, eventos } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });
      await service.revoke('t-1', emitida.id, 'reembolso');
      const primeira = licencas[0].revokedAt;

      await service.revoke('t-1', emitida.id, 'outro motivo');

      expect(licencas[0].revokedAt).toBe(primeira);
      expect(licencas[0].revokedReason).toBe('reembolso');
      expect(eventos.filter((e) => e.type === 'revoked')).toHaveLength(1);
    });

    it('exige motivo', async () => {
      // Revogação sem motivo é a que ninguém consegue explicar meses depois,
      // quando o comprador reclama.
      const { service } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      await expect(service.revoke('t-1', emitida.id, '   ')).rejects.toThrow('motivo');
    });

    it('licença de outro tenant é não-encontrada', async () => {
      const { service } = montar();
      await expect(service.revoke('t-1', 'lic-de-outro', 'x')).rejects.toThrow(
        'não encontrada',
      );
    });
  });

  describe('events', () => {
    it('devolve a trilha da licença', async () => {
      const { service } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'comprador@exemplo.com',
      });

      const trilha = await service.events('t-1', emitida.id);
      expect(trilha).toHaveLength(1);
      expect(trilha[0].type).toBe('issued');
    });

    it('trilha de licença inexistente é 404, não lista vazia', async () => {
      // Lista vazia diria "esta licença não tem eventos", que é diferente de
      // "esta licença não é sua".
      const { service } = montar();
      await expect(service.events('t-1', 'lic-de-outro')).rejects.toThrow(
        'não encontrada',
      );
    });
  });
});
