import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubAuth } from '../../identity/application/github-auth.service';
import {
  GithubWritebackClient,
  WritebackConflictError,
} from '../../../shared/github/github-writeback.client';
import {
  generateProjection,
  PROJECTION_COMMIT_MESSAGE,
  ProjectionCard,
} from '../domain/projection';

const PROJECTION_PATH = '.proplan/STATUS.md';

/**
 * Gera e commita a projeção `.proplan/STATUS.md` a partir do cache de issues
 * (SPEC-005 / ADR-011). Escrita com installation token (bot). É consequência
 * das mutações, NÃO requisito: falha aqui não reverte card nenhum — o estado
 * está nas Issues. Mora em `.proplan/` (fora de `docs/`) para não mascarar o
 * alerta de defasagem do ADR-010.
 */
@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: GithubAuth,
    private readonly writeback: GithubWritebackClient,
  ) {}

  /**
   * Regera o arquivo inteiro e commita. Conflito de SHA → re-lê e tenta 1x.
   * Retorna false em falha não-fatal (a UI mostra aviso; o próximo sync
   * reconcilia) — nunca lança para o caller da mutação.
   */
  async commitProjection(projectId: string, updated: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return false;

    const issues = await this.prisma.issue.findMany({
      where: { projectId },
      orderBy: [{ column: 'asc' }, { priority: 'asc' }, { updatedAt: 'desc' }],
    });
    const cards: ProjectionCard[] = issues.map((i) => ({
      number: i.number,
      title: i.title,
      priority: i.priority,
      column: i.column,
      closedAt: i.closedAt,
    }));
    const content = generateProjection(cards, updated);

    const token = await this.auth.installationToken(projectId);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const baseSha = await this.writeback.getFileSha(
          token,
          project.owner,
          project.name,
          PROJECTION_PATH,
          project.defaultBranch,
        );
        await this.writeback.putFile({
          token,
          owner: project.owner,
          repo: project.name,
          path: PROJECTION_PATH,
          branch: project.defaultBranch,
          content,
          message: PROJECTION_COMMIT_MESSAGE,
          baseSha,
        });
        return true;
      } catch (err) {
        if (err instanceof WritebackConflictError && attempt === 0) continue;
        this.logger.error(
          `Falha ao commitar a projeção do projeto ${projectId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
        return false;
      }
    }
    return false;
  }
}
