import type { Job } from 'bullmq';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ArtifactsService } from '../application/artifacts.service';
import { ArtifactsWorker, type ArtifactsJobData } from './artifacts.worker';

const job = {
  id: 'j1',
  data: { clientProjectId: 'cp-1', briefingVersionId: 'bv-1', tenantId: 't-1' },
} as Job<ArtifactsJobData>;

function montar() {
  const chamadas: string[] = [];
  const prisma = {
    runInTenantContext: jest.fn(async (tenantIds: string[], fn: () => Promise<void>) => {
      chamadas.push(`contexto:${tenantIds.join(',')}`);
      return fn();
    }),
  } as unknown as PrismaService;
  const artifacts = {
    runPipeline: jest.fn(async () => {
      chamadas.push('pipeline');
    }),
  } as unknown as ArtifactsService;
  return { worker: new ArtifactsWorker(artifacts, prisma), prisma, artifacts, chamadas };
}

describe('ArtifactsWorker: contexto de tenant no job (SPEC-032 §7.3)', () => {
  it('abre runInTenantContext com o tenant do job', async () => {
    const { worker, prisma } = montar();

    await worker.process(job);

    expect(prisma.runInTenantContext).toHaveBeenCalledWith(
      ['t-1'],
      expect.any(Function),
    );
  });

  it('o pipeline roda DENTRO do contexto, nunca antes', async () => {
    // A ordem é a regra inteira. Sob RLS fail-closed, uma query fora do
    // contexto não dá erro — dá ZERO LINHAS. Um pipeline que rodasse antes do
    // `set_config` gravaria nada e terminaria "com sucesso": exatamente a
    // classe de bug com 5 ocorrências nesta frente, duas encontradas só no
    // dogfooding, todas com a suíte verde.
    const { worker, chamadas } = montar();

    await worker.process(job);

    expect(chamadas).toEqual(['contexto:t-1', 'pipeline']);
  });

  it('repassa os dados do job ao pipeline', async () => {
    const { worker, artifacts } = montar();

    await worker.process(job);

    expect(artifacts.runPipeline).toHaveBeenCalledWith(job.data);
  });
});
