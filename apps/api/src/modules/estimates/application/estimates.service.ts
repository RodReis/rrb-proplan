import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../../clients/application/clients.service';
import {
  MIN_RUNS_PARA_PROJECAO,
  calcular,
  complexityOf,
  projetarCustoDeIa,
  type DirectCost,
} from '../domain/calculation';
import type { EffortTask } from '../domain/effort-estimator';

export interface GenerateInput {
  /** Custos diretos digitados à mão nesta fatia (§2.7) — sem catálogo. */
  directCosts?: DirectCost[];
  /**
   * Projeção de custo de IA digitada, usada **só** quando o tenant tem menos de
   * 3 runs concluídos (§2.8). Com histórico, o valor é calculado e este é
   * ignorado — aceitar os dois deixaria o número exibido dependendo de qual
   * caminho o código tomou.
   */
  aiCostProjectedUsd?: string;
}

/**
 * O CÁLCULO persistido (SPEC-033 §2.4-§2.12).
 *
 * A regra que organiza o service: **nada aqui vem de um modelo de linguagem**. A
 * IA já decompôs (`effort_breakdown`); daqui em diante são somas, multiplicações
 * e um snapshot — e é isso que faz cada número mostrar a sua conta.
 *
 * `Estimate` é **imutável por versão**: reestimar cria linha nova. Nunca existe
 * `update` de resultado aqui — só o `approve`, que carimba quem e quando.
 */
