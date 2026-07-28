import {
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { transactionMock } from '../../../../test/prisma-transaction-mock';
import {
  BRIEFING_SUBMITTED,
  BriefingSubmitService,
} from './briefing-submit.service';

/**
 * Envio do briefing (SPEC-031 §5).
 *
 * O que estes testes protegem:
 *
 *   - **idempotência**: duplo clique e retry de rede não produzem dois
 *     briefings — nem pelo caminho "já enviado", nem pela corrida que colide no
 *     unique;
 *   - **a barreira é a API**: briefing incompleto e envio sem confirmação são
 *     recusados aqui, não só na tela;
 *   - **o que sobrevive à falha**: o card e o audit podem falhar sem desfazer o
 *     envio — a versão é o dado do cliente, o resto é consequência;
 *   - **anexos entram na versão** sem perder o vínculo com o rascunho.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const LINK = 'bl-1';
const DRAFT = 'bd-1';
const PROJECT = 'cp-1';

/** Respostas com todas as etapas obrigatórias (1, 2, 4, 9) preenchidas. */
const COMPLETO = {
  1: { company: 'EPG', segment: 'educacao' },
  2: { problem: 'p', expected: 'e', success: 's' },
  4: { kind: 'sistema_web' },
  9: { complexity: 'media', confirmed: true },
};

function row(over: Record<string, unknown> = {}) {
  return {
    link_id: LINK,
    expires_at: null,
    revoked_at: null,
    tenant_id: TENANT,
    client_project_id: PROJECT,
    draft_id: DRAFT,
    draft_answers: COMPLETO,
    draft_consumed_at: null,
    version_count: 0,
    ...over,
  };
}

interface FakeOpts {
  link?: Record<string, unknown>;
  existingVersion?: { id: string; version: number } | null;
  maxVersion?: number | null;
  createError?: unknown;
}

function prismaFake(opts: FakeOpts = {}): any {
  const tx: any = {
    briefingVersion: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _max: { version: opts.maxVersion ?? null } }),
      create: jest.fn(async ({ data }: any) => {
        if (opts.createError) throw opts.createError;
        return { id: 'bv-novo', version: data.version };
      }),
    },
    fileAsset: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    briefingDraft: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma: any = {
    briefingVersion: {
      findFirst: jest.fn().mockResolvedValue(opts.existingVersion ?? null),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([row(opts.link)]),
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    runInTenantContext: jest.fn(
      async (_ids: string[], fn: () => Promise<unknown>) => fn(),
    ),
    _tx: tx,
  };
  return prisma;
}

const clientsFake = () => ({ transition: jest.fn().mockResolvedValue({}) }) as any;
const eventsFake = () => ({ emit: jest.fn() }) as any;

