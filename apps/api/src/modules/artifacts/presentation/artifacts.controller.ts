import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { ArtifactReadService } from '../application/artifact-read.service';
import { ArtifactReviewService } from '../application/artifact-review.service';

interface RejectBody {
  reason?: string;
}

interface CreateVersionBody {
  parentVersionId?: string;
  content?: unknown;
}

/**
 * Artefatos no painel do prestador (SPEC-032 §6).
 *
 * **Nenhum `@Patch`/`@Put`/`@Delete`, e isso é o contrato.** `ArtifactVersion` é
 * imutável: editar **cria versão** (`POST .../versions`), nunca altera no
 * lugar. Aprovar e rejeitar mudam o estado do `Artifact` — que é a linha
 * revisável — mas jamais o conteúdo de uma versão já gravada.
 *
 * Há teste varrendo os metadados de rota do Nest para provar que continua
 * assim, no padrão do PR-6 da SPEC-031.
 */
@Controller('t/:tenant')
@UseGuards(JwtAuthGuard, TenantGuard)
@UseInterceptors(TenantContextInterceptor)
export class ArtifactsController {
  constructor(
    private readonly read: ArtifactReadService,
    private readonly review: ArtifactReviewService,
  ) {}

  /** Os 4 artefatos do projeto, com estado, versões e o custo do run. */
  @Get('client-projects/:id/artifacts')
  list(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.read.byClientProject(req.tenantId!, id);
  }

  /** Conteúdo de uma versão + o parecer do revisor. */
  @Get('artifacts/:id/versions/:versionId')
  version(@Req() req: AuthenticatedRequest, @Param('versionId') versionId: string) {
    return this.read.version(req.tenantId!, versionId);
  }

  @Post('artifacts/:id/approve')
  approve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.review.approve(req.tenantId!, id, req.userId!);
  }

  @Post('artifacts/:id/reject')
  reject(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: RejectBody,
  ) {
    return this.review.reject(req.tenantId!, id, req.userId!, body?.reason ?? '');
  }

  /**
   * Edição humana — `POST`, não `PATCH`, porque **nada é alterado no lugar**
   * (§6). O verbo carrega a regra: quem lê a rota vê que uma versão nasce.
   */
  @Post('artifacts/:id/versions')
  createVersion(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: CreateVersionBody,
  ) {
    return this.review.createHumanVersion(req.tenantId!, id, req.userId!, {
      parentVersionId: String(body?.parentVersionId ?? ''),
      content: (body?.content ?? {}) as never,
    });
  }
}
