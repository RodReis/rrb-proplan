import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { ENTITIES, Entity } from '../../ingestion/domain/entity';
import { MappingService } from '../application/mapping.service';
import { TabsService } from '../application/tabs.service';

@Controller('projects/:id/tabs')
@UseGuards(JwtAuthGuard)
export class TabsController {
  constructor(
    private readonly tabs: TabsService,
    private readonly mapping: MappingService,
  ) {}

  @Get('mapping')
  async getMapping(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    await this.tabs.assertOwner(req.userId, projectId);
    return this.mapping.getMapping(projectId);
  }

  @Put('mapping')
  @HttpCode(202)
  async putMapping(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() body: { entity: string; path: string | null },
  ) {
    if (!(ENTITIES as string[]).includes(body.entity)) {
      throw new NotFoundException(`Entidade desconhecida: ${body.entity}`);
    }
    // Ownership: mesmo padrão do BoardController — service valida dono
    // (findFirst id+userId → NotFound) antes de escrever.
    await this.tabs.assertOwner(req.userId, projectId);
    return this.mapping.putMapping(projectId, body.entity as Entity, body.path);
  }

  @Get(':tab')
  async getTab(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Param('tab') tab: string,
  ) {
    if (!(ENTITIES as string[]).includes(tab)) {
      throw new NotFoundException(`Aba desconhecida: ${tab}`);
    }
    // Ownership: mesmo padrão do BoardController — service valida dono
    // (findFirst id+userId → NotFound) antes de resolver a aba.
    await this.tabs.assertOwner(req.userId, projectId);
    return this.tabs.getTab(projectId, tab as Entity);
  }
}
