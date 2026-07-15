import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CanonicalService } from '../../canonical/application/canonical.service';
import { computeFreshness } from '../../catalog/domain/freshness';
import { ciIsRed } from '../../ingestion/domain/ci-status';
import { SettingsService } from '../../settings/application/settings.service';
import {
  assemblePortfolio,
  PortfolioInput,
  PortfolioRow,
  rankByRisk,
  Signal,
} from '../domain/portfolio';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Estados de deploy que contam como vermelho no radar (decisão 1 do PI). */
const DEPLOY_RED = new Set(['discordam', 'so_github_side']);

/**
 * Portfólio + Radar (SPEC-019, Fatia 14). Projeção de leitura cross-projeto
 * sobre os sinais já persistidos (staleness, cobertura, deploy, CI) — zero IA
 * (ADR-002), determinística. Não recomputa julgamento: só lê o cache e ordena
 * (ADR-001 — consome CanonicalService/SettingsService por interface pública).
 */
@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly canonical: CanonicalService,
  ) {}

  /**
   * Linhas do portfólio já ordenadas pelo radar, para os repos GERENCIADOS do
   * usuário (não o catálogo inteiro). Cada linha traz os 4 sinais crus e datados
   * + a contagem de vermelhos. Sem score composto (ADR-012).
   */
  async getPortfolio(userId: string): Promise<PortfolioRow[]> {
    const [projects, thresholdDays] = await Promise.all([
      this.prisma.project.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          owner: true,
          lastDocsCommitAt: true,
          lastCodeCommitAt: true,
          deployVerdict: true,
          deployObservedAt: true,
          ciStatus: true,
          ciConclusionUrl: true,
          ciObservedAt: true,
        },
      }),
      this.settings.thresholdDaysOf(userId),
    ]);

    const coverageRed = await this.canonical.coverageRedByProject(
      userId,
      projects.map((p) => p.id),
    );

    const inputs: PortfolioInput[] = projects.map((p) => {
      const fresh = computeFreshness(
        p.lastDocsCommitAt,
        p.lastCodeCommitAt,
        thresholdDays,
      );
      const stalenessDays = stalenessGapDays(
        p.lastDocsCommitAt,
        p.lastCodeCommitAt,
      );

      const staleness: Signal | null =
        p.lastDocsCommitAt || p.lastCodeCommitAt
          ? { red: fresh.stale, observedAt: dateIso(p.lastCodeCommitAt) }
          : null;

      const coverage: Signal | null = coverageRed.has(p.id)
        ? { red: true, observedAt: null }
        : { red: false, observedAt: null };

      const deploy: Signal | null = p.deployVerdict
        ? {
            red: DEPLOY_RED.has(p.deployVerdict),
            observedAt: dateIso(p.deployObservedAt),
          }
        : null;

      const ci: Signal | null = p.ciStatus
        ? { red: ciIsRed(p.ciStatus), observedAt: dateIso(p.ciObservedAt) }
        : null;

      return {
        projectId: p.id,
        name: p.name,
        owner: p.owner,
        stalenessDays,
        staleness,
        coverage,
        deploy,
        ci,
        // Slots peso-zero de 10/11 declarados, não calculados (decisão 3 do PI).
      };
    });

    return rankByRisk(assemblePortfolio(inputs));
  }
}

function dateIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Dias que o código está à frente dos docs (ADR-010); null se falta base. */
function stalenessGapDays(
  lastDocsCommitAt: Date | null,
  lastCodeCommitAt: Date | null,
): number | null {
  if (!lastDocsCommitAt || !lastCodeCommitAt) return null;
  const gap =
    (lastCodeCommitAt.getTime() - lastDocsCommitAt.getTime()) / MS_PER_DAY;
  return gap > 0 ? Math.round(gap) : 0;
}
