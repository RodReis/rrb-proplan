import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CanonicalService } from '../../canonical/application/canonical.service';
import { BoardService } from '../../board/application/board.service';
import { HandoffService } from '../../handoff/application/handoff.service';
import { ContextService } from '../../context/application/context.service';
import { SettingsService } from '../../settings/application/settings.service';
import { Handoff, HandoffBlock } from '../../handoff/domain/handoff';
import { belowThreshold } from '../../canonical/domain/confidence';
import {
  Candidate,
  EvidenceItem,
  ToolResult,
  enforceEvidenceContract,
} from '../domain/evidence-contract';
import { fieldToEvidence } from '../domain/field-evidence';
import {
  nextTask,
  NextTaskDecision,
  TaskCandidate,
  Exclusion,
} from '../domain/next-task';
import { findBlockers, Blocker, ConstraintView, RefusedField } from '../domain/blockers';

/**
 * Adaptador FINO (SPEC-016 §Escopo.1, ADR-001) das 6 tools do MCP. Compõe o
 * modelo canônico (Fatia 9), o board (Fatia 5), o handoff (Fatia 13.5 — domínio
 * compartilhado, decisão 5 do PI), as asserções (Fatia 10) e o limiar (Fatia 9)
 * por INTERFACE PÚBLICA — nunca importa entidade interna de outro módulo, nunca
 * reimplementa julgamento. Toda saída passa por `enforceEvidenceContract`: sem
 * evidência ⇒ recusa (o invariante, §2). Zero IA (ADR-002).
 *
 * Sem auth no MVP (decisão 1 do PI): serve os projetos do único usuário local;
 * `resolveProject` acha o dono pelo owner/repo. A porteira por token é Fatia 8.
 */
