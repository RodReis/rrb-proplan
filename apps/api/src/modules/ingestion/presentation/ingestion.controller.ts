import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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

  /** Suprime uma aresta inferida (some do grafo; não volta na próxima regeneração). */
  @Delete('graph/edges')
  @HttpCode(202)
  async suppressEdge(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() body: { sourcePath: string; targetPath: string },
  ) {
    await this.assertOwner(req.userId, projectId);
    if (!body?.sourcePath || !body?.targetPath) {
      throw new BadRequestException('sourcePath e targetPath obrigatórios');
    }
    await this.ingestion.suppressEdge(projectId, body.sourcePath, body.targetPath);
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

  /** Serve o binário sob demanda (PDF/imagem/html/docx) sem persistir bytes. */
  @Get('documents/raw')
  async documentRaw(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Query('path') path: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!path) throw new NotFoundException('Parâmetro path obrigatório');
    const out = await this.ingestion.rawContent(req.userId, projectId, path);
    if (out.type === 'docx') {
      res.json({ text: out.text });
      return;
    }
    res.set('Content-Type', out.contentType);
    res.set('Content-Disposition', 'inline');
    if (out.isHtml) {
      res.set(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
      );
    }
    res.send(out.buffer);
  }

  private async assertOwner(userId: string, projectId: string): Promise<void> {
    // latestSyncRun já valida dono; reusar para o POST antes de enfileirar.
    await this.ingestion.latestSyncRun(userId, projectId);
  }
}
