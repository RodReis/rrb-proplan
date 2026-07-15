import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CanonicalService } from '../../canonical/application/canonical.service';
import { BoardService } from '../../board/application/board.service';
import {
  assembleHandoff,
  Handoff,
  IssueRef,
  renderHandoffMarkdown,
} from '../domain/handoff';

/**
 * Monta o handoff exportável (SPEC-018, Fatia 13.5) compondo o modelo canônico
 * (Fatia 9) + o board (Fatia 5) por INTERFACE PÚBLICA (ADR-001) — nunca lê
 * CanonicalField/Issue direto. Zero IA no caminho (ADR-002): só serializa o que
 * já está calculado. Não cria linha em LlmUsage.
 *
 * `assembleHandoff` é domínio compartilhado — o `get_handoff_context` do MCP
 * (Fatia 11) herda esta montagem (decisão 5 do PI).
 */
@Injectable()
export class HandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonical: CanonicalService,
    private readonly board: BoardService,
  ) {}

  async assemble(userId: string, projectId: string): Promise<Handoff> {
    // getCanonicalModel já faz assertOwner; ainda buscamos o projeto para o
    // docsScopeHash do cabeçalho de validade.
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { docsScopeHash: true },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const model = await this.canonical.getCanonicalModel(userId, projectId);
    const board = await this.board.getBoard(userId, projectId);

    const capturedAt = today();
    const allCards = board.columns.flatMap((c) => c.cards);
    const backlog: IssueRef[] = allCards.map((c) => ({
      number: c.number,
      url: c.htmlUrl,
      title: c.title,
      capturedAt,
    }));

    const todo = board.columns.find((c) => c.column === 'todo')?.cards ?? [];
    const nextCard = todo[0]
      ? { number: todo[0].number, url: todo[0].htmlUrl, title: todo[0].title }
      : null;

    return assembleHandoff({
      model,
      generatedAt: capturedAt,
      docsScopeHash: project.docsScopeHash ?? '',
      nextCard,
      backlog,
    });
  }

  async assembleMarkdown(userId: string, projectId: string): Promise<string> {
    return renderHandoffMarkdown(await this.assemble(userId, projectId));
  }
}

/** YYYY-MM-DD — data do instantâneo. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
