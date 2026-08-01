import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { ErrorReportAdminService, RETENCAO_DIAS } from './error-report-admin.service';

interface Relato {
  id: string;
  message: string;
  status: string;
  receivedAt: Date;
}

function montar(relatos: Relato[] = []) {
  const linhas = [...relatos];
  /** Os `where` que chegaram ao Prisma — é o que prova o filtro. */
  const wheres: Array<Record<string, unknown>> = [];
  const contextos: string[][] = [];

  const prisma = {
    runInTenantContext: jest.fn(async (ids: string[], fn: () => Promise<unknown>) => {
      contextos.push(ids);
      return fn();
    }),
    licErrorReport: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        return linhas;
      }),
      groupBy: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        const porMensagem = new Map<string, Relato[]>();
        for (const l of linhas) {
          porMensagem.set(l.message, [...(porMensagem.get(l.message) ?? []), l]);
        }
        return [...porMensagem.entries()].map(([message, grupo]) => ({
          message,
          _count: { _all: grupo.length },
          _max: {
            receivedAt: grupo.reduce(
              (a, b) => (a > b.receivedAt ? a : b.receivedAt),
              grupo[0].receivedAt,
            ),
          },
        }));
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const achado = linhas.find((l) => l.id === where.id);
        return achado ? { ...achado, license: { customerEmail: 'ana@exemplo.com' } } : null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
          const alvo = linhas.find((l) => l.id === where.id)!;
          alvo.status = data.status;
          return { id: alvo.id, status: alvo.status };
        },
      ),
      deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        wheres.push(where);
        const corte = (where.receivedAt as { lt: Date }).lt;
        const antes = linhas.length;
        for (let i = linhas.length - 1; i >= 0; i -= 1) {
          if (linhas[i].receivedAt < corte) linhas.splice(i, 1);
        }
        return { count: antes - linhas.length };
      }),
    },
  } as unknown as PrismaService;

  return { service: new ErrorReportAdminService(prisma), linhas, wheres, contextos };
}

const relato = (id: string, message: string, receivedAt: Date, status = 'NEW'): Relato => ({
  id,
  message,
  status,
  receivedAt,
});

describe('SPEC-043: a lista do admin', () => {
  it('ordena por receivedAt, não pelo relógio do cliente', async () => {
    // `occurredAt` vem da máquina de outra pessoa: um relógio adiantado fixaria
    // aquele relato no topo para sempre.
    const { service, wheres: _w } = montar([
      relato('a', 'Erro X', new Date('2026-08-01T10:00:00Z')),
    ]);
    const prisma = (service as unknown as { prisma: PrismaService }).prisma;

    await service.list();

    const chamada = (prisma.licErrorReport.findMany as jest.Mock).mock.calls[0][0];
    expect(chamada.orderBy).toEqual({ receivedAt: 'desc' });
  });

  it('filtra produto por JOIN na edição, sem coluna denormalizada', async () => {
    const { service, wheres } = montar();

    await service.list({ productId: 'prod-1' });

    expect(wheres[0].license).toEqual({ edition: { productId: 'prod-1' } });
  });

  it('filtros ausentes não viram filtro vazio', async () => {
    // `appVersion: ''` filtraria por string vazia e devolveria zero linhas — a
    // aba pareceria não ter relato nenhum.
    const { service, wheres } = montar();

    await service.list({ appVersion: '', status: '' });

    expect(wheres[0].appVersion).toBeUndefined();
    expect(wheres[0].status).toBeUndefined();
  });

  it('agrupa por mensagem com contagem', async () => {
    const { service } = montar([
      relato('a', 'Erro X', new Date('2026-08-01T10:00:00Z')),
      relato('b', 'Erro X', new Date('2026-08-02T10:00:00Z')),
      relato('c', 'Erro Y', new Date('2026-07-30T10:00:00Z')),
    ]);

    const grupos = await service.groups();

    expect(grupos).toEqual(
      expect.arrayContaining([
        { message: 'Erro X', count: 2, lastReceivedAt: new Date('2026-08-02T10:00:00Z') },
        { message: 'Erro Y', count: 1, lastReceivedAt: new Date('2026-07-30T10:00:00Z') },
      ]),
    );
  });

  it('o detalhe traz o e-mail do comprador correlacionado pela licença', async () => {
    // Critério de aceite. A tabela não tem coluna de e-mail — ele vem do JOIN.
    const { service } = montar([relato('a', 'Erro X', new Date())]);

    const d = (await service.detail('a')) as unknown as {
      license: { customerEmail: string };
    };

    expect(d.license.customerEmail).toBe('ana@exemplo.com');
  });

  it('relato inexistente responde 404', async () => {
    const { service } = montar();
    await expect(service.detail('nao-existe')).rejects.toThrow(NotFoundException);
  });
});

