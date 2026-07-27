import { NotFoundException } from '@nestjs/common';
import { BriefingReadService } from './briefing-read.service';

/**
 * Leitura do briefing no painel (SPEC-031 §6).
 *
 * O que estes testes protegem:
 *
 *   - **o estado é o que a gaveta promete**: não iniciado · em preenchimento com
 *     progresso · recebido em *data*, e o progresso conta pela MESMA regra do
 *     formulário público (`completedStepCount`);
 *   - **rascunho de link revogado não vira progresso** — a linha fica no banco
 *     (spec §2), mas ninguém continua preenchendo por ela;
 *   - **os rótulos são resolvidos na leitura**: `G` vira "Comércio e varejo",
 *     e a versão NÃO é reescrita para isso (imutabilidade do §5);
 *   - **os bytes do anexo não vêm na listagem** — são até 25 MB por briefing;
 *   - **versão de outro tenant é 404, nunca 403**: 403 confirmaria a existência
 *     para quem sonda ids.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const PROJECT = 'cp-1';

/** Etapa 1 completa é o mínimo para `completedStepCount` contar 1. */
const STEP_1 = { company: 'Acme', segment: 'G', state: 'SP', city: '3550308' };

interface FakeOpts {
  project?: unknown;
  versions?: unknown[];
  draft?: unknown;
  version?: unknown;
  segment?: unknown;
  state?: unknown;
  city?: unknown;
}

function prismaFake(opts: FakeOpts = {}): any {
  return {
    clientProject: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          opts.project === undefined ? { id: PROJECT } : opts.project,
        ),
    },
    briefingVersion: {
      findMany: jest.fn().mockResolvedValue(opts.versions ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.version ?? null),
    },
    briefingDraft: {
      findFirst: jest.fn().mockResolvedValue(opts.draft ?? null),
    },
    segment: { findUnique: jest.fn().mockResolvedValue(opts.segment ?? null) },
    state: { findUnique: jest.fn().mockResolvedValue(opts.state ?? null) },
    city: { findUnique: jest.fn().mockResolvedValue(opts.city ?? null) },
  };
}

