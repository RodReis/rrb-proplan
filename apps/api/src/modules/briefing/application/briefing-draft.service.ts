import {
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../../clients/application/clients.service';
import { hashToken, linkStatus, type LinkStatus } from '../domain/briefing-token';
import {
  type Answers,
  type StepAnswers,
  completedStepCount,
  isValidStep,
  mergeAnswers,
  validateStep,
  STEP_COUNT,
} from '../domain/briefing-steps';

/** Estado que a rota pública devolve. `submitted` estende os 4 da SPEC-029. */
export type PublicStatus = LinkStatus | 'submitted';

export interface PublicState {
  status: PublicStatus;
  /** Só quando `valid`: onde retomar e o que já foi respondido. */
  step?: number;
  answers?: Answers;
  totalSteps?: number;
  completedSteps?: number;
}

/** Linha da função `resolve_briefing_draft`. */
interface DraftRow {
  link_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  tenant_id: string;
  client_project_id: string;
  project_state: string;
  draft_id: string | null;
  draft_step: number | null;
  draft_answers: Answers | null;
  draft_consumed_at: Date | null;
  version_count: number;
}

/**
 * Rascunho retomável do briefing público (SPEC-031 §2).
 *
 * Duas regras estruturais que este service existe para respeitar:
 *
 * 1. **Roda sem sessão.** O tenant vem do hash do token (ADR-020), nunca do
 *    request. Como o RLS é fail-closed e não há `app.tenant_ids`, a leitura
 *    passa pela função `SECURITY DEFINER` e a escrita abre o contexto do
 *    tenant só depois de descobri-lo — mesma mecânica da `resolvePublic`.
 * 2. **Não escreve em `client_projects`.** Mover o card é pedido ao
 *    `ClientsService` (ADR-001): a máquina de estados vive no `domain/` do
 *    módulo `clients`, e o briefing não passa por cima dela.
 */
@Injectable()
export class BriefingDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
  ) {}

  /** Estado do link + rascunho para a tela pública. */
  async getPublicState(token: string): Promise<PublicState> {
    const row = await this.resolve(token);
    const status = this.statusOf(row);

    // Só `valid` devolve conteúdo. Revogado, expirado e enviado respondem o
    // estado e mais nada: quem abriu um link morto não pode ler o que foi
    // respondido nele.
    if (status !== 'valid' || !row) return { status };

    const answers = row.draft_answers ?? {};
    return {
      status,
      step: row.draft_step ?? 1,
      answers,
      totalSteps: STEP_COUNT,
      completedSteps: completedStepCount(answers),
    };
  }

  /**
   * Salva UMA etapa. O primeiro save move o card `LINK_SENT →
   * BRIEFING_STARTED` como transição de sistema (ator nulo).
   */
  async saveDraft(token: string, step: number, answers: StepAnswers) {
    if (!isValidStep(step)) {
      throw new UnprocessableEntityException(`etapa inválida: ${step}`);
    }

    const row = await this.resolve(token);
    if (!row) throw new NotFoundException('link não encontrado');

    const status = this.statusOf(row);
    if (status !== 'valid') {
      // 410 e não 404: quem tem um link legítimo que parou de valer precisa
      // saber que ele existiu. Token inexistente continua sendo 404 (acima),
      // então sondar não distingue "nunca existiu" de "não é seu".
      throw new GoneException(`link ${status}`);
    }

    // A barreira é aqui, não na tela (spec §1).
    const validation = validateStep(step, answers);
    if (!validation.ok) {
      throw new UnprocessableEntityException({
        message: 'etapa inválida',
        errors: validation.errors,
      });
    }

    const merged = mergeAnswers(row.draft_answers ?? {}, step, answers);
    const isFirstSave = row.draft_id === null;

    const draft = await this.prisma.runInTenantContext([row.tenant_id], async () => {
      return this.prisma.briefingDraft.upsert({
        where: { briefingLinkId: row.link_id },
        create: {
          briefingLinkId: row.link_id,
          step,
          answers: merged as Prisma.InputJsonValue,
        },
        update: { step, answers: merged as Prisma.InputJsonValue },
      });
    });

    if (isFirstSave) await this.startBriefing(row);

    await this.audit(row.tenant_id, 'briefing_draft.saved', row.client_project_id, {
      step,
      linkId: row.link_id,
    });

    return {
      step: draft.step,
      totalSteps: STEP_COUNT,
      completedSteps: completedStepCount(merged),
    };
  }

  /**
   * Move o card no primeiro save. Falha aqui não derruba o save: o rascunho é
   * o dado do cliente e a posição do card é consequência dele — perder o que a
   * pessoa digitou porque o funil recusou inverteria a importância das duas
   * coisas. O card fica para trás e o próximo save (ou o submit) o alcança.
   */
  private async startBriefing(row: DraftRow) {
    if (row.project_state !== 'LINK_SENT' && row.project_state !== 'DRAFT') return;

    try {
      // `runInTenantContext` é OBRIGATÓRIO aqui, não zelo: o `ClientsService`
      // assume o contexto já aberto (as rotas dele são `/t/:tenant`, com
      // interceptor), e a rota pública não tem interceptor nenhum. Sem o
      // contexto, o `findFirst` interno cai no RLS fail-closed, devolve null e
      // vira 404 — que o catch abaixo engoliria, deixando o card parado em
      // LINK_SENT. Foi exatamente o que o dogfooding pegou e os testes não.
      await this.prisma.runInTenantContext([row.tenant_id], async () => {
        await this.clients.transition(
          row.tenant_id,
          row.client_project_id,
          { to: 'BRIEFING_STARTED' },
          null, // transição de sistema: `actorUserId` nullable existe para isto
        );
      });
    } catch {
      // ponytail: silencioso como o `audit` — o save já está commitado.
    }
  }

  /**
   * Lookup sem contexto de tenant, via função `SECURITY DEFINER`.
   *
   * O RLS destas tabelas é fail-closed e a rota pública não tem sessão: um
   * SELECT direto voltaria vazio e todo link válido responderia `invalid` —
   * exatamente o bug que a SPEC-029 achou no dogfooding.
   */
  private async resolve(token: string): Promise<DraftRow | null> {
    const rows = await this.prisma.$queryRaw<
      DraftRow[]
    >`SELECT * FROM resolve_briefing_draft(${hashToken(token)})`;
    return rows[0] ?? null;
  }

  /** `submitted` vence os demais: enviado, o formulário não reabre (spec §5). */
  private statusOf(row: DraftRow | null): PublicStatus {
    if (!row) return 'invalid';
    if (row.version_count > 0 || row.draft_consumed_at) return 'submitted';
    return linkStatus({ expiresAt: row.expires_at, revokedAt: row.revoked_at });
  }

  /** Ver `ClientsService.audit`: perder o evento é melhor que desfazer o fato. */
  private async audit(
    tenantId: string,
    kind: string,
    subject: string,
    payload: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.runInTenantContext([tenantId], async () => {
        await this.prisma.auditEvent.create({
          data: { tenantId, kind, subject, payload },
        });
      });
    } catch {
      // ponytail: silencioso de propósito, como no ClientsService.
    }
  }
}
