import {
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { transactionMock } from '../../../../test/prisma-transaction-mock';
import { BriefingDraftService } from './briefing-draft.service';

/**
 * Rascunho retomável (SPEC-031 §2).
 *
 * O que estes testes protegem, além do caminho feliz:
 *
 *   - **congelamento**: link revogado/expirado para de aceitar escrita, mas a
 *     linha do rascunho continua no banco (o critério de aceite pede a query
 *     que prova isso);
 *   - **não-diferencial**: token inválido e link alheio respondem igual;
 *   - **o 1º save move o card** com ator NULO — e só o primeiro.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const LINK = 'bl-1';
const PROJECT = 'cp-1';

/** Linha que a função SQL `resolve_briefing_draft` devolve. */
function row(over: Record<string, unknown> = {}) {
  return {
    link_id: LINK,
    expires_at: null,
    revoked_at: null,
    tenant_id: TENANT,
    client_project_id: PROJECT,
    project_state: 'LINK_SENT',
    draft_id: null,
    draft_step: null,
    draft_answers: null,
    draft_consumed_at: null,
    version_count: 0,
    ...over,
  };
}

function prismaFake(rows: unknown[] = [row()]): any {
  const prisma: any = {
    briefingDraft: {
      upsert: jest.fn().mockResolvedValue({ id: 'bd-1', step: 1, answers: {} }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue(rows),
    $transaction: transactionMock(() => prisma),
    // A rota pública não tem contexto de tenant: o service abre o dele depois
    // de descobrir o tenant pelo hash, como a `resolvePublic` da SPEC-029.
    runInTenantContext: jest.fn(async (_ids: string[], fn: () => Promise<unknown>) => fn()),
  };
  return prisma;
}

function clientsFake(): any {
  return { transition: jest.fn().mockResolvedValue({}) };
}

describe('BriefingDraftService (SPEC-031)', () => {
  describe('leitura pública do rascunho', () => {
    it('link novo sem rascunho abre na etapa 1, sem respostas', async () => {
      const svc = new BriefingDraftService(prismaFake(), clientsFake());
      const out = await svc.getPublicState('tok');

      expect(out.status).toBe('valid');
      expect(out.step).toBe(1);
      expect(out.answers).toEqual({});
    });

    it('link com rascunho retoma na etapa salva (outro aparelho)', async () => {
      const prisma = prismaFake([
        row({ draft_id: 'bd-1', draft_step: 4, draft_answers: { 1: { company: 'ACME' } } }),
      ]);
      const svc = new BriefingDraftService(prisma, clientsFake());
      const out = await svc.getPublicState('tok');

      expect(out.step).toBe(4);
      expect(out.answers).toEqual({ 1: { company: 'ACME' } });
    });

    it('token inexistente → invalid, sem vazar tenant nem projeto', async () => {
      const svc = new BriefingDraftService(prismaFake([]), clientsFake());
      const out = await svc.getPublicState('tok');

      expect(out.status).toBe('invalid');
      expect(JSON.stringify(out)).not.toContain(TENANT);
      expect(JSON.stringify(out)).not.toContain(PROJECT);
    });

    it('link revogado responde revoked e NÃO devolve as respostas', async () => {
      // Congelado: a tela mostra link inválido, e o conteúdo do rascunho não
      // pode vazar para quem abriu um link que o prestador já matou.
      const prisma = prismaFake([
        row({ revoked_at: new Date(), draft_id: 'bd-1', draft_step: 4, draft_answers: { 1: { company: 'ACME' } } }),
      ]);
      const svc = new BriefingDraftService(prisma, clientsFake());
      const out = await svc.getPublicState('tok');

      expect(out.status).toBe('revoked');
      expect(out.answers).toBeUndefined();
    });

    it('depois do envio responde submitted, sem formulário nem respostas', async () => {
      const prisma = prismaFake([
        row({ version_count: 1, draft_id: 'bd-1', draft_consumed_at: new Date(), draft_answers: { 1: {} } }),
      ]);
      const svc = new BriefingDraftService(prisma, clientsFake());
      const out = await svc.getPublicState('tok');

      expect(out.status).toBe('submitted');
      expect(out.answers).toBeUndefined();
    });
  });

  describe('salvar rascunho', () => {
    it('grava a etapa e devolve o progresso', async () => {
      const prisma = prismaFake();
      const svc = new BriefingDraftService(prisma, clientsFake());

      await svc.saveDraft('tok', 1, { company: 'ACME', segment: 'J' });

      expect(prisma.briefingDraft.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.briefingDraft.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ briefingLinkId: LINK });
      expect(call.create.answers).toEqual({ 1: { company: 'ACME', segment: 'J' } });
    });

    it('preserva as etapas já respondidas ao salvar outra', async () => {
      const prisma = prismaFake([
        row({ draft_id: 'bd-1', draft_step: 1, draft_answers: { 1: { company: 'ACME' } } }),
      ]);
      const svc = new BriefingDraftService(prisma, clientsFake());

      await svc.saveDraft('tok', 2, { problem: 'p', expected: 'e', success: 's' });

      const { update } = prisma.briefingDraft.upsert.mock.calls[0][0];
      expect(update.answers[1]).toEqual({ company: 'ACME' });
      expect(update.answers[2]).toEqual({ problem: 'p', expected: 'e', success: 's' });
    });

    it('etapa inválida → 422 e NADA é gravado', async () => {
      const prisma = prismaFake();
      const svc = new BriefingDraftService(prisma, clientsFake());

      await expect(svc.saveDraft('tok', 1, { company: '' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.briefingDraft.upsert).not.toHaveBeenCalled();
    });

    it('número de etapa fora de 1..9 → 422', async () => {
      const svc = new BriefingDraftService(prismaFake(), clientsFake());
      await expect(svc.saveDraft('tok', 99, {})).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('payload com tenantId é recusado (isolamento)', async () => {
      const prisma = prismaFake();
      const svc = new BriefingDraftService(prisma, clientsFake());

      await expect(
        svc.saveDraft('tok', 1, { company: 'A', segment: 'J', tenantId: 'outro' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(prisma.briefingDraft.upsert).not.toHaveBeenCalled();
    });
  });

  describe('congelamento: link que parou de valer não aceita escrita', () => {
    it('link revogado → 410 e nada é gravado (a linha continua no banco)', async () => {
      const prisma = prismaFake([row({ revoked_at: new Date() })]);
      const svc = new BriefingDraftService(prisma, clientsFake());

      await expect(
        svc.saveDraft('tok', 1, { company: 'A', segment: 'J' }),
      ).rejects.toBeInstanceOf(GoneException);
      expect(prisma.briefingDraft.upsert).not.toHaveBeenCalled();
    });

    it('link expirado → 410', async () => {
      const prisma = prismaFake([row({ expires_at: new Date(Date.now() - 1000) })]);
      const svc = new BriefingDraftService(prisma, clientsFake());

      await expect(
        svc.saveDraft('tok', 1, { company: 'A', segment: 'J' }),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('token inexistente → 404 não-diferencial', async () => {
      const svc = new BriefingDraftService(prismaFake([]), clientsFake());
      await expect(
        svc.saveDraft('tok', 1, { company: 'A', segment: 'J' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('briefing já enviado → 410, o formulário não reabre', async () => {
      const prisma = prismaFake([row({ version_count: 1 })]);
      const svc = new BriefingDraftService(prisma, clientsFake());

      await expect(
        svc.saveDraft('tok', 1, { company: 'A', segment: 'J' }),
      ).rejects.toBeInstanceOf(GoneException);
    });
  });

  describe('o 1º save move o card no funil', () => {
    it('rascunho novo em LINK_SENT dispara a transição com ator NULO', async () => {
      const prisma = prismaFake();
      const clients = clientsFake();
      const svc = new BriefingDraftService(prisma, clients);

      await svc.saveDraft('tok', 1, { company: 'ACME', segment: 'J' });

      expect(clients.transition).toHaveBeenCalledWith(
        TENANT,
        PROJECT,
        { to: 'BRIEFING_STARTED' },
        null, // transição de sistema: não há usuário por trás
      );
    });

    it('save seguinte NÃO move de novo (já está em BRIEFING_STARTED)', async () => {
      const prisma = prismaFake([
        row({ project_state: 'BRIEFING_STARTED', draft_id: 'bd-1', draft_step: 2, draft_answers: {} }),
      ]);
      const clients = clientsFake();
      const svc = new BriefingDraftService(prisma, clients);

      await svc.saveDraft('tok', 3, { audience: 'PMEs' });

      expect(clients.transition).not.toHaveBeenCalled();
    });

    it('move o card DENTRO do contexto de tenant (senão o RLS corta)', async () => {
      // Bug achado no dogfooding, não pelos testes: o `ClientsService` assume
      // que o contexto de tenant já está aberto (as rotas dele são
      // `/t/:tenant`, com interceptor). A rota pública não tem interceptor
      // nenhum, então chamar `transition` fora de `runInTenantContext` faz o
      // `findFirst` interno cair no RLS fail-closed, voltar null e virar 404 —
      // silenciosamente engolido. O card nunca saía de LINK_SENT.
      const prisma = prismaFake();
      const clients = clientsFake();
      const ordem: string[] = [];

      prisma.runInTenantContext.mockImplementation(
        async (_ids: string[], fn: () => Promise<unknown>) => {
          ordem.push('contexto:abre');
          const out = await fn();
          ordem.push('contexto:fecha');
          return out;
        },
      );
      clients.transition.mockImplementation(async () => {
        ordem.push('transition');
        return {};
      });

      const svc = new BriefingDraftService(prisma, clients);
      await svc.saveDraft('tok', 1, { company: 'ACME', segment: 'J' });

      // A transição tem de acontecer entre um abre e um fecha — nunca solta.
      const i = ordem.indexOf('transition');
      expect(i).toBeGreaterThan(-1);
      expect(ordem.slice(0, i)).toContain('contexto:abre');
      expect(ordem[i - 1]).toBe('contexto:abre');
    });

    it('falha ao mover o card NÃO perde o rascunho já gravado', async () => {
      // O rascunho é o dado do cliente; a posição do card é consequência.
      // Perder o que a pessoa digitou porque o funil recusou seria inverter a
      // importância das duas coisas.
      const prisma = prismaFake();
      const clients = clientsFake();
      clients.transition.mockRejectedValue(new Error('funil recusou'));
      const svc = new BriefingDraftService(prisma, clients);

      await expect(
        svc.saveDraft('tok', 1, { company: 'ACME', segment: 'J' }),
      ).resolves.toBeDefined();
      expect(prisma.briefingDraft.upsert).toHaveBeenCalled();
    });
  });
});
