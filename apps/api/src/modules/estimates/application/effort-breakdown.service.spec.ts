import type { PrismaService } from '../../../prisma/prisma.service';
import type { ArtifactsService } from '../../artifacts/application/artifacts.service';
import type { LlmClientFactory, LlmUsageRecorder, UsageService } from '../../llm';
import { EffortBreakdownService } from './effort-breakdown.service';

/** Uma decomposição válida — o que um modelo bem-comportado devolveria. */
const RESPOSTA_OK = {
  tarefas: [
    {
      requisito: 'Login com Google',
      tarefa: 'Configurar OAuth',
      horasMin: 4,
      horasProvavel: 6,
      horasMax: 10,
      mvp: 'MVP1',
    },
  ],
};

const REQUIREMENTS = {
  requisitos: [
    { titulo: 'Login com Google', descricao: 'd', prioridade: 'essencial' },
    { titulo: 'Painel do cliente', descricao: 'd', prioridade: 'importante' },
  ],
};

interface Cenario {
  state?: string;
  requirementsState?: string | null;
  temBriefing?: boolean;
  podeGastar?: boolean;
  /** Erro lançado pelo `runParsed` — simula schema inválido ou provedor fora. */
  erroDoModelo?: Error;
  respostaDoModelo?: unknown;
}

function montar({
  state = 'ARTIFACTS_READY',
  requirementsState = 'APPROVED',
  temBriefing = true,
  podeGastar = true,
  erroDoModelo,
  respostaDoModelo = RESPOSTA_OK,
}: Cenario = {}) {
  const versoesGravadas: Array<Record<string, unknown>> = [];
  const runsFechados: Array<{ status: string; motivo: string | null }> = [];

  const prisma = {
    clientProject: { findFirst: jest.fn(async () => (state ? { id: 'cp-1', state } : null)) },
    briefingVersion: {
      findFirst: jest.fn(async () => (temBriefing ? { id: 'bv-1' } : null)),
    },
    artifact: {
      findFirst: jest.fn(async () =>
        requirementsState
          ? { id: 'art-req', state: requirementsState, currentVersionId: 'av-req' }
          : null,
      ),
    },
    artifactVersion: {
      findFirst: jest.fn(async () => ({ id: 'av-req', content: REQUIREMENTS })),
    },
    artifactRun: {
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 2),
    },
  } as unknown as PrismaService;

  const artifacts = {
    openExternalRun: jest.fn(async () => 'run-est-1'),
    closeExternalRun: jest.fn(async (_id: string, status: string, _k: unknown, motivo: string | null) => {
      runsFechados.push({ status, motivo });
    }),
    saveExternalVersion: jest.fn(async (input: Record<string, unknown>) => {
      versoesGravadas.push(input);
      return { artifactId: 'art-eff', versionId: 'av-eff', version: 1 };
    }),
  } as unknown as ArtifactsService;

  const recorder = {
    runParsed: jest.fn(
      async (
        _client: unknown,
        _req: unknown,
        _ctx: unknown,
        parse: (text: string) => unknown,
      ) => {
        if (erroDoModelo) throw erroDoModelo;
        return parse(JSON.stringify(respostaDoModelo));
      },
    ),
  } as unknown as LlmUsageRecorder;

  const llmFactory = {
    create: jest.fn(() => ({ provider: 'anthropic' })),
  } as unknown as LlmClientFactory;

  const usageGate = {
    canSpendForTenant: jest.fn(async () => podeGastar),
  } as unknown as UsageService;

  const service = new EffortBreakdownService(prisma, artifacts, llmFactory, recorder, usageGate);
  return { service, prisma, artifacts, recorder, usageGate, versoesGravadas, runsFechados };
}

describe('EffortBreakdownService: o gate do §2.2', () => {
  it.each([
    'BRIEFING_SUBMITTED',
    'DRAFT',
    'CONTRACT_PENDING',
    'IN_PRODUCTION',
  ])('recusa gerar com o projeto em %s, com motivo legível', async (state) => {
    const { service } = montar({ state });
    await expect(service.assertCanGenerate('t-1', 'cp-1')).rejects.toThrow(
      /4 artefatos aprovados/,
    );
  });

  it('aceita com o projeto em ARTIFACTS_READY', async () => {
    const { service } = montar();
    await expect(service.assertCanGenerate('t-1', 'cp-1')).resolves.toBeUndefined();
  });

  it.each([
    ['rejeitado', 'REJECTED'],
    ['em revisão', 'PENDING_REVIEW'],
    ['inexistente', null],
  ])('recusa gerar com o requirements %s', async (_caso, requirementsState) => {
    // Decompor requisito não aprovado é trabalho descartável — e pago.
    const { service } = montar({ requirementsState });
    await expect(service.assertCanGenerate('t-1', 'cp-1')).rejects.toThrow(
      /requisitos precisam estar aprovados/,
    );
  });

  it('não chama o modelo quando o gate recusa', async () => {
    const { service, recorder } = montar({ state: 'DRAFT' });
    await expect(service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' })).rejects.toThrow();
    expect(recorder.runParsed).not.toHaveBeenCalled();
  });
});

describe('EffortBreakdownService: geração', () => {
  it('grava a decomposição como versão de artefato', async () => {
    const { service, versoesGravadas } = montar();
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });

    expect(versoesGravadas).toHaveLength(1);
    expect(versoesGravadas[0]).toMatchObject({
      kind: 'effort_breakdown',
      promptVersion: expect.stringContaining('effort_breakdown@'),
      artifactRunId: 'run-est-1',
    });
  });

  it('fecha o run como COMPLETED e nomeia a capacidade', async () => {
    const { service, artifacts } = montar();
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });
    expect(artifacts.closeExternalRun).toHaveBeenCalledWith(
      'run-est-1',
      'COMPLETED',
      ['effort_breakdown'],
      null,
    );
  });

  it('decompõe a versão CORRENTE dos requisitos, mesmo editada à mão', async () => {
    // §2.10 da SPEC-032: a versão corrente pode ser `human`. Decompor a da IA
    // ignoraria a correção e geraria tarefa para requisito que deixou de existir.
    const { service, prisma, recorder } = montar();
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });
    expect(prisma.artifactVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'av-req' }) }),
    );
    const user = (recorder.runParsed as jest.Mock).mock.calls[0][1].user as string;
    expect(user).toContain('Login com Google');
  });

  it('anota requisito sem tarefa em vez de recusar o artefato', async () => {
    // "Painel do cliente" não recebeu tarefa. Recusar tudo jogaria fora a outra
    // tarefa boa, pagando o modelo de novo por ela — o desenho é o do revisor:
    // anota, não bloqueia.
    const { service, versoesGravadas } = montar();
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });
    expect(versoesGravadas[0].content).toMatchObject({
      requisitosSemTarefa: ['Painel do cliente'],
    });
  });

  it('o conteúdo gravado não tem total nenhum — a IA decompõe, o código calcula', async () => {
    const { service, versoesGravadas } = montar({
      respostaDoModelo: { ...RESPOSTA_OK, totalHoras: 999, precoBrl: 50000 },
    });
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });
    const content = versoesGravadas[0].content as Record<string, unknown>;
    expect(content).not.toHaveProperty('totalHoras');
    expect(content).not.toHaveProperty('precoBrl');
  });
});

