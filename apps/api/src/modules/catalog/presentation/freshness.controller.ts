import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { CatalogService } from '../application/catalog.service';

/** Rota `projects/:id/freshness` (fora do prefixo `catalog`) — ADR-010. */
@Controller('projects/:id')
@UseGuards(JwtAuthGuard)
export class FreshnessController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('freshness')
  freshness(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.catalog.freshness(req.userId, id);
  }
}
