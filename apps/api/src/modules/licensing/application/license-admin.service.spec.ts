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
  /** As três colunas que a busca da SPEC-040 passou a casar além do e-mail. */
  saleRef: string | null;
  githubUsername: string | null;
  /** O que o detalhe agregado da SPEC-040 devolve sobre o acesso ao source. */
  sourceAccess: string;
  sourceAccessError: string | null;
  sourceInviteAt: Date | null;
  pastDueAt: Date | null;
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
    /** Entregas de e-mail que o detalhe agregado da SPEC-040 devolve. */
    entregas?: Array<Record<string, unknown>>;
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
          saleRef: (data.saleRef as string | null) ?? null,
          githubUsername: (data.githubUsername as string | null) ?? null,
          sourceAccess: 'NONE',
          sourceAccessError: null,
          sourceInviteAt: null,
          pastDueAt: null,
        };
        licencas.push(linha);
        const aninhado = data.events as { create?: Record<string, unknown> };
        if (aninhado?.create) eventos.push({ ...aninhado.create, licenseId: linha.id });
        return comEdicao(linha);
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Dobra do `OR` da busca ampliada (SPEC-040). Cada ramo é
        // `{ coluna: { contains } }` ou `{ keyHash: '<hash>' }` — o mesmo
        // formato que o service monta, para que um ramo esquecido lá apareça
        // como teste vermelho aqui, e não como busca que não acha.
        const ramos = where.OR as Array<Record<string, unknown>> | undefined;
        const casa = (l: LinhaLicenca) =>
          !ramos ||
          ramos.some((ramo) => {
            const [coluna, criterio] = Object.entries(ramo)[0];
            const valor = (l as unknown as Record<string, unknown>)[coluna];
            if (typeof criterio === 'string') return valor === criterio;
            const alvo = (criterio as { contains?: string }).contains;
            const sensivel = (criterio as { mode?: string }).mode !== 'insensitive';
            if (typeof valor !== 'string' || alvo === undefined) return false;
            return sensivel
              ? valor.includes(alvo)
              : valor.toLowerCase().includes(alvo.toLowerCase());
          });

        return licencas
          .filter((l) => l.tenantId === where.tenantId)
          .filter((l) => !where.status || l.status === where.status)
          .filter(casa)
          .map(comEdicao);
      }),
      findFirst: jest.fn(
        async ({
          where,
          include,
        }: {
          where: Record<string, unknown>;
          include?: Record<string, unknown>;
        }) => {
          const achada = licencas.find(
            (l) =>
              (where.id === undefined || l.id === where.id) &&
              (where.keyHash === undefined || l.keyHash === where.keyHash) &&
              (where.tenantId === undefined || l.tenantId === where.tenantId),
          );
          if (!achada) return null;
          // O `detail` pede os dois `include` novos da SPEC-040; os demais
          // caminhos não. A dobra só os devolve quando pedidos, senão um
          // `include` esquecido no service passaria despercebido.
          return {
            ...comEdicao(achada),
            ...(include?.mailDeliveries
              ? { mailDeliveries: opcoes.entregas ?? [] }
              : {}),
            ...(include?.events
              ? {
                  events: eventos
                    .filter((e) => e.licenseId === achada.id)
                    .map((e, i) => ({
                      id: `evt-${i}`,
                      type: e.type,
                      payload: e.payload ?? null,
                      createdAt: new Date('2026-07-29T12:00:00Z'),
                    })),
                }
              : {}),
          };
        },
      ),
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
      count: jest.fn(async () => 0),
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

  describe('SPEC-040: a busca ampliada', () => {
    /** Uma licença com as cinco colunas preenchidas, para buscar por cada uma. */
    async function comDadosCompletos() {
      const montado = montar();
      const emitida = await montado.service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'ana@exemplo.com',
        customerName: 'Ana Silva',
      });
      // As duas colunas que a emissão manual não preenche: `saleRef` vem do
      // webhook (SPEC-038) e o username, do link de coleta (SPEC-039).
      const linha = montado.licencas.find((l) => l.id === emitida.id)!;
      linha.saleRef = 'kiwify-9931';
      linha.githubUsername = 'anasilva';

      await montado.service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'bruno@exemplo.com',
        customerName: 'Bruno Costa',
      });

      return { ...montado, emitida };
    }

    it('acha pelo e-mail, pelo nome, pelo saleRef e pelo username', async () => {
      // Os quatro casos existem porque o canal por onde o cliente reclama
      // decide o que ele manda: o e-mail vem do próprio e-mail, o nome vem do
      // WhatsApp, o `saleRef` vem do print da plataforma, e o username vem de
      // quem já passou pelo link de coleta do source.
      const { service, emitida } = await comDadosCompletos();

      for (const termo of ['ana@', 'Ana Silva', 'kiwify-9931', 'anasilva']) {
        const achadas = await service.list('t-1', termo);
        expect(achadas.map((l) => l.id)).toEqual([emitida.id]);
      }
    });

    it('acha pelo nome com a caixa trocada', async () => {
      // O nome é digitado pelo comprador com as maiúsculas que ele quis.
      // Buscar "silva" não pode falhar porque a linha diz "Silva" — o modo de
      // falhar é mudo: lista vazia lida como "esse cliente não existe".
      const { service, emitida } = await comDadosCompletos();
      const achadas = await service.list('t-1', 'silva');
      expect(achadas.map((l) => l.id)).toEqual([emitida.id]);
    });

    it('acha pela chave, que entra no OR como hash exato', async () => {
      // A chave é o único ramo por igualdade: hash não tem prefixo em comum
      // com nada, e `contains` sobre `keyHash` só acharia por acidente.
      const { service, prisma, emitida } = await comDadosCompletos();
      const achadas = await service.list('t-1', emitida.key);
      expect(achadas.map((l) => l.id)).toEqual([emitida.id]);

      const where = (prisma.license.findMany as jest.Mock).mock.calls.at(-1)![0].where;
      expect(where.OR).toContainEqual({ keyHash: hashKey(emitida.key) });
    });

    it('a chave em claro não vaza para a query de busca', async () => {
      // O termo digitado vira hash antes de virar filtro. Se a chave crua
      // aparecesse no `where`, ela entraria no log de query do Postgres — o
      // mesmo vazamento que a decisão de não persistir a chave existe para
      // impedir, por um caminho que ninguém olharia.
      const { service, prisma, emitida } = await comDadosCompletos();
      await service.list('t-1', emitida.key);

      const where = (prisma.license.findMany as jest.Mock).mock.calls.at(-1)![0].where;
      const ramoDaChave = where.OR.find((r: Record<string, unknown>) => 'keyHash' in r);
      expect(JSON.stringify(ramoDaChave)).not.toContain(emitida.key);
    });

    it('termo que não casa nada devolve lista vazia, não erro', async () => {
      const { service } = await comDadosCompletos();
      expect(await service.list('t-1', 'ninguem-com-esse-nome')).toEqual([]);
    });

    it('sem termo, devolve tudo do tenant', async () => {
      const { service } = await comDadosCompletos();
      expect(await service.list('t-1')).toHaveLength(2);
    });

    it('o detalhe responde numa resposta só: source, e-mails e trilha', async () => {
      // O critério de aceite da fatia é *"o detalhe responde sozinho o que
      // aconteceu com este cliente"*. Antes disto, "ele recebeu a chave?" e
      // "ele tem acesso ao código?" exigiam outras duas telas — e a segunda só
      // mostrava quem estava travado, então licença saudável não aparecia
      // em lugar nenhum.
      const entrega = {
        id: 'mail-1',
        to: 'ana@exemplo.com',
        template: 'license_key',
        subject: 'Sua chave',
        status: 'SENT',
        attempts: 1,
        error: null,
        createdAt: new Date('2026-07-29T12:00:00Z'),
        sentAt: new Date('2026-07-29T12:00:05Z'),
      };
      const { service, licencas } = montar({ entregas: [entrega] });
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'ana@exemplo.com',
      });
      Object.assign(licencas[0], {
        saleRef: 'kiwify-9931',
        sourceAccess: 'ACTIVE',
        githubUsername: 'anasilva',
        sourceAccessError: null,
        sourceInviteAt: new Date('2026-07-20T12:00:00Z'),
        pastDueAt: null,
      });

      const detalhe = await service.detail('t-1', emitida.id);

      expect(detalhe.sourceAccess).toBe('ACTIVE');
      expect(detalhe.githubUsername).toBe('anasilva');
      expect(detalhe.saleRef).toBe('kiwify-9931');
      expect(detalhe.sourceInviteAt).toBe('2026-07-20T12:00:00.000Z');
      expect(detalhe.mailDeliveries).toEqual([
        expect.objectContaining({ template: 'license_key', status: 'SENT' }),
      ]);
      // A trilha vem junto — o `GET /licenses/:id/events` continua existindo e
      // não muda de caminho, mas exigir duas requisições para responder uma
      // pergunta é o que a spec chama de "numa tela só" não cumprido.
      expect(detalhe.events).toEqual([expect.objectContaining({ type: 'issued' })]);
    });

    it('o detalhe não devolve a chave em claro', async () => {
      // Mesma garantia da lista, no caminho que ganhou campos novos: cada
      // `include` acrescentado é uma chance de reintroduzir o que a fatia 25
      // decidiu nunca persistir.
      const { service } = montar();
      const emitida = await service.issue('t-1', {
        editionId: 'ed-1',
        customerEmail: 'ana@exemplo.com',
      });

      const detalhe = await service.detail('t-1', emitida.id);
      expect(JSON.stringify(detalhe)).not.toContain(emitida.key);
      expect(detalhe).not.toHaveProperty('key');
    });

    it('o status filtra POR CIMA da busca, não no lugar dela', async () => {
      // Se o status substituísse o termo, buscar "ana@" com status REVOKED
      // devolveria as revogadas de todo mundo — e o operador leria como se a
      // licença da Ana estivesse revogada.
      const { service, licencas, emitida } = await comDadosCompletos();
      licencas.find((l) => l.id !== emitida.id)!.status = 'REVOKED';

      expect(await service.list('t-1', 'ana@', 'REVOKED')).toEqual([]);
      expect(await service.list('t-1', 'ana@', 'ACTIVE')).toHaveLength(1);
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
