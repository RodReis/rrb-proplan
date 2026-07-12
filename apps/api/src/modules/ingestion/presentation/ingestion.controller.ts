import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { IngestionService } from '../application/ingestion.service';

@Controller('projects/:id')
@UseGuards(JwtAuthGuard)
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /** Dispara um sync sob demanda. 202 + id do run para polling. */
  @Post('sync')
  @HttpCode(202)
  async sync(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    await this.assertOwner(req.userId, projectId);
    return this.ingestion.enqueueSync(projectId);
  }

  @Get('sync-runs/latest')
  latestSyncRun(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
  ) {
    return this.ingestion.latestSyncRun(req.userId, projectId);
  }

  @Get('documents')
  listDocuments(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
  ) {
    return this.ingestion.listDocuments(req.userId, projectId);
  }

  @Get('graph')
  graph(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.ingestion.graph(req.userId, projectId);
  }

  @Get('documents/content')
  documentContent(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Query('path') path: string,
  ) {
    if (!path) throw new NotFoundException('Parâmetro path obrigatório');
    return this.ingestion.documentContent(req.userId, projectId, path);
  }

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    // latestSyncRun já valida dono; reusar para o POST antes de enfileirar.
    await this.ingestion.latestSyncRun(userId, projectId);
  }
}
