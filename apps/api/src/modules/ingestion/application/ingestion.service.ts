import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import * as mammoth from 'mammoth';
import { GithubAuth } from '../../identity/application/github-auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { GithubGitClient } from '../infrastructure/github-git.client';
import { SYNC_QUEUE } from '../ingestion.constants';

export interface SyncJobData {
  syncRunId: string;
}

/** Par sourcePath→targetPath inferido pelo módulo insight (ADR-001: insight nunca escreve). */
export interface InferredEdgeInput {
  sourcePath: string;
  targetPath: string;
  reason: string;
}

/** Content-Type por extensão para o preview sob demanda (Task 4). */
const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  html: 'text/html',
  htm: 'text/html',
};

/**
 * Interface pública do módulo ingestion (SPEC-002). Outros módulos
 * (catalog dispara, insight futuro consome) chamam `enqueueSync`.
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SYNC_QUEUE) private readonly syncQueue: Queue<SyncJobData>,
    private readonly auth: GithubAuth,
    private readonly git: GithubGitClient,
  ) {}

  /**
   * Enfileira um sync do projeto. Cria o SyncRun `queued` e joga na fila.
   * jobId por (projectId) coalescente: dois enqueues próximos não empilham
   * dois runs enquanto um está pendente — reforça a idempotência por hash.
   */
  async enqueueSync(projectId: string): Promise<{ syncRunId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const run = await this.prisma.syncRun.create({
      data: { projectId, status: 'queued' },
    });

    await this.syncQueue.add(
      'sync',
      { syncRunId: run.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return { syncRunId: run.id };
  }

  async latestSyncRun(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.prisma.syncRun.findFirst({
      where: { projectId },
      orderBy: { startedAt: 'desc' },
    });
  }

  async listDocuments(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    return this.prisma.document.findMany({
      where: { projectId },
      select: {
        id: true,
        path: true,
        isConventional: true,
        byteSize: true,
        updatedAt: true,
        kind: true,
      },
      orderBy: { path: 'asc' },
    });
  }

  async documentContent(userId: string, projectId: string, path: string) {
    await this.assertOwner(userId, projectId);
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path } },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    return doc;
  }

  /** Conteúdo bruto de um binário para preview. docx → texto extraído; demais →
   *  bytes + content-type. markdown → erro (usar documentContent). */
  async rawContent(
    userId: string,
    projectId: string,
    path: string,
  ): Promise<
    | { type: 'stream'; buffer: Buffer; contentType: string; isHtml: boolean }
    | { type: 'docx'; text: string }
  > {
    await this.assertOwner(userId, projectId);
    const doc = await this.prisma.document.findUnique({
      where: { projectId_path: { projectId, path } },
      select: { blobSha: true, kind: true },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    if (doc.kind === 'markdown')
      throw new BadRequestException('Use /documents/content para markdown');

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    const token = await this.auth.userToken(project.userId);
    const buffer = await this.git.getRawBlob(
      token,
      project.owner,
      project.name,
      doc.blobSha,
    );

    if (doc.kind === 'office') {
      const { value } = await mammoth.extractRawText({ buffer });
      return { type: 'docx', text: value };
    }
    const ext = (path.split('.').pop() ?? '').toLowerCase();
    const contentType = CONTENT_TYPE[ext] ?? 'application/octet-stream';
    return { type: 'stream', buffer, contentType, isHtml: doc.kind === 'html' };
  }

  /** Grafo de documentos: nós (docs) + arestas (links explícitos). SPEC-004. */
  async graph(userId: string, projectId: string) {
    await this.assertOwner(userId, projectId);
    const [docs, links] = await Promise.all([
      this.prisma.document.findMany({
        where: { projectId },
        select: { id: true, path: true, isConventional: true },
        orderBy: { path: 'asc' },
      }),
      this.prisma.docLink.findMany({
        where: { projectId },
        select: {
          sourceDocumentId: true,
          targetDocumentId: true,
          targetPath: true,
        },
      }),
    ]);

    const nodes = docs.map((d) => ({
      docId: d.id,
      path: d.path,
      isConventional: d.isConventional,
      kind: nodeKind(d.path),
    }));

    const edges = links.map((l) => ({
      source: l.sourceDocumentId,
      target: l.targetDocumentId,
      targetPath: l.targetPath,
      broken: l.targetDocumentId === null,
    }));

    return { nodes, edges };
  }

  /**
   * Persiste as arestas inferidas pela IA (ADR-014 nível grafo). O insight ENTREGA
   * os pares; o ingestion — dono do store — resolve paths→ids, exclui os suprimidos
   * (SuppressedLink) e faz replace-all das inferidas do projeto. As explícitas nunca
   * são tocadas. Pares cujo source/target não é um document conhecido são descartados.
   */
  async writeInferredEdges(
    projectId: string,
    edges: InferredEdgeInput[],
  ): Promise<void> {
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { id: true, path: true },
    });
    const idByPath = new Map(docs.map((d) => [d.path, d.id]));
    const suppressed = await this.prisma.suppressedLink.findMany({
      where: { projectId },
      select: { sourcePath: true, targetPath: true },
    });
    const suppressedSet = new Set(
      suppressed.map((s) => `${s.sourcePath} ${s.targetPath}`),
    );

    const rows = edges
      .filter((e) => idByPath.has(e.sourcePath) && idByPath.has(e.targetPath))
      .filter((e) => !suppressedSet.has(`${e.sourcePath} ${e.targetPath}`))
      .map((e) => ({
        projectId,
        sourceDocumentId: idByPath.get(e.sourcePath)!,
        targetDocumentId: idByPath.get(e.targetPath)!,
        targetPath: e.targetPath,
        kind: 'inferred' as const,
        reason: e.reason,
      }));

    await this.prisma.$transaction([
      this.prisma.docLink.deleteMany({
        where: { projectId, kind: 'inferred' },
      }),
      ...(rows.length ? [this.prisma.docLink.createMany({ data: rows })] : []),
    ]);
  }

  /** Supressão manual de uma aresta inferida (persiste e some — não volta na regeneração). */
  async suppressEdge(
    projectId: string,
    sourcePath: string,
    targetPath: string,
  ): Promise<void> {
    await this.prisma.suppressedLink
      .create({ data: { projectId, sourcePath, targetPath } })
      .catch(() => {
        /* @@unique — já suprimida, idempotente */
      });
    await this.prisma.docLink.deleteMany({
      where: {
        projectId,
        kind: 'inferred',
        targetPath,
        source: { path: sourcePath },
      },
    });
  }

  /** Garante que o projeto pertence ao usuário (isolamento por dono). */
  private async assertOwner(userId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');
  }
}

/** Classifica o nó por path para a cor no grafo (DESIGN.md). */
function nodeKind(path: string): 'readme' | 'claude' | 'doc' {
  if (path === 'README.md') return 'readme';
  if (path === 'CLAUDE.md') return 'claude';
  return 'doc';
}
