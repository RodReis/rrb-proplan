import type { PrismaService } from '../../../prisma/prisma.service';
import type { LlmClientFactory, LlmUsageRecorder, UsageService } from '../../llm';
import type { ArtifactsJobData } from '../infrastructure/artifacts.worker';
import { InvalidArtifactError } from '../domain/capabilities';
import { ArtifactsService } from './artifacts.service';

const job: ArtifactsJobData = {
  clientProjectId: 'cp-1',
  briefingVersionId: 'bv-1',
  tenantId: 't-1',
};

const briefingOk = { id: 'bv-1', clientProjectId: 'cp-1', answers: { 1: {} } };

/** Saída válida por capacidade — o que um modelo bem-comportado devolveria. */
const RESPOSTAS: Record<string, unknown> = {
  artifact_normalize: { resumo: 'r', objetivo: 'o', publico: 'p', pontosNaoInformados: [] },
  artifact_scope: { entregaveis: ['site'], foraDeEscopo: [], premissas: [], riscos: [] },
  artifact_requirements: {
    requisitos: [{ titulo: 't', descricao: 'd', prioridade: 'essencial' }],
  },
  artifact_site_prompt: { prompt: 'p', referencias: [], observacoes: [] },
};

interface Cenario {
  briefing?: { id: string; clientProjectId: string; answers: unknown } | null;
  runExistente?: { id: string; status: string } | null;
  /** Quantas capacidades podem gastar antes de o teto estourar. */
  tetoAte?: number;
  /** Capacidade que falha na validação (nome do `kind` do ledger). */
  falhaEm?: string;
}

function montar({
  briefing = briefingOk,
  runExistente = null,
  tetoAte = Infinity,
  falhaEm,
}: Cenario = {}) {
  const versoes: Array<Record<string, unknown>> = [];
  let checagensDeTeto = 0;

  const prisma = {
    briefingVersion: { findUnique: jest.fn(async () => briefing ?? null) },
    artifactRun: {
      findFirst: jest.fn(async () => runExistente),
      create: jest.fn(async () => ({ id: 'run-1' })),
      update: jest.fn(async () => ({})),
    },
    artifact: {
      upsert: jest.fn(async ({ where }: { where: { clientProjectId_kind: { kind: string } } }) => ({
        id: `art-${where.clientProjectId_kind.kind}`,
      })),
      update: jest.fn(async () => ({})),
    },
    artifactVersion: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        versoes.push(data);
        return { id: `av-${versoes.length}` };
      }),
    },
  } as unknown as PrismaService;

  const chamadasLedger: Array<Record<string, unknown>> = [];
  const recorder = {
    runParsed: jest.fn(
      async (
        _client: unknown,
        _req: unknown,
        ctx: Record<string, unknown>,
        parse: (text: string) => unknown,
      ) => {
        chamadasLedger.push(ctx);
        if (falhaEm === ctx.kind) {
          throw new InvalidArtifactError('scope', 'campo "entregaveis" ausente ou vazio');
        }
        return parse(JSON.stringify(RESPOSTAS[ctx.kind as string]));
      },
    ),
  } as unknown as LlmUsageRecorder;

  const llmFactory = {
    create: jest.fn(() => ({ provider: 'anthropic', model: 'x', complete: jest.fn() })),
  } as unknown as LlmClientFactory;

  const usageGate = {
    canSpendForTenant: jest.fn(async (tenantId: string) => {
      // Recusa tenant inesperado em vez de devolver o mesmo valor para qualquer
      // argumento — a frouxidão que deixou a suíte do #158 verde sem provar de
      // quem era o teto.
      if (tenantId !== 't-1') throw new Error(`tenantId inesperado: ${tenantId}`);
      checagensDeTeto += 1;
      return checagensDeTeto <= tetoAte;
    }),
  } as unknown as UsageService;

  return {
    service: new ArtifactsService(prisma, llmFactory, recorder, usageGate),
    prisma,
    recorder,
    usageGate,
    versoes,
    chamadasLedger,
  };
}

describe('ArtifactsService: pipeline completo (SPEC-032 §2.2)', () => {
  it('gera os 4 artefatos, na ordem das capacidades', async () => {
    const { service, versoes } = montar();

    await service.runPipeline(job);

    expect(versoes.map((v) => v.promptVersion)).toEqual([
      'normalize@1',
      'scope@1',
      'requirements@1',
      'site_prompt@1',
    ]);
  });

  it('toda versão nasce com author "ai" e ligada ao run', async () => {
    const { service, versoes } = montar();

    await service.runPipeline(job);

    versoes.forEach((v) => {
      expect(v.author).toBe('ai');
      expect(v.artifactRunId).toBe('run-1');
      expect(v.tenantId).toBe('t-1');
    });
  });

  it('o artefato fica PENDING_REVIEW — o card NÃO se move aqui', async () => {
    // §2.7: o card só chega a ARTIFACTS_READY com os 4 APROVADOS, e nunca por
    // efeito do job. Este teste é a prova de que o pipeline não move nada.
    const { service, prisma } = montar();

    await service.runPipeline(job);

    const estados = (prisma.artifact.update as jest.Mock).mock.calls.map(
      (c) => c[0].data.state,
    );
    expect(estados).toEqual(Array(4).fill('PENDING_REVIEW'));
  });

  it('fecha o run como COMPLETED com os 4 kinds', async () => {
    const { service, prisma } = montar();

    await service.runPipeline(job);

    const ultima = (prisma.artifactRun.update as jest.Mock).mock.calls.at(-1)![0];
    expect(ultima.data.status).toBe('COMPLETED');
    expect(ultima.data.completedKinds).toEqual([
      'normalize',
      'scope',
      'requirements',
      'site_prompt',
    ]);
    expect(ultima.data.failureReason).toBeNull();
  });

  it('usa upsert no artefato, não create', async () => {
    // O artefato pode já existir de um run anterior que falhou depois dele.
    // `create` estouraria o UNIQUE (clientProjectId, kind) e transformaria
    // "tentar de novo" em erro.
    const { service, prisma } = montar();

    await service.runPipeline(job);

    expect(prisma.artifact.upsert).toHaveBeenCalledTimes(4);
  });
});