@Injectable()
export class EstimatesService {
  private readonly logger = new Logger(EstimatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  /**
   * Calcula e grava uma versão nova (§2.10).
   *
   * Exige a versão **corrente** do `effort_breakdown` aprovada (§5): calcular
   * sobre decomposição não revisada produziria um preço com a mesma aparência de
   * um conferido.
   */
  async generate(
    tenantId: string,
    clientProjectId: string,
    actorUserId: string,
    input: GenerateInput = {},
  ) {
    const projeto = await this.buscarProjeto(tenantId, clientProjectId);
    const effort = await this.exigirEffortAprovado(tenantId, clientProjectId);
    const settings = await this.parametros(tenantId);

    const tarefas = tarefasDe(effort.content);
    if (tarefas.length === 0) {
      throw new UnprocessableEntityException(
        'A decomposição aprovada não tem nenhuma tarefa utilizável.',
      );
    }

    const complexity = complexityOf(projeto.answers);
    const incorrido = await this.custoDeIaDoProjeto(tenantId, clientProjectId);
    const projetado = await this.projecaoDeIa(tenantId, input.aiCostProjectedUsd);

    const resultado = calcular({
      tarefas,
      complexity,
      hourlyRateBrl: settings.hourlyRateBrl,
      contingencyPercent: settings.contingencyPercent,
      directCosts: input.directCosts ?? [],
      aiCostIncurredUsd: incorrido,
      aiCostProjectedUsd: projetado.valor,
      aiCostProjectedIsCalculated: projetado.calculada,
      exchangeRate: settings.exchangeRateUsdBrl,
    });

    const version = await this.proximaVersao(clientProjectId);

    const estimate = await this.prisma.estimate.create({
      data: {
        tenantId,
        clientProjectId,
        version,
        effortVersionId: effort.id,
        // Snapshot dos parâmetros: a linha guarda a conta que foi feita, não uma
        // referência que pode mudar. Sem isso, editar o valor/hora do tenant
        // recalcularia em silêncio uma proposta já enviada ao cliente.
        hourlyRateBrl: settings.hourlyRateBrl,
        contingencyPercent: settings.contingencyPercent,
        complexity,
        complexityFactor: new Prisma.Decimal(resultado.complexityFactor),
        exchangeRate: settings.exchangeRateUsdBrl,
        exchangeRateAt: settings.exchangeRateAt,
        directCosts: (input.directCosts ?? []) as unknown as Prisma.InputJsonValue,
        aiCostIncurredUsd: incorrido,
        aiCostProjected: resultado.aiCost.projected as unknown as Prisma.InputJsonValue,
        scenarios: resultado.scenarios as unknown as Prisma.InputJsonValue,
        mvpBreakdown: resultado.mvpBreakdown as unknown as Prisma.InputJsonValue,
        createdBy: actorUserId,
      },
      select: { id: true, version: true },
    });

    this.logger.log(
      `Estimativa v${estimate.version} gerada para o projeto ${clientProjectId} ` +
        `(${tarefas.length} tarefas, complexidade ${complexity})`,
    );

    return this.byId(tenantId, estimate.id);
  }

  /** Versões da estimativa, mais recente primeiro (§6). */
  async list(tenantId: string, clientProjectId: string) {
    await this.buscarProjeto(tenantId, clientProjectId);

    const rows = await this.prisma.estimate.findMany({
      where: { clientProjectId, tenantId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        complexity: true,
        approvedAt: true,
        approvedBy: true,
        createdAt: true,
        createdBy: true,
        scenarios: true,
      },
    });

    return {
      estimates: rows.map((r) => ({
        ...r,
        // Só o total do provável na lista — a conta inteira vem no detalhe. A
        // lista responde "qual versão eu quero ver", não "qual é o preço".
        totalProvavelBrl: totalProvavelDe(r.scenarios),
      })),
    };
  }

  /** Uma versão, com a conta inteira. */
  async byId(tenantId: string, estimateId: string) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { id: estimateId, tenantId },
      select: {
        id: true,
        version: true,
        clientProjectId: true,
        effortVersionId: true,
        hourlyRateBrl: true,
        contingencyPercent: true,
        complexity: true,
        complexityFactor: true,
        exchangeRate: true,
        exchangeRateAt: true,
        directCosts: true,
        aiCostIncurredUsd: true,
        aiCostProjected: true,
        scenarios: true,
        mvpBreakdown: true,
        approvedAt: true,
        approvedBy: true,
        createdAt: true,
        createdBy: true,
      },
    });
    if (!estimate) throw new NotFoundException('Estimativa não encontrada');

    return {
      ...estimate,
      // `Decimal` vira string na fronteira HTTP: serializado como número, um
      // valor com muitas casas perderia precisão exatamente no dado que a fatia
      // existe para manter exato.
      hourlyRateBrl: estimate.hourlyRateBrl.toString(),
      contingencyPercent: estimate.contingencyPercent.toString(),
      complexityFactor: estimate.complexityFactor.toString(),
      exchangeRate: estimate.exchangeRate?.toString() ?? null,
      aiCostIncurredUsd: estimate.aiCostIncurredUsd.toString(),
    };
  }

  /**
   * Aprova a estimativa e move o card `ARTIFACTS_READY → CONTRACT_PENDING`
   * (§2.11).
   *
   * **É o único "aprovar" desta fatia que move o card** — o do
   * `effort_breakdown` é aprovação de artefato comum e não move nada (§7.1). Se
   * os dois botões parecerem o mesmo na tela, a decisão do PI vira ambígua na
   * prática; por isso a rota, o método e os rótulos são distintos.
   *
   * Ator **nunca nulo**: aqui há uma pessoa decidindo o preço que vai ao
   * cliente, e a trilha precisa dizer quem.
   */
  async approve(tenantId: string, estimateId: string, actorUserId: string) {
    const estimate = await this.prisma.estimate.findFirst({
      where: { id: estimateId, tenantId },
      select: { id: true, clientProjectId: true, approvedAt: true, version: true },
    });
    if (!estimate) throw new NotFoundException('Estimativa não encontrada');

    if (estimate.approvedAt) {
      // Idempotente e não erro: dois cliques no mesmo botão não são um problema
      // a reportar. O que não pode é o segundo tentar mover o card de novo.
      return { approved: true, cardMoved: false, alreadyApproved: true };
    }

    await this.prisma.estimate.update({
      where: { id: estimate.id },
      data: { approvedAt: new Date(), approvedBy: actorUserId },
    });

    let cardMoved = false;
    try {
      await this.clients.transition(
        tenantId,
        estimate.clientProjectId,
        { to: 'CONTRACT_PENDING' },
        actorUserId,
      );
      cardMoved = true;
    } catch (err) {
      // A transição pode ser recusada pela máquina de estados (card já adiante,
      // por exemplo). Isso NÃO pode desfazer a aprovação, que já está gravada e
      // é o ato que a pessoa pediu — mesmo desenho do `ArtifactReviewService`.
      this.logger.warn(
        `Estimativa ${estimate.id} aprovada, mas a transição falhou: ` +
          `${err instanceof Error ? err.message : err}`,
      );
    }

    return { approved: true, cardMoved, alreadyApproved: false };
  }

  /**
   * Custo de IA **consumido**: soma do LEDGER pelos runs deste projeto (§2.8).
   *
   * Nunca derivado de `ArtifactVersion` — é literalmente o que o ADR-016 proíbe:
   * o ledger é a fonte do gasto, o artefato é o produto.
   */
  private async custoDeIaDoProjeto(
    tenantId: string,
    clientProjectId: string,
  ): Promise<Prisma.Decimal> {
    const runs = await this.prisma.artifactRun.findMany({
      where: { clientProjectId, tenantId },
      select: { id: true },
    });
    if (runs.length === 0) return new Prisma.Decimal(0);

    const agg = await this.prisma.llmUsage.aggregate({
      where: { artifactRunId: { in: runs.map((r) => r.id) } },
      _sum: { costUsd: true },
    });
    // `null` vira zero aqui, e a diferença some de propósito: "nenhuma chamada"
    // e "chamadas sem preço cadastrado" custaram, ambas, R$ 0,00 de fato
    // conhecido. O que NÃO se faz é inventar um valor para a segunda.
    return agg._sum.costUsd ?? new Prisma.Decimal(0);
  }

  /**
   * Custo de IA **previsto** (§2.8): média por `ArtifactRun` concluído do
   * tenant, com piso de 3 runs; abaixo disso, o valor digitado.
   */
  private async projecaoDeIa(
    tenantId: string,
    digitado: string | undefined,
  ): Promise<{ valor: Prisma.Decimal; calculada: boolean }> {
    const concluidos = await this.prisma.artifactRun.findMany({
      where: { tenantId, status: 'COMPLETED' },
      select: { id: true },
    });

    if (concluidos.length >= MIN_RUNS_PARA_PROJECAO) {
      const agg = await this.prisma.llmUsage.aggregate({
        where: { artifactRunId: { in: concluidos.map((r) => r.id) } },
        _sum: { costUsd: true },
      });
      const media = projetarCustoDeIa(
        agg._sum.costUsd ?? new Prisma.Decimal(0),
        concluidos.length,
      );
      if (media) return { valor: media, calculada: true };
    }

    // Histórico insuficiente: cai no campo manual. Ausente, zero — e a tela
    // rotula "projeção não calculada — histórico insuficiente".
    return { valor: new Prisma.Decimal(digitado ?? 0), calculada: false };
  }

  /** Parâmetros do tenant, criando a linha padrão se faltar (§2.6). */
  private async parametros(tenantId: string) {
    return this.prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
      select: {
        hourlyRateBrl: true,
        contingencyPercent: true,
        exchangeRateUsdBrl: true,
        exchangeRateAt: true,
      },
    });
  }

  /** Sequencial por projeto — v1, v2..., como as demais versões da casa. */
  private async proximaVersao(clientProjectId: string): Promise<number> {
    const ultima = await this.prisma.estimate.findFirst({
      where: { clientProjectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (ultima?.version ?? 0) + 1;
  }

  private async buscarProjeto(tenantId: string, clientProjectId: string) {
    const projeto = await this.prisma.clientProject.findFirst({
      where: { id: clientProjectId, client: { tenantId } },
      select: {
        id: true,
        state: true,
        briefingVersions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { answers: true },
        },
      },
    });
    if (!projeto) throw new NotFoundException('Projeto não encontrado');
    return { ...projeto, answers: projeto.briefingVersions[0]?.answers ?? null };
  }

  /**
   * A versão **corrente** do `effort_breakdown`, exigindo o artefato `APPROVED`
   * (§5).
   *
   * Corrente e não "a da IA": se um humano editou as horas, é a edição dele que
   * vale — calcular sobre a versão da IA descartaria a correção sem avisar, e o
   * preço sairia diferente do que a pessoa viu ao aprovar.
   */
  private async exigirEffortAprovado(tenantId: string, clientProjectId: string) {
    const artifact = await this.prisma.artifact.findFirst({
      where: { clientProjectId, tenantId, kind: 'effort_breakdown' },
      select: { id: true, state: true, currentVersionId: true },
    });
    if (!artifact || artifact.state !== 'APPROVED' || !artifact.currentVersionId) {
      throw new UnprocessableEntityException(
        'A decomposição de esforço precisa estar aprovada antes de calcular a estimativa.',
      );
    }
    const version = await this.prisma.artifactVersion.findFirst({
      where: { id: artifact.currentVersionId, tenantId },
      select: { id: true, content: true },
    });
    if (!version) {
      throw new UnprocessableEntityException(
        'Versão corrente da decomposição não encontrada.',
      );
    }
    return version;
  }
}

/**
 * Extrai as tarefas do `content`, defensivamente.
 *
 * O conteúdo vem do `jsonb` e **pode ter sido editado à mão** (§2.10 da
 * SPEC-032) — edição humana não passa pelo schema da capacidade. Item fora do
 * formato é **descartado**, não corrigido: adivinhar o que um campo malformado
 * queria dizer produziria horas inventadas dentro de um cálculo que existe
 * justamente para não ter nenhuma.
 */
function tarefasDe(content: unknown): EffortTask[] {
  if (typeof content !== 'object' || content === null) return [];
  const lista = (content as Record<string, unknown>).tarefas;
  if (!Array.isArray(lista)) return [];

  const out: EffortTask[] = [];
  for (const item of lista) {
    if (typeof item !== 'object' || item === null) continue;
    const t = item as Record<string, unknown>;
    const min = Number(t.horasMin);
    const provavel = Number(t.horasProvavel);
    const max = Number(t.horasMax);
    if (![min, provavel, max].every((n) => Number.isFinite(n) && n > 0)) continue;
    out.push({
      requisito: String(t.requisito ?? ''),
      tarefa: String(t.tarefa ?? ''),
      horasMin: min,
      horasProvavel: provavel,
      horasMax: max,
      // Tarefa editada à mão sem grupo cai num balde nomeado em vez de sumir do
      // agrupamento: some do MVP, não do orçamento.
      mvp: String(t.mvp ?? 'sem MVP'),
    });
  }
  return out;
}

/** O total do cenário provável, para a lista. `null` se o `jsonb` não tiver. */
function totalProvavelDe(scenarios: unknown): string | null {
  if (typeof scenarios !== 'object' || scenarios === null) return null;
  const provavel = (scenarios as Record<string, unknown>).provavel;
  if (typeof provavel !== 'object' || provavel === null) return null;
  const total = (provavel as Record<string, unknown>).totalBrl;
  return typeof total === 'string' ? total : null;
}
