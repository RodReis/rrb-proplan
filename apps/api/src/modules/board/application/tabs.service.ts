import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, Resolution } from '../../ingestion/domain/entity';
import { InsightService } from '../../insight/application/insight.service';
import { parseDecisions } from '../domain/decisions-index';
import { parseDeploy } from '../domain/deploy-doc';
import { parseSkills } from '../domain/skills-index';
import { parseWorkflow, WorkflowInfo } from '../domain/workflow-parser';

export interface TabSource {
  level: 1 | 2 | 3 | 4;
  source: Resolution['source'];
  path: string | null;
  paths: string[];
  confidence: number;
}
export interface TabResponse {
  source: TabSource;
  payload: unknown | null;
}

@Injectable()
export class TabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: ResolutionService,
    private readonly insight: InsightService,
  ) {}

  /** Ownership: mesmo padrão do BoardService — findFirst por id+userId. */
  async assertOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }

  async getTab(projectId: string, tab: Entity): Promise<TabResponse> {
    const r = await this.ingestion.resolutionOf(projectId, tab);
    const source: TabSource = {
      level: r.level, source: r.source, path: r.path, paths: r.paths, confidence: r.confidence,
    };
    if (r.level === 4) {
      if (tab === 'testing') {
        const ci = await this.ciFallback(projectId);
        if (ci.workflows.length > 0) return { source, payload: { ci, inferred: true } };
      }
      return { source, payload: null };
    }

    // Nível 3 (inference, ADR-014): anexa aviso + spans que justificam a
    // classificação da IA (ADR-012). Board nunca lê prisma.insight direto
    // (ADR-001) — passa pela interface pública do InsightService.
    const inference = r.source === 'inference'
      ? { inferred: true as const, spans: await this.insight.latestClassifySpans(projectId, tab) }
      : null;

    switch (tab) {
      case 'architecture':
      case 'design':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path), ...inference } };
      case 'decisions': {
        const docs = await this.docsOf(projectId, r.path ? [r.path] : r.paths);
        return { source, payload: { items: parseDecisions(docs), ...inference } };
      }
      case 'deploy': {
        const md = await this.markdownOf(projectId, r.path);
        return { source, payload: { environments: parseDeploy(md), ...inference } };
      }
      case 'skills': {
        const docs = await this.docsOf(projectId, r.paths.length ? r.paths : r.path ? [r.path] : []);
        return { source, payload: { ...parseSkills(docs), ...inference } };
      }
      case 'testing':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path), ...inference } };
      default:
        return { source, payload: null };
    }
  }

  private async markdownOf(projectId: string, path: string | null): Promise<string> {
    if (!path) return '';
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { content: true },
    });
    if (!doc) throw new NotFoundException(`Documento não encontrado: ${path}`);
    return doc.content;
  }

  private async docsOf(projectId: string, paths: string[]): Promise<{ path: string; content: string }[]> {
    if (paths.length === 0) return [];
    const rows = await this.prisma.document.findMany({
      where: { projectId, path: { in: paths } },
      select: { path: true, content: true },
    });
    return rows;
  }

  private async ciFallback(projectId: string): Promise<{ workflows: WorkflowInfo[] }> {
    const rows = await this.prisma.document.findMany({
      where: { projectId, path: { startsWith: '.github/workflows/' } },
      select: { path: true, content: true },
    });
    const workflows = rows
      .map((d) => parseWorkflow(d.path, d.content))
      .filter((w): w is WorkflowInfo => w !== null);
    return { workflows };
  }
}
