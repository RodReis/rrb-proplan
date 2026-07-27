import { randomUUID } from 'node:crypto';
import {
  GoneException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashToken, linkStatus } from '../domain/briefing-token';
import {
  MAX_BRIEFING_BYTES,
  MAX_BRIEFING_FILES,
  MAX_FILE_BYTES,
  REJECTION_MESSAGE,
  checkUpload,
  safeNameFor,
  sanitizeDisplayName,
  type AllowedMime,
} from '../domain/file-signature';

/** O que a rota devolve — nunca os bytes, nunca o `safeName` interno. */
export interface AttachmentDto {
  id: string;
  name: string;
  size: number;
  mime: string;
}

/** Bytes + metadado para o download autenticado. */
export interface AttachmentDownload {
  safeName: string;
  mime: AllowedMime;
  bytes: Buffer;
}

/** Linha da função `resolve_briefing_draft`, na parte que interessa aqui. */
interface DraftRow {
  link_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  tenant_id: string;
  client_project_id: string;
  draft_id: string | null;
  draft_consumed_at: Date | null;
  version_count: number;
}

interface QuotaRow {
  file_count: number;
  total_bytes: bigint;
}

/**
 * Anexos do briefing público (SPEC-031 §4, ADR-025).
 *
 * Este é o único caminho do produto em que um estranho sem conta escreve bytes
 * no banco. Três regras estruturais o governam:
 *
 * 1. **Nada é gravado antes de passar pela barreira.** `checkUpload` decide por
 *    tamanho, cota e ASSINATURA DE BYTES; recusado, não há INSERT (ADR-025
 *    item 3). O `Content-Type` do request nunca é consultado.
 * 2. **Roda sem sessão**, como as demais rotas públicas: o tenant vem do hash
 *    do token, e a escrita abre `runInTenantContext` só depois de descobri-lo.
 *    A cota é somada por função `SECURITY DEFINER` — um SELECT direto, sem
 *    contexto, voltaria zero e faria o 6º arquivo passar como se fosse o 1º.
 * 3. **O download é o caminho oposto**: autenticado, sob `/t/:tenant`, com o
 *    contexto já aberto pelo interceptor. Quem envia não relista nem baixa.
 */
