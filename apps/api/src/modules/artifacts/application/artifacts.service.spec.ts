import type { PrismaService } from '../../../prisma/prisma.service';
import type { ArtifactsJobData } from '../infrastructure/artifacts.worker';
import { ArtifactsService } from './artifacts.service';

const job: ArtifactsJobData = {
  clientProjectId: 'cp-1',
  briefingVersionId: 'bv-1',
  tenantId: 't-1',
};

interface Cenario {
  briefing?: { id: string; clientProjectId: string; answers: unknown } | null;
  runExistente?: { id: string; status: string } | null;
}

function montar({ briefing, runExistente = null }: Cenario) {
  const prisma = {
    briefingVersion: {
      findUnique: jest.fn(async () => briefing ?? null),
    },
    artifactRun: {
      findFirst: jest.fn(async () => runExistente),
      create: jest.fn(async () => ({ id: 'run-novo' })),
      update: jest.fn(async () => ({})),
    },
  } as unknown as PrismaService;
  return { service: new ArtifactsService(prisma), prisma };
}

const briefingOk = { id: 'bv-1', clientProjectId: 'cp-1', answers: { 1: {} } };

describe('ArtifactsService.runPipeline (SPEC-032 §2.2)', () => {
  it('abre o run quando o briefing existe e nada rodou antes', async () => {
    const { service, prisma } = montar({ briefing: briefingOk });

    await service.runPipeline(job);

    expect(prisma.artifactRun.create).toHaveBeenCalledTimes(1);
    const { data } = (prisma.artifactRun.create as jest.Mock).mock.calls[0][0];
    expect(data).toMatchObject({
      tenantId: 't-1',
      clientProjectId: 'cp-1',
      briefingVersionId: 'bv-1',
      status: 'RUNNING',
      completedKinds: [],
    });
  });

  it('fecha o run como COMPLETED (PR-2 não gera artefato)', async () => {
    // `completedKinds: []` diz a verdade sobre o que rodou. As capacidades
    // chegam no PR-3 — um run que se dissesse completo COM artefatos aqui
    // seria a mentira que esta fatia inteira existe para não produzir.
    const { service, prisma } = montar({ briefing: briefingOk });

    await service.runPipeline(job);

    const { data } = (prisma.artifactRun.update as jest.Mock).mock.calls[0][0];
    expect(data.status).toBe('COMPLETED');
    expect(data.finishedAt).toBeInstanceOf(Date);
  });

  it('aborta quando o briefing não existe no tenant (RLS fail-closed)', async () => {
    // Sob RLS, "não existe" e "existe em outro tenant" são a MESMA resposta —
    // e é isso que se quer. O que não se pode é seguir em frente: gravaria run
    // órfão e artefato vazio.
    const { service, prisma } = montar({ briefing: null });

    await service.runPipeline(job);

    expect(prisma.artifactRun.create).not.toHaveBeenCalled();
  });

  it('aborta quando o briefing pertence a outro ClientProject', async () => {
    // Evento corrompido ou briefing movido de projeto. Seguir em frente
    // penduraria o artefato no projeto errado — dado plausível e errado, que é
    // pior que dado ausente.
    const { service, prisma } = montar({
      briefing: { ...briefingOk, clientProjectId: 'cp-OUTRO' },
    });

    await service.runPipeline(job);

    expect(prisma.artifactRun.create).not.toHaveBeenCalled();
  });

  it('não cria segundo run para a mesma BriefingVersion (idempotência)', async () => {
    // Critério de aceite do §5: disparar o pipeline duas vezes para a mesma
    // versão não cria artefato duplicado. Esta é a 2ª barreira — a do banco,
    // que vale mesmo depois de o `jobId` sumir da fila no `removeOnComplete`.
    const { service, prisma } = montar({
      briefing: briefingOk,
      runExistente: { id: 'run-antigo', status: 'COMPLETED' },
    });

    await service.runPipeline(job);

    expect(prisma.artifactRun.create).not.toHaveBeenCalled();
  });

  it('um run FAILED não bloqueia nova execução', async () => {
    // `findFirst` filtra por RUNNING|COMPLETED de propósito: run que falhou
    // (teto estourado, provedor fora) precisa poder ser refeito, senão o
    // briefing fica preso para sempre por uma falha passageira.
    const { service, prisma } = montar({ briefing: briefingOk, runExistente: null });

    await service.runPipeline(job);

    const { where } = (prisma.artifactRun.findFirst as jest.Mock).mock.calls[0][0];
    expect(where.status).toEqual({ in: ['RUNNING', 'COMPLETED'] });
    expect(prisma.artifactRun.create).toHaveBeenCalled();
  });
});