describe('ArtifactsService: ledger e teto (§2.6, §5)', () => {
  it('grava tenantId e artifactRunId em toda chamada ao ledger', async () => {
    // Critério de aceite §5. Sem `tenantId`, a linha nasce NULL e a policy do
    // llm_usage a trata como "do tenant ativo" — o gasto de um tenant apareceria
    // no teto de quem estivesse olhando.
    const { service, chamadasLedger } = montar();

    await service.runPipeline(job);

    expect(chamadasLedger).toHaveLength(4);
    chamadasLedger.forEach((ctx) => {
      expect(ctx.tenantId).toBe('t-1');
      expect(ctx.artifactRunId).toBe('run-1');
      // `projectId` NULO de propósito: o pipeline nasce de ClientProject, que
      // não é o `Project` (repo do GitHub) do ledger.
      expect(ctx.projectId).toBeNull();
      expect(ctx.inputHash).toEqual(expect.any(String));
    });
  });

  it('verifica o teto ANTES DE CADA capacidade, não só no gatilho', async () => {
    // 4 capacidades = 4 checagens. Checar só na entrada deixaria o run gastar as
    // quatro mesmo com o teto estourando na segunda.
    const { service, usageGate } = montar();

    await service.runPipeline(job);

    expect(usageGate.canSpendForTenant).toHaveBeenCalledTimes(4);
  });

  it('teto estourado na 3ª: guarda o parcial como FAILED', async () => {
    // Decisão 4 do PI (§8) e critério do §5: "os artefatos já gerados continuam
    // visíveis e aprováveis". Jogar fora trabalho já pago porque o 3º passo não
    // coube seria queimar dinheiro duas vezes.
    const { service, prisma, versoes } = montar({ tetoAte: 2 });

    await service.runPipeline(job);

    expect(versoes).toHaveLength(2);
    const ultima = (prisma.artifactRun.update as jest.Mock).mock.calls.at(-1)![0];
    expect(ultima.data.status).toBe('FAILED');
    expect(ultima.data.completedKinds).toEqual(['normalize', 'scope']);
    expect(ultima.data.failureReason).toMatch(/Teto de gasto/);
  });

  it('teto estourado no gatilho: nenhum artefato, run FAILED', async () => {
    const { service, versoes, prisma } = montar({ tetoAte: 0 });

    await service.runPipeline(job);

    expect(versoes).toHaveLength(0);
    const ultima = (prisma.artifactRun.update as jest.Mock).mock.calls.at(-1)![0];
    expect(ultima.data.status).toBe('FAILED');
  });
});

describe('ArtifactsService: falha de schema (§2.5)', () => {
  it('resposta que não valida deixa o run FAILED com motivo legível', async () => {
    const { service, prisma } = montar({ falhaEm: 'artifact_scope' });

    await service.runPipeline(job);

    const ultima = (prisma.artifactRun.update as jest.Mock).mock.calls.at(-1)![0];
    expect(ultima.data.status).toBe('FAILED');
    expect(ultima.data.failureReason).toMatch(/entregaveis/);
  });

  it('NÃO segue para a capacidade seguinte após a falha', async () => {
    // `requirements` consome `scope`. Gerá-lo sem ele produziria artefato
    // construído sobre um buraco — plausível e errado.
    const { service, versoes } = montar({ falhaEm: 'artifact_scope' });

    await service.runPipeline(job);

    expect(versoes.map((v) => v.promptVersion)).toEqual(['normalize@1']);
  });

  it('preserva o que já foi gerado antes da falha', async () => {
    const { service, prisma } = montar({ falhaEm: 'artifact_scope' });

    await service.runPipeline(job);

    const ultima = (prisma.artifactRun.update as jest.Mock).mock.calls.at(-1)![0];
    expect(ultima.data.completedKinds).toEqual(['normalize']);
  });
});

describe('ArtifactsService: guardas de entrada', () => {
  it('aborta quando o briefing não existe no tenant (RLS fail-closed)', async () => {
    const { service, prisma } = montar({ briefing: null });

    await service.runPipeline(job);

    expect(prisma.artifactRun.create).not.toHaveBeenCalled();
  });

  it('aborta quando o briefing pertence a outro ClientProject', async () => {
    const { service, prisma } = montar({
      briefing: { ...briefingOk, clientProjectId: 'cp-OUTRO' },
    });

    await service.runPipeline(job);

    expect(prisma.artifactRun.create).not.toHaveBeenCalled();
  });

  it('não cria segundo run para a mesma BriefingVersion (idempotência)', async () => {
    const { service, prisma } = montar({
      runExistente: { id: 'run-antigo', status: 'COMPLETED' },
    });

    await service.runPipeline(job);

    expect(prisma.artifactRun.create).not.toHaveBeenCalled();
  });

  it('um run FAILED não bloqueia nova execução', async () => {
    // Filtra RUNNING|COMPLETED de propósito: run que falhou por teto ou provedor
    // fora precisa poder ser refeito, senão o briefing fica preso para sempre.
    const { service, prisma } = montar();

    await service.runPipeline(job);

    const { where } = (prisma.artifactRun.findFirst as jest.Mock).mock.calls[0][0];
    expect(where.status).toEqual({ in: ['RUNNING', 'COMPLETED'] });
  });
});
