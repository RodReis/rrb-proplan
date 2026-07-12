import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { extractLinks } from '../domain/link-extractor';
import { resolveLink } from '../domain/link-resolver';

@Injectable()
export class LinkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputa TODAS as arestas de links do projeto a partir do conteúdo atual
   * dos documentos. Recompute-all (não incremental): simples e correto no
   * perfil do produto (dezenas de docs). Roda dentro de uma transação para
   * o grafo nunca ficar parcialmente atualizado.
   * ponytail: migrar para diff por documento se a escala exigir.
   */
  async rebuildLinks(projectId: string): Promise<void> {
    const docs = await this.prisma.document.findMany({
      where: { projectId },
      select: { id: true, path: true, content: true },
    });
    const scopePaths = new Set(docs.map((d) => d.path));
    const idByPath = new Map(docs.map((d) => [d.path, d.id]));

    const rows = docs.flatMap((doc) =>
      extractLinks(doc.content).map((raw) => {
        const resolved = resolveLink(raw, doc.path, scopePaths);
        return {
          projectId,
          sourceDocumentId: doc.id,
          targetDocumentId: resolved.resolvedPath
            ? (idByPath.get(resolved.resolvedPath) ?? null)
            : null,
          targetPath: resolved.targetPath,
          anchor: resolved.anchor,
        };
      }),
    );

    await this.prisma.$transaction([
      this.prisma.docLink.deleteMany({ where: { projectId } }),
      ...(rows.length > 0
        ? [this.prisma.docLink.createMany({ data: rows })]
        : []),
    ]);
  }
}