describe('EffortBreakdownService: falha e teto', () => {
  it('não chama o modelo com o teto estourado', async () => {
    const { service, recorder } = montar({ podeGastar: false });
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });
    expect(recorder.runParsed).not.toHaveBeenCalled();
  });

  it('teto estourado fecha o run como FAILED com motivo legível', async () => {
    const { service, runsFechados } = montar({ podeGastar: false });
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });
    expect(runsFechados).toEqual([
      { status: 'FAILED', motivo: expect.stringContaining('Teto de gasto') },
    ]);
  });

  it('schema inválido fecha o run como FAILED e NÃO grava versão', async () => {
    // Artefato pela metade é pior que artefato nenhum: ninguém o revisa com
    // desconfiança.
    const { service, runsFechados, versoesGravadas } = montar({
      erroDoModelo: new Error('Resposta inválida para "effort_breakdown": JSON malformado'),
    });
    await service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' });
    expect(versoesGravadas).toHaveLength(0);
    expect(runsFechados[0]).toMatchObject({ status: 'FAILED' });
    expect(runsFechados[0].motivo).toContain('JSON malformado');
  });

  it('a falha não derruba a request — o motivo fica no run', async () => {
    const { service } = montar({ erroDoModelo: new Error('provedor fora') });
    await expect(
      service.generate({ tenantId: 't-1', clientProjectId: 'cp-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('EffortBreakdownService: a chave da fila', () => {
  it('conta TODOS os runs do projeto, não só os que concluíram', async () => {
    // Filtrar por `completedKinds has effort_breakdown` reintroduziria o bug do
    // dogfooding da Fatia 21: run FAILED fecha com a lista vazia, não entraria
    // na conta, e a tentativa seguinte reusaria a chave — o job retido em
    // `completed` no Redis engoliria o clique em silêncio.
    const { service, prisma } = montar();
    expect(await service.nextAttempt('t-1', 'cp-1')).toBe(3);
    expect(prisma.artifactRun.count).toHaveBeenCalledWith({
      where: { clientProjectId: 'cp-1', tenantId: 't-1' },
    });
  });

  it('contagem que falha não impede o disparo', async () => {
    const { service, prisma } = montar();
    (prisma.artifactRun.count as jest.Mock).mockRejectedValueOnce(new Error('db fora'));
    // Perde a numeração legível, mantém a chave única. Barrar o botão porque a
    // query de um detalhe de fila falhou trocaria um problema pequeno por um
    // grande.
    expect(await service.nextAttempt('t-1', 'cp-1')).toBeGreaterThan(1000);
  });
});

describe('EffortBreakdownService: leitura', () => {
  it('devolve o kind mesmo sem nunca ter rodado — ausência é informação', async () => {
    const { service, prisma } = montar();
    (prisma.artifact.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const out = await service.read('t-1', 'cp-1');
    expect(out.artifact).toEqual({ kind: 'effort_breakdown', state: null, versions: [] });
  });

  it('canGenerate segue o estado do card, resolvido no servidor', async () => {
    const { service } = montar({ state: 'BRIEFING_SUBMITTED' });
    expect((await service.read('t-1', 'cp-1')).canGenerate).toBe(false);
  });

  it('canGenerate é verdadeiro em ARTIFACTS_READY', async () => {
    const { service } = montar();
    expect((await service.read('t-1', 'cp-1')).canGenerate).toBe(true);
  });

  it('ignora o run do pipeline original — ele não diz nada sobre a decomposição', async () => {
    const { service, prisma } = montar();
    (prisma.artifactRun.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'run-pipeline',
      status: 'COMPLETED',
      completedKinds: ['normalize', 'scope', 'requirements', 'site_prompt'],
      failureReason: null,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    expect((await service.read('t-1', 'cp-1')).run).toBeNull();
  });

  it('projeto de outro tenant devolve não-encontrado', async () => {
    const { service, prisma } = montar();
    (prisma.clientProject.findFirst as jest.Mock).mockResolvedValueOnce(null);
    await expect(service.read('t-1', 'cp-outro')).rejects.toThrow('Projeto não encontrado');
  });
});
