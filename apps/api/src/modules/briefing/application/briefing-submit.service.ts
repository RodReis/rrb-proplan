import {
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ClientsService } from '../../clients/application/clients.service';
import { hashToken, linkStatus } from '../domain/briefing-token';
import { contentHashOf } from '../domain/content-hash';
import { type Answers, validateAllSteps } from '../domain/briefing-steps';

/**
 * Evento in-process do envio (SPEC-031 §5).
 *
 * **Sem consumidor nesta fatia, de propósito.** A alternativa — segurar o
 * evento até a SPEC-032, que liga o pipeline de IA — faria a fatia seguinte
 * mexer em duas coisas ao mesmo tempo: o pipeline novo E o ponto onde ele é
 * disparado. Emitir agora deixa a costura pronta e dormente.
 */
export const BRIEFING_SUBMITTED = 'briefing.submitted';

export interface BriefingSubmittedEvent {
  clientProjectId: string;
  briefingVersionId: string;
}

export interface SubmitResult {
  versionId: string;
  version: number;
  /** `true` quando o reenvio caiu na versão que já existia (idempotência). */
  alreadySubmitted: boolean;
}

/** Linha da função `resolve_briefing_draft`, na parte que o submit usa. */
interface DraftRow {
  link_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  tenant_id: string;
  client_project_id: string;
  draft_id: string | null;
  draft_answers: Answers | null;
  draft_consumed_at: Date | null;
  version_count: number;
}

/**
 * Envio do briefing (SPEC-031 §5).
 *
 * O que este service protege, e por que cada coisa existe:
 *
 * 1. **A versão é IMUTÁVEL.** Grava e nunca mais reescreve — não há rota de
 *    atualização em papel nenhum, nem para o prestador, nem para a IA (MVP3 §1,
 *    espírito do ADR-013). Regenerar o link cria a v2; a v1 permanece.
 * 2. **Idempotente por `(briefingLinkId, contentHash)`.** Duplo clique e retry
 *    de rede colidem no índice único em vez de criar dois briefings — o
 *    prestador não recebe dois cards para o mesmo trabalho.
 * 3. **Roda sem sessão**, como as demais rotas públicas: o tenant sai do hash do
 *    token, e a escrita abre `runInTenantContext` depois de descobri-lo.
 * 4. **Não escreve em `client_projects`.** Mover o card é pedido ao
 *    `ClientsService` (ADR-001) — a máquina de estados vive no `domain/` do
 *    módulo `clients`.
 */
