import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ResolutionService } from '../../ingestion/application/resolution.service';
import { Entity, Resolution } from '../../ingestion/domain/entity';

export interface TabSource {
  level: 1 | 2 | 4;
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
    if (r.level === 4) return { source, payload: null };

    switch (tab) {
      case 'architecture':
      case 'design':
        return { source, payload: { markdown: await this.markdownOf(projectId, r.path) } };
      default:
        // Fase 2 preenche decisions/testing/deploy/skills.
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
}