@Injectable()
export class BriefingAttachmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Anexa um arquivo ao rascunho do link.
   *
   * Recebe o buffer já materializado: o teto de 10 MB por arquivo é aplicado
   * também no multipart (limite do Multer), então o pior caso em memória é
   * conhecido e é o mesmo que o ADR-025 aceitou ao escolher `bytea`.
   */
  async attach(
    token: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<AttachmentDto> {
    const row = await this.resolveWritable(token);

    // O rascunho precisa EXISTIR para o anexo ter dono: a coluna é opcional no
    // schema (a versão também pode ser dona), mas anexo sem nenhum dos dois é
    // barrado pelo CHECK do banco. Quem só abriu o link e foi direto no anexo
    // ainda não salvou etapa nenhuma — criamos o rascunho vazio aqui.
    const draftId =
      row.draft_id ?? (await this.createEmptyDraft(row.tenant_id, row.link_id));

    const quota = await this.quotaOf(draftId);
    const check = checkUpload(file.buffer, quota);

    if (!check.ok) {
      const message = REJECTION_MESSAGE[check.reason];
      // 413 só para o que é literalmente grande demais; o resto é 422. A
      // distinção importa para a tela: 413 fala do arquivo, 422 fala da regra.
      if (check.reason === 'file_too_large') {
        throw new PayloadTooLargeException({ message, reason: check.reason });
      }
      throw new UnprocessableEntityException({ message, reason: check.reason });
    }

    const asset = await this.prisma.runInTenantContext(
      [row.tenant_id],
      async () => {
        // O `id` vem antes do INSERT porque o `safeName` deriva dele — o nome
        // seguro é `<id>.<ext>`, não tem relação com o que o cliente mandou.
        const id = randomUUID();
        return this.prisma.fileAsset.create({
          data: {
            id,
            tenantId: row.tenant_id,
            briefingDraftId: draftId,
            name: sanitizeDisplayName(file.originalname ?? ''),
            safeName: safeNameFor(id, check.mime),
            mime: check.mime,
            size: file.buffer.length,
            bytes: file.buffer,
          },
          select: { id: true, name: true, size: true, mime: true },
        });
      },
    );

    await this.audit(row.tenant_id, 'briefing_attachment.uploaded', row.client_project_id, {
      fileId: asset.id,
      mime: asset.mime,
      size: asset.size,
      linkId: row.link_id,
    });

    return asset;
  }

  /** Anexos já enviados neste rascunho — metadado, nunca bytes. */
  async list(token: string): Promise<AttachmentDto[]> {
    const row = await this.resolveWritable(token);
    if (row.draft_id === null) return [];

    return this.prisma.runInTenantContext([row.tenant_id], async () =>
      this.prisma.fileAsset.findMany({
        where: { briefingDraftId: row.draft_id },
        select: { id: true, name: true, size: true, mime: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * Remove um anexo do rascunho, antes do submit.
   *
   * `deleteMany` com o `briefingDraftId` no WHERE, e não `delete` por `id`: o
   * id sozinho aceitaria apagar anexo de OUTRO rascunho do mesmo tenant. O RLS
   * corta por tenant, não por rascunho — o corte fino é este WHERE.
   */
  async remove(token: string, fileId: string): Promise<void> {
    const row = await this.resolveWritable(token);
    if (row.draft_id === null) throw new NotFoundException('anexo não encontrado');

    const { count } = await this.prisma.runInTenantContext(
      [row.tenant_id],
      async () =>
        this.prisma.fileAsset.deleteMany({
          where: { id: fileId, briefingDraftId: row.draft_id },
        }),
    );

    if (count === 0) throw new NotFoundException('anexo não encontrado');

    await this.audit(row.tenant_id, 'briefing_attachment.removed', row.client_project_id, {
      fileId,
      linkId: row.link_id,
    });
  }

  /**
   * Bytes para o download AUTENTICADO (`/t/:tenant/files/:id`).
   *
   * Não recebe token público e não abre contexto: roda sob o interceptor de
   * tenant, com `app.tenant_ids` já setado pela sessão. O `tenantId` explícito
   * no WHERE é cinto além do suspensório do RLS — se um dia alguém chamar isto
   * de um caminho sem contexto, a query erra fechada em vez de aberta.
   */
  async download(tenantId: string, fileId: string): Promise<AttachmentDownload> {
    const asset = await this.prisma.fileAsset.findFirst({
      where: { id: fileId, tenantId },
      select: { safeName: true, mime: true, bytes: true },
    });

    // 404 e não 403: dizer "existe, mas não é seu" confirmaria a existência do
    // arquivo para quem sonda ids. Não-diferencial, como a rota pública.
    if (!asset) throw new NotFoundException('arquivo não encontrado');

    return {
      safeName: asset.safeName,
      mime: asset.mime as AllowedMime,
      bytes: Buffer.from(asset.bytes),
    };
  }

  /**
   * Resolve o link e exige que ele ACEITE ESCRITA.
   *
   * Mesma escada do `saveDraft`: 404 para token inexistente, 410 para link que
   * existiu e parou de valer. Enviado (`version_count > 0`) também é 410 — o
   * briefing é imutável depois do submit (spec §5), e isso inclui os anexos.
   */
  private async resolveWritable(token: string): Promise<DraftRow> {
    const rows = await this.prisma.$queryRaw<
      DraftRow[]
    >`SELECT link_id, expires_at, revoked_at, tenant_id, client_project_id,
             draft_id, draft_consumed_at, version_count
        FROM resolve_briefing_draft(${hashToken(token)})`;

    const row = rows[0];
    if (!row) throw new NotFoundException('link não encontrado');

    if (row.version_count > 0 || row.draft_consumed_at) {
      throw new GoneException('link submitted');
    }

    const status = linkStatus({
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    });
    if (status !== 'valid') throw new GoneException(`link ${status}`);

    return row;
  }

  /**
   * Rascunho vazio, para o anexo ter dono quando nada foi salvo ainda.
   *
   * `upsert` e não `create`: dois uploads simultâneos do mesmo link corriam
   * para criar o rascunho, e o segundo bateria no unique de `briefing_link_id`.
   * O `update: {}` transforma a colisão em leitura da linha que venceu.
   *
   * Passo curto de propósito — não marca etapa nem move o card no funil: quem
   * anexou um arquivo sem responder nada ainda não começou o briefing, e mover
   * o card aqui mentiria sobre isso. O 1º save de etapa é que move (spec §2).
   */
  private async createEmptyDraft(
    tenantId: string,
    linkId: string,
  ): Promise<string> {
    const draft = await this.prisma.runInTenantContext([tenantId], async () =>
      this.prisma.briefingDraft.upsert({
        where: { briefingLinkId: linkId },
        create: { briefingLinkId: linkId },
        update: {},
        select: { id: true },
      }),
    );
    return draft.id;
  }

  /**
   * Cota atual do rascunho, por função `SECURITY DEFINER`.
   *
   * Não dá para somar isto com um SELECT comum: a rota é pública, roda sem
   * `app.tenant_ids`, e o RLS fail-closed devolveria zero — a cota viraria
   * decoração e o 6º arquivo entraria como se fosse o 1º.
   */
  private async quotaOf(
    draftId: string,
  ): Promise<{ count: number; totalBytes: number }> {
    const rows = await this.prisma.$queryRaw<
      QuotaRow[]
    >`SELECT * FROM briefing_draft_quota(${draftId})`;

    const row = rows[0];
    return {
      count: row ? Number(row.file_count) : 0,
      totalBytes: row ? Number(row.total_bytes) : 0,
    };
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

/** Limites reexportados para o controller montar o Multer e a tela avisar. */
export const UPLOAD_LIMITS = {
  maxFileBytes: MAX_FILE_BYTES,
  maxBriefingBytes: MAX_BRIEFING_BYTES,
  maxFiles: MAX_BRIEFING_FILES,
} as const;