describe('BriefingReadService (SPEC-031 §6)', () => {
  describe('estado do briefing na gaveta', () => {
    it('sem rascunho e sem versão: não iniciado', async () => {
      const svc = new BriefingReadService(prismaFake());

      const out = await svc.getStatus(TENANT, PROJECT);

      expect(out.state).toBe('not_started');
      expect(out.completedSteps).toBeNull();
      expect(out.receivedAt).toBeNull();
      expect(out.versions).toEqual([]);
    });

    it('rascunho com 1 etapa válida: em preenchimento, com progresso', async () => {
      const svc = new BriefingReadService(
        prismaFake({ draft: { answers: { 1: STEP_1 } } }),
      );

      const out = await svc.getStatus(TENANT, PROJECT);

      expect(out.state).toBe('in_progress');
      expect(out.completedSteps).toBe(1);
      expect(out.totalSteps).toBe(9);
    });

    it('rascunho existe mas nenhuma etapa fechou: ainda não iniciado', async () => {
      // O caso real: só anexo enviado. O funil usa o mesmo critério — quem move
      // o card é o 1º save de etapa, não a criação da linha do rascunho.
      const svc = new BriefingReadService(prismaFake({ draft: { answers: {} } }));

      const out = await svc.getStatus(TENANT, PROJECT);

      expect(out.state).toBe('not_started');
      expect(out.completedSteps).toBeNull();
    });

    it('só considera rascunho de link ATIVO e não consumido', async () => {
      const prisma = prismaFake();
      const svc = new BriefingReadService(prisma);

      await svc.getStatus(TENANT, PROJECT);

      const { where } = prisma.briefingDraft.findFirst.mock.calls[0][0];
      expect(where.consumedAt).toBeNull();
      expect(where.briefingLink.revokedAt).toBeNull();
      expect(where.briefingLink.clientProjectId).toBe(PROJECT);
    });

    it('com versão enviada: recebido, com a data do envio mais recente', async () => {
      const older = new Date('2026-07-20T10:00:00Z');
      const newer = new Date('2026-07-26T10:00:00Z');
      const svc = new BriefingReadService(
        prismaFake({
          versions: [
            { id: 'v2', version: 2, submittedAt: newer },
            { id: 'v1', version: 1, submittedAt: older },
          ],
        }),
      );

      const out = await svc.getStatus(TENANT, PROJECT);

      expect(out.state).toBe('received');
      expect(out.receivedAt).toBe(newer);
      // v1 CONTINUA legível — regenerar o link cria v2, não sobrescreve (spec §5).
      expect(out.versions.map((v) => v.version)).toEqual([2, 1]);
    });

    it('projeto de outro tenant: 404', async () => {
      const svc = new BriefingReadService(prismaFake({ project: null }));

      await expect(svc.getStatus(TENANT, PROJECT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('o where do projeto carrega o tenant, não só o id', async () => {
      const prisma = prismaFake();
      const svc = new BriefingReadService(prisma);

      await svc.getStatus(TENANT, PROJECT);

      const { where } = prisma.clientProject.findFirst.mock.calls[0][0];
      expect(where.client.tenantId).toBe(TENANT);
      expect(where.deletedAt).toBeNull();
    });
  });

  describe('versão em leitura', () => {
    const version = {
      id: 'v1',
      version: 1,
      submittedAt: new Date('2026-07-26T10:00:00Z'),
      clientProjectId: PROJECT,
      answers: { 1: STEP_1, 2: { problem: 'p', expected: 'e', success: 's' } },
      files: [{ id: 'f1', name: 'logo.png', mime: 'image/png', size: 10 }],
    };

    it('devolve as respostas e os anexos, sem os bytes', async () => {
      const prisma = prismaFake({ version });
      const svc = new BriefingReadService(prisma);

      const out = await svc.getVersion(TENANT, 'v1');

      expect(out.answers).toEqual(version.answers);
      expect(out.attachments).toEqual(version.files);
      // Até 25 MB por briefing: a listagem não pode arrastar o `bytea`.
      const { select } = prisma.briefingVersion.findFirst.mock.calls[0][0];
      expect(select.files.select).not.toHaveProperty('bytes');
    });

    it('traduz segmento, estado e cidade para o rótulo escolhido na tela', async () => {
      const svc = new BriefingReadService(
        prismaFake({
          version,
          segment: { label: 'Comércio e varejo' },
          state: { name: 'São Paulo' },
          city: { name: 'São Paulo' },
        }),
      );

      const out = await svc.getVersion(TENANT, 'v1');

      expect(out.labels['1.segment']).toBe('Comércio e varejo');
      expect(out.labels['1.state']).toBe('São Paulo');
      expect(out.labels['1.city']).toBe('São Paulo');
      // O dado gravado NÃO muda: a versão é imutável, a tradução é de leitura.
      expect((out.answers['1'] as Record<string, unknown>).segment).toBe('G');
    });

    it('código sem correspondência não inventa rótulo', async () => {
      const svc = new BriefingReadService(prismaFake({ version }));

      const out = await svc.getVersion(TENANT, 'v1');

      expect(out.labels).toEqual({});
    });

    it('etapa 1 sem os códigos não consulta as tabelas de referência', async () => {
      const prisma = prismaFake({
        version: { ...version, answers: { 1: { company: 'Acme' } } },
      });
      const svc = new BriefingReadService(prisma);

      await svc.getVersion(TENANT, 'v1');

      expect(prisma.segment.findUnique).not.toHaveBeenCalled();
      expect(prisma.state.findUnique).not.toHaveBeenCalled();
      expect(prisma.city.findUnique).not.toHaveBeenCalled();
    });

    it('cidade não numérica não vira consulta com NaN', async () => {
      const prisma = prismaFake({
        version: { ...version, answers: { 1: { city: 'São Paulo' } } },
      });
      const svc = new BriefingReadService(prisma);

      await svc.getVersion(TENANT, 'v1');

      expect(prisma.city.findUnique).not.toHaveBeenCalled();
    });

    it('versão de outro tenant: 404, nunca 403', async () => {
      const svc = new BriefingReadService(prismaFake({ version: null }));

      await expect(svc.getVersion(TENANT, 'v1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('o where da versão sobe até o tenant pelo projeto', async () => {
      const prisma = prismaFake({ version });
      const svc = new BriefingReadService(prisma);

      await svc.getVersion(TENANT, 'v1');

      const { where } = prisma.briefingVersion.findFirst.mock.calls[0][0];
      expect(where.clientProject.client.tenantId).toBe(TENANT);
    });
  });
});
