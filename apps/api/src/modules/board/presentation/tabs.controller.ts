import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { ENTITIES, Entity } from '../../ingestion/domain/entity';
import { TabsService } from '../application/tabs.service';

@Controller('projects/:id/tabs')
@UseGuards(JwtAuthGuard)
export class TabsController {
  constructor(private readonly tabs: TabsService) {}

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