describe('SPEC-043: triagem', () => {
  it('move entre os três estados', async () => {
    const { service } = montar([relato('a', 'Erro X', new Date())]);

    expect((await service.setStatus('a', 'triaged')).status).toBe('TRIAGED');
    expect((await service.setStatus('a', 'resolved')).status).toBe('RESOLVED');
    expect((await service.setStatus('a', 'new')).status).toBe('NEW');
  });

  it('status desconhecido responde 422', async () => {
    const { service } = montar([relato('a', 'Erro X', new Date())]);

    await expect(service.setStatus('a', 'arquivado')).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(service.setStatus('a', 42)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('relato inexistente responde 404 antes de escrever', async () => {
    const { service } = montar();
    await expect(service.setStatus('nao-existe', 'triaged')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('SPEC-043: purge de 90 dias', () => {
  const AGORA = new Date('2026-08-01T12:00:00Z');
  const diasAtras = (n: number): Date =>
    new Date(AGORA.getTime() - n * 24 * 60 * 60 * 1000);

  it('apaga o que passou de 90 dias e preserva o resto', async () => {
    // Critério de aceite, com relógio controlado — `agora` é parâmetro
    // justamente para isto.
    const { service, linhas } = montar([
      relato('velho', 'Erro X', diasAtras(RETENCAO_DIAS + 1)),
      relato('limite', 'Erro X', diasAtras(RETENCAO_DIAS - 1)),
      relato('novo', 'Erro Y', diasAtras(1)),
    ]);

    const removidos = await service.purge('t-1', AGORA);

    expect(removidos).toBe(1);
    expect(linhas.map((l) => l.id)).toEqual(['limite', 'novo']);
  });

  it('não apaga nada quando tudo está dentro da janela', async () => {
    const { service, linhas } = montar([relato('novo', 'Erro X', diasAtras(10))]);

    expect(await service.purge('t-1', AGORA)).toBe(0);
    expect(linhas).toHaveLength(1);
  });

  it('corta por receivedAt, nunca por occurredAt', async () => {
    // A retenção conta do que está aqui. Um relógio adiantado no cliente não
    // pode empurrar o relato para fora da janela antes da hora.
    const { service, wheres } = montar([relato('a', 'Erro X', diasAtras(1))]);

    await service.purge('t-1', AGORA);

    expect(Object.keys(wheres[0])).toEqual(['receivedAt']);
    expect((wheres[0].receivedAt as { lt: Date }).lt).toEqual(
      diasAtras(RETENCAO_DIAS),
    );
  });

  it('roda sob o contexto do tenant', async () => {
    // Fora dele o deleteMany do RLS fail-closed apagaria zero linhas SEM erro, e
    // o purge reportaria sucesso tendo mantido tudo — retenção de LGPD
    // descumprida em silêncio.
    const { service, contextos } = montar([relato('a', 'Erro X', diasAtras(200))]);

    await service.purge('t-1', AGORA);

    expect(contextos).toEqual([['t-1']]);
  });
});