@Injectable()
export class McpToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly canonical: CanonicalService,
    private readonly board: BoardService,
    private readonly handoff: HandoffService,
    private readonly context: ContextService,
    private readonly settings: SettingsService,
  ) {}

  /** owner/repo (da tool/resource) → { userId, projectId }. Sem auth de agente
   *  no MVP; o MCP local serve o único usuário. Repo não gerenciado → 404. */
  private async resolveProject(owner: string, repo: string): Promise<{ userId: string; projectId: string }> {
    const project = await this.prisma.project.findFirst({
      where: { owner, name: repo },
      select: { id: true, userId: true },
    });
    if (!project) throw new NotFoundException(`Projeto ${owner}/${repo} não é gerenciado pelo ProPlan`);
    return { userId: project.userId, projectId: project.id };
  }

  // ── onde eu parei? ────────────────────────────────────────────────────────
  async getProjectState(owner: string, repo: string): Promise<ToolResult> {
    const { userId, projectId } = await this.resolveProject(owner, repo);
    const h = await this.handoff.assemble(userId, projectId);
    return this.answerFromBlocks(
      'estado do projeto por bloco (cada campo com sua confiança e proveniência)',
      h,
    );
  }

  // — o agente se situa —
  async explainProject(owner: string, repo: string): Promise<ToolResult> {
    const { userId, projectId } = await this.resolveProject(owner, repo);
    const h = await this.handoff.assemble(userId, projectId);
    return this.answerFromBlocks('resumo do projeto com procedência por bloco', h);
  }

  // — que arquivos ler? · DoD? · testes? —
  async getHandoffContext(owner: string, repo: string): Promise<ToolResult> {
    const { userId, projectId } = await this.resolveProject(owner, repo);
    const h = await this.handoff.assemble(userId, projectId);
    return this.answerFromBlocks(
      'contexto de handoff: onde estão os documentos, o que é fato × inferência × asserção',
      h,
    );
  }

  // ── o que NÃO mexer? (o fosso, Fatia 10) ───────────────────────────────────
  async getConstraints(owner: string, repo: string): Promise<ToolResult> {
    const { userId, projectId } = await this.resolveProject(owner, repo);
    const assertions = await this.context.list(userId, projectId);
    const evidence: EvidenceItem[] = assertions.map((a) => ({
      type: 'asserção' as const,
      path: a.paths[0],
      author: a.author,
      date: a.assertedAt || null,
      sha: a.assertedSha || undefined,
      status: a.status, // a marca NUNCA é omitida (ADR-013)
    }));
    const answer =
      assertions.length > 0
        ? assertions
            .map((a) => `- ${a.statement}${a.status === 'a-revalidar' ? ' [a-revalidar]' : ''} (${a.paths.join(', ')})`)
            .join('\n')
        : null;
    return enforceEvidenceContract({ answer, confidence: 1, evidence });
  }

  // ── qual issue devo pegar? ──────────────────────────────────────────────────
  async getNextTask(owner: string, repo: string): Promise<ToolResult> {
    const { userId, projectId } = await this.resolveProject(owner, repo);
    const board = await this.board.getBoard(userId, projectId);
    const todo = board.columns.find((c) => c.column === 'todo')?.cards ?? [];
    const candidates: TaskCandidate[] = todo.map((c, i) => ({
      number: c.number,
      url: c.htmlUrl,
      title: c.title,
      priorityRank: i, // já vem ordenado por prioridade do board
    }));

    const blockers = await this.blockersOf(userId, projectId);
    // Um card é excluído se um blocker referencia um path que o toca — no MVP,
    // sem mapa card→path, exclui-se pela marca a-revalidar apenas quando a
    // constraint nomeia a issue no statement (heurística conservadora, datada).
    const excluded: Exclusion[] = candidates
      .filter((c) => blockers.some((b) => b.what.includes(`#${c.number}`)))
      .map((c) => ({
        number: c.number,
        reason: blockers.find((b) => b.what.includes(`#${c.number}`))!.what,
      }));

    const threshold = await this.settings.canonicalThresholdOf(userId);
    const stateConfidence = await this.projectPresenceConfidence(userId, projectId);
    const decision = nextTask({
      candidates,
      excluded,
      stateConfidence,
      belowThreshold: belowThreshold(stateConfidence, threshold),
    });
    return this.answerFromNextTask(decision, blockers, stateConfidence);
  }

  /** Projeção read-only de UMA entidade canônica (resource architecture/tests/
   *  deploy/…). Bloco recusado → recusa honesta; presente → evidência. */
  async entityView(owner: string, repo: string, entity: string): Promise<ToolResult> {
    const { userId, projectId } = await this.resolveProject(owner, repo);
    const h = await this.handoff.assemble(userId, projectId);
    const blocks = h.blocks.filter((b) => b.key === entity || b.key.startsWith(`${entity}.`));
    const present = blocks.filter((b) => !b.body.refused);
    const evidence: EvidenceItem[] = present.map(evidenceOfBlock);
    const answer = present.length
      ? present.map((b) => `## ${b.title}\n${(b.body as { value: string }).value}`).join('\n\n')
      : null;
    const confidence = present.length ? Math.max(...present.map((b) => b.body.confidence)) : 0;
    return enforceEvidenceContract({ answer, confidence, evidence });
  }

  // ── o que trava cada frente? ────────────────────────────────────────────────
  async findBlockers(owner: string, repo: string): Promise<ToolResult> {
    const { userId, projectId } = await this.resolveProject(owner, repo);
    const blockers = await this.blockersOf(userId, projectId);
    const evidence: EvidenceItem[] = blockers.map((b) => ({
      type: b.status === 'a-revalidar' ? ('asserção' as const) : ('fato' as const),
      path: b.where.paths[0],
      url: b.where.url,
      status: b.status,
    }));
    const answer =
      blockers.length > 0
        ? blockers.map((b) => `- [${b.kind}] ${b.what} (${b.where.paths.join(', ')})`).join('\n')
        : null;
    return enforceEvidenceContract({ answer, confidence: 1, evidence });
  }

  // ── helpers privados ────────────────────────────────────────────────────────

  private async blockersOf(userId: string, projectId: string): Promise<Blocker[]> {
    const assertions = await this.context.list(userId, projectId);
    const constraints: ConstraintView[] = assertions.map((a) => ({
      statement: a.statement,
      paths: a.paths,
      status: a.status,
      date: a.assertedAt || null,
      sha: a.assertedSha || undefined,
      author: a.author,
    }));
    const model = await this.canonical.getCanonicalModel(userId, projectId);
    const refused: RefusedField[] = [];
    for (const [entity, ent] of Object.entries(model.entities)) {
      for (const [field, view] of Object.entries(ent.fields)) {
        if (view.refused) refused.push({ entity, field, missing: view.missing });
      }
    }
    return findBlockers(constraints, refused);
  }

  /** Confiança do estado: a do campo `project.presence` (proxy do "onde parou").
   *  Ausente → 0 (recusa). */
  private async projectPresenceConfidence(userId: string, projectId: string): Promise<number> {
    const model = await this.canonical.getCanonicalModel(userId, projectId);
    const field = model.entities['project']?.fields['presence'];
    return field ? field.confidence : 0;
  }

  /** Projeta os blocos do handoff (canônico + board) num resultado de tool sob o
   *  contrato: cada bloco presente vira evidência; recusa se nenhum bloco tem. */
  private answerFromBlocks(headline: string, h: Handoff): ToolResult {
    const evidence: EvidenceItem[] = [];
    const lines: string[] = [];
    for (const block of h.blocks) {
      if (block.body.refused) continue;
      evidence.push(evidenceOfBlock(block));
      lines.push(`## ${block.title}\n${block.body.value}`);
    }
    const answer = lines.length > 0 ? `${headline}\n\n${lines.join('\n\n')}` : null;
    // Confiança da resposta = a maior confiança entre os blocos presentes
    // (o número por-campo continua clicável na evidência; ADR-012).
    const confidence = evidence.length
      ? Math.max(...h.blocks.filter((b) => !b.body.refused).map((b) => b.body.confidence))
      : 0;
    return enforceEvidenceContract({ answer, confidence, evidence });
  }

  private answerFromNextTask(
    d: NextTaskDecision,
    blockers: Blocker[],
    stateConfidence: number,
  ): ToolResult {
    if (!d.pick) {
      return enforceEvidenceContract({
        answer: null,
        confidence: stateConfidence,
        evidence: [],
        refusalReason: d.refusal,
      });
    }
    const excludedNote = d.excluded.length
      ? `\nexcluídos: ${d.excluded.map((e) => `#${e.number} (${e.reason})`).join('; ')}`
      : '';
    // A evidência do pick: a issue referenciada (número+URL, sem corpo — ADR-017)
    // + os blockers que sustentam as exclusões.
    const evidence: EvidenceItem[] = [
      { type: 'fato', url: d.pick.url, date: null },
      ...blockers.map((b) => ({
        type: b.status === 'a-revalidar' ? ('asserção' as const) : ('fato' as const),
        path: b.where.paths[0],
        url: b.where.url,
        status: b.status,
      })),
    ];
    return enforceEvidenceContract({
      answer: `pegue a #${d.pick.number} — ${d.pick.title} (${d.pick.url})${excludedNote}`,
      confidence: stateConfidence,
      evidence,
    });
  }
}

function evidenceOfBlock(block: HandoffBlock): EvidenceItem {
  if (block.body.refused) return { type: 'inferência' };
  return fieldToEvidence(block.body.provenance, block.body.provenanceRef);
}
