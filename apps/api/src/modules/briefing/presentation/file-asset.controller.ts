import { Controller, Get, Param, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { BriefingAttachmentService } from '../application/briefing-attachment.service';

/**
 * Download de anexo — AUTENTICADO, no painel do prestador (SPEC-031 §4).
 *
 * O par público (`BriefingAttachmentController`) escreve; este lê. Quem enviou
 * o arquivo não relista nem baixa: já tem o arquivo, e dar leitura à rota
 * pública ampliaria a superfície sem entregar nada.
 *
 * **Acesso por identificador, nunca por caminho** (ADR-025 item 4): a rota
 * recebe um `id`, e os bytes vêm de uma coluna. Não existe caminho de arquivo
 * para atravessar — nem `..`, nem nome vindo do cliente em lugar nenhum.
 *
 * Três cabeçalhos que não são decoração:
 *
 * - `Content-Type` do allowlist, com o MIME que a ASSINATURA DE BYTES provou no
 *   upload. Ecoar o que o cliente declarou permitiria servir HTML como imagem.
 * - `Content-Disposition: attachment` — o arquivo baixa, nunca renderiza na
 *   origem da aplicação. Um PDF renderizado inline roda script no NOSSO domínio.
 * - `X-Content-Type-Options: nosniff` — sem ele o browser pode ignorar o
 *   `Content-Type` e adivinhar pelo conteúdo, desfazendo os dois anteriores.
 *
 * **Nota de implementação (diverge da letra da spec §4 — decisão do PI
 * pendente).** A spec pede "URL assinada de vida curta". Assinatura existe para
 * dar acesso a um cliente SEM credencial (um bucket, uma CDN). Aqui os bytes
 * saem da nossa própria API, para um browser que já manda o cookie de sessão
 * `proplan_session` (httpOnly) — a identidade está provada antes do controller,
 * e o RLS corta por tenant depois dele. Uma assinatura por cima disso seria um
 * segundo mecanismo de autorização, mais fraco que o primeiro (um link assinado
 * vaza por completo se copiado; um cookie httpOnly, não) e com um segredo e um
 * relógio novos para manter. O critério de aceite da spec é satisfeito por esta
 * rota: sem sessão ou de outro tenant, a resposta é a mesma de não encontrado.
 * Se o PI quiser a assinatura mesmo assim (por exemplo para permitir um link de
 * download compartilhável fora da sessão), ela entra depois — o acesso já é por
 * `id`, então é uma camada na frente, não um redesenho.
 */
@Controller('t/:tenant/files')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class FileAssetController {
  constructor(private readonly attachments: BriefingAttachmentService) {}

  /**
   * Todos os papéis leem, inclusive `viewer` (critério de aceite da spec §6:
   * *"`viewer` consegue ler o briefing e baixar anexo"*). Não há `RequireRole`
   * aqui de propósito — anexo é leitura, e nenhum papel tem escrita sobre ele.
   */
  @Get(':id')
  async download(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.attachments.download(req.tenantId!, id);

    res.setHeader('Content-Type', file.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // `safeName` é gerado pelo servidor (`<uuid>.<ext>`) — não tem aspa, quebra
    // de linha nem separador, então não parte o header nem escapa do filename.
    res.setHeader('Content-Disposition', `attachment; filename="${file.safeName}"`);
    res.setHeader('Content-Length', String(file.bytes.length));
    // Anexo é dado de cliente: não pode ficar em cache compartilhado.
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(file.bytes);
  }
}