@Injectable()
export class BriefingSubmitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly events: EventEmitter2,
  ) {}

  async submit(token: string, confirmed: boolean): Promise<SubmitResult> {
    // A confirmação explícita da etapa 9 é critério da spec: enviar sem ela
    // seria assinar em branco. A tela já exige o checkbox; isto é a barreira.
    if (!confirmed) {
      throw new UnprocessableEntityException({
        message: 'confirmação obrigatória para enviar',
        errors: [{ step: 9, field: 'confirmed', message: 'confirmação obrigatória' }],
      });
    }

    const row = await this.resolve(token);
    if (!row) throw new NotFoundException('link não encontrado');

    // Já enviado? Devolve a versão existente em vez de erro: quem clicou duas
    // vezes (ou voltou no histórico do browser) fez a coisa certa uma vez só, e
    // ver "erro" depois de um envio bem-sucedido assusta sem motivo.
    if (row.version_count > 0 || row.draft_consumed_at) {
      const existing = await this.existingVersion(row);
      if (existing) return { ...existing, alreadySubmitted: true };
      // Marcado como consumido mas sem versão: estado impossível pelo caminho
      // normal. 410 é honesto — o link não aceita mais escrita e não há o que
      // devolver.
      throw new GoneException('link submitted');
    }

    const status = linkStatus({
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    });
    if (status !== 'valid') throw new GoneException(`link ${status}`);

    const answers = row.draft_answers ?? {};

    // A barreira do envio: TODAS as etapas obrigatórias precisam estar válidas.
    // A tela também checa, mas ela é conveniência — quem decide é a API.
    const validation = validateAllSteps(answers);
    if (!validation.ok) {
      throw new UnprocessableEntityException({
        message: 'briefing incompleto',
        errors: validation.errors,
      });
    }

    const contentHash = contentHashOf(answers);

    const version = await this.persist(row, answers, contentHash);

    // Depois do commit: perder o evento é melhor que desfazer o envio. O
    // consumidor chega na SPEC-032, e um `emit` que falha não pode derrubar um
    // briefing que já está gravado.
    this.events.emit(BRIEFING_SUBMITTED, {
      clientProjectId: row.client_project_id,
      briefingVersionId: version.versionId,
    } satisfies BriefingSubmittedEvent);

    await this.moveCard(row);
    await this.audit(row.tenant_id, 'briefing.submitted', row.client_project_id, {
      briefingVersionId: version.versionId,
      version: version.version,
      linkId: row.link_id,
    });

    return { ...version, alreadySubmitted: false };
  }

  /**
   * Grava a versão, prende os anexos a ela e consome o rascunho — **numa
   * transação só**.
   *
   * Os três precisam acontecer juntos: uma versão sem os anexos referenciados
   * seria um briefing que perdeu os arquivos, e um rascunho não-consumido com
   * versão gravada reabriria o formulário de um briefing já enviado.
   */
  private async persist(
    row: DraftRow,
    answers: Answers,
    contentHash: string,
  ): Promise<{ versionId: string; version: number }> {
    return this.prisma.runInTenantContext([row.tenant_id], async () => {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Sequencial POR projeto (v1, v2...), não global. `max + 1` dentro da
          // transação; o unique `(client_project_id, version)` é quem garante
          // de verdade sob concorrência — dois submits simultâneos fazem o
          // segundo colidir, e o catch abaixo o resolve pela idempotência.
          const last = await tx.briefingVersion.aggregate({
            where: { clientProjectId: row.client_project_id },
            _max: { version: true },
          });

          const created = await tx.briefingVersion.create({
            data: {
              clientProjectId: row.client_project_id,
              briefingLinkId: row.link_id,
              version: (last._max.version ?? 0) + 1,
              answers: answers as Prisma.InputJsonValue,
              contentHash,
            },
            select: { id: true, version: true },
          });

          // Anexos do rascunho passam a apontar TAMBÉM para a versão. Não é
          // mover: o `briefingDraftId` fica, preservando a trilha (ADR-025).
          if (row.draft_id) {
            await tx.fileAsset.updateMany({
              where: { briefingDraftId: row.draft_id },
              data: { briefingVersionId: created.id },
            });

            // Consumido, não apagado — a linha fica, como no link revogado.
            await tx.briefingDraft.update({
              where: { id: row.draft_id },
              data: { consumedAt: new Date() },
            });
          }

          return { versionId: created.id, version: created.version };
        });
      } catch (err) {
        // Colisão no unique `(briefing_link_id, content_hash)`: outro request
        // com o MESMO conteúdo venceu a corrida. É exatamente o que a
        // idempotência promete — devolve a versão dele.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const existing = await this.existingVersion(row);
          if (existing) return existing;
        }
        throw err;
      }
    });
  }

  /** A versão já gravada para este link — o que a idempotência devolve. */
  private async existingVersion(
    row: DraftRow,
  ): Promise<{ versionId: string; version: number } | null> {
    const found = await this.prisma.runInTenantContext(
      [row.tenant_id],
      async () =>
        this.prisma.briefingVersion.findFirst({
          where: { briefingLinkId: row.link_id },
          orderBy: { version: 'desc' },
          select: { id: true, version: true },
        }),
    );

    return found ? { versionId: found.id, version: found.version } : null;
  }

  /**
   * Move o card `BRIEFING_STARTED → BRIEFING_SUBMITTED`, como transição de
   * sistema (ator nulo).
   *
   * Falha aqui não desfaz o envio, pelo mesmo motivo do `startBriefing` no
   * rascunho: o briefing é o dado do cliente, a posição do card é consequência
   * dele. Perder o que a pessoa respondeu porque o funil recusou inverteria a
   * importância das duas coisas.
   *
   * `runInTenantContext` é OBRIGATÓRIO: o `ClientsService` assume o contexto
   * aberto (as rotas dele têm interceptor), e a rota pública não tem nenhum.
   * Sem isso o RLS corta em silêncio e o card fica para trás.
   */
  private async moveCard(row: DraftRow) {
    try {
      await this.prisma.runInTenantContext([row.tenant_id], async () => {
        await this.clients.transition(
          row.tenant_id,
          row.client_project_id,
          { to: 'BRIEFING_SUBMITTED' },
          null,
        );
      });
    } catch {
      // ponytail: silencioso como o `audit` — a versão já está commitada.
    }
  }

  /** Lookup sem contexto de tenant, via função `SECURITY DEFINER`. */
  private async resolve(token: string): Promise<DraftRow | null> {
    const rows = await this.prisma.$queryRaw<
      DraftRow[]
    >`SELECT link_id, expires_at, revoked_at, tenant_id, client_project_id,
             draft_id, draft_answers, draft_consumed_at, version_count
        FROM resolve_briefing_draft(${hashToken(token)})`;
    return rows[0] ?? null;
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