describe('BriefingSubmitService (SPEC-031 §5)', () => {
  describe('envio válido', () => {
    it('grava a v1, emite o evento e devolve o id', async () => {
      const prisma = prismaFake();
      const events = eventsFake();
      const svc = new BriefingSubmitService(prisma, clientsFake(), events);

      const out = await svc.submit('tok', true);

      expect(out).toEqual({
        versionId: 'bv-novo',
        version: 1,
        alreadySubmitted: false,
      });
      // `tenantId` entrou no payload na SPEC-032 (§7.3): o consumidor é um JOB,
      // sem request, e sob RLS fail-closed um lookup dele devolveria zero
      // linhas. A alternativa era uma função `SECURITY DEFINER` nova para
      // recuperar um dado que o emissor já tem na mão — superfície privilegiada
      // sem necessidade. Mesmo padrão do `DocsSyncedEvent`.
      expect(events.emit).toHaveBeenCalledWith(BRIEFING_SUBMITTED, {
        clientProjectId: PROJECT,
        briefingVersionId: 'bv-novo',
        tenantId: TENANT,
      });
    });

    it('numera sequencial POR projeto: com v1 existente, nasce v2', async () => {
      const prisma = prismaFake({ maxVersion: 1, link: { version_count: 0 } });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      const out = await svc.submit('tok', true);

      expect(out.version).toBe(2);
    });

    it('prende os anexos à versão SEM soltar o rascunho (trilha do ADR-025)', async () => {
      const prisma = prismaFake();
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await svc.submit('tok', true);

      expect(prisma._tx.fileAsset.updateMany).toHaveBeenCalledWith({
        where: { briefingDraftId: DRAFT },
        data: { briefingVersionId: 'bv-novo' },
      });
      // `data` não mexe em briefingDraftId: o vínculo com o rascunho fica.
      const call = prisma._tx.fileAsset.updateMany.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('briefingDraftId');
    });

    it('marca o rascunho como consumido — não apaga a linha', async () => {
      const prisma = prismaFake();
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await svc.submit('tok', true);

      const call = prisma._tx.briefingDraft.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: DRAFT });
      expect(call.data.consumedAt).toBeInstanceOf(Date);
    });

    it('move o card para BRIEFING_SUBMITTED com ator NULO (transição de sistema)', async () => {
      const prisma = prismaFake();
      const clients = clientsFake();
      const svc = new BriefingSubmitService(prisma, clients, eventsFake());

      await svc.submit('tok', true);

      expect(clients.transition).toHaveBeenCalledWith(
        TENANT,
        PROJECT,
        { to: 'BRIEFING_SUBMITTED' },
        null,
      );
    });

    it('abre contexto de tenant antes de escrever (rota pública, sem sessão)', async () => {
      const prisma = prismaFake();
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await svc.submit('tok', true);

      expect(prisma.runInTenantContext).toHaveBeenCalledWith(
        [TENANT],
        expect.any(Function),
      );
    });
  });

  describe('idempotência: duplo clique não cria dois briefings', () => {
    it('link já enviado devolve a versão existente, não erro', async () => {
      const prisma = prismaFake({
        link: { version_count: 1 },
        existingVersion: { id: 'bv-1', version: 1 },
      });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      const out = await svc.submit('tok', true);

      expect(out).toEqual({
        versionId: 'bv-1',
        version: 1,
        alreadySubmitted: true,
      });
      expect(prisma._tx.briefingVersion.create).not.toHaveBeenCalled();
    });

    it('rascunho consumido também devolve a versão existente', async () => {
      const prisma = prismaFake({
        link: { draft_consumed_at: new Date() },
        existingVersion: { id: 'bv-1', version: 1 },
      });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      expect((await svc.submit('tok', true)).alreadySubmitted).toBe(true);
    });

    it('corrida: colisão no unique devolve a versão de quem venceu', async () => {
      // Dois submits simultâneos com o mesmo conteúdo. O segundo bate no
      // unique (briefing_link_id, content_hash) — é a idempotência funcionando
      // na camada do banco, não um erro a propagar.
      const prisma = prismaFake({
        createError: new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '5',
        }),
        existingVersion: { id: 'bv-vencedor', version: 1 },
      });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      const out = await svc.submit('tok', true);

      expect(out.versionId).toBe('bv-vencedor');
    });

    it('erro que NÃO é colisão propaga (não vira falso sucesso)', async () => {
      const prisma = prismaFake({ createError: new Error('banco fora') });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).rejects.toThrow('banco fora');
    });

    it('já enviado mas sem versão localizável responde 410 (estado impossível)', async () => {
      const prisma = prismaFake({
        link: { version_count: 1 },
        existingVersion: null,
      });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).rejects.toBeInstanceOf(GoneException);
    });
  });

  describe('a barreira é a API, não a tela', () => {
    it('recusa sem a confirmação da etapa 9', async () => {
      const prisma = prismaFake();
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', false)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma._tx.briefingVersion.create).not.toHaveBeenCalled();
    });

    it('recusa briefing incompleto, listando os campos que faltam', async () => {
      const prisma = prismaFake({
        link: { draft_answers: { 1: { company: 'EPG', segment: 'educacao' } } },
      });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).rejects.toMatchObject({
        response: { message: 'briefing incompleto' },
      });
      expect(prisma._tx.briefingVersion.create).not.toHaveBeenCalled();
    });

    it('recusa rascunho vazio', async () => {
      const prisma = prismaFake({ link: { draft_answers: null } });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('o link precisa aceitar escrita', () => {
    it('token inexistente responde 404', async () => {
      const prisma = prismaFake();
      prisma.$queryRaw = jest.fn().mockResolvedValue([]);
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('link revogado responde 410 e não grava', async () => {
      const prisma = prismaFake({ link: { revoked_at: new Date() } });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).rejects.toBeInstanceOf(GoneException);
      expect(prisma._tx.briefingVersion.create).not.toHaveBeenCalled();
    });

    it('link expirado responde 410', async () => {
      const prisma = prismaFake({ link: { expires_at: new Date(Date.now() - 1000) } });
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).rejects.toBeInstanceOf(GoneException);
    });
  });

  describe('o que NÃO pode desfazer um envio já gravado', () => {
    it('falha ao mover o card não derruba o submit', async () => {
      // O briefing é o dado do cliente; a posição do card é consequência dele.
      const prisma = prismaFake();
      const clients = clientsFake();
      clients.transition = jest.fn().mockRejectedValue(new Error('funil fora'));
      const svc = new BriefingSubmitService(prisma, clients, eventsFake());

      const out = await svc.submit('tok', true);

      expect(out.versionId).toBe('bv-novo');
    });

    it('falha no audit não derruba o submit', async () => {
      const prisma = prismaFake();
      prisma.auditEvent.create = jest.fn().mockRejectedValue(new Error('db down'));
      const svc = new BriefingSubmitService(prisma, clientsFake(), eventsFake());

      await expect(svc.submit('tok', true)).resolves.toMatchObject({
        versionId: 'bv-novo',
      });
    });
  });
});
