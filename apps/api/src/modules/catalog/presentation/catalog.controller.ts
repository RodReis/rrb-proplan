import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { CatalogService } from '../application/catalog.service';
import { RepoSummary } from '../infrastructure/github.client';

@Controller('catalog')
@UseGuards(JwtAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('installations')
  listInstallations(@Req() req: AuthenticatedRequest) {
    return this.catalog.listInstallations(req.userId);
  }

  @Get('install-url')
  installUrl() {
    return this.catalog.installUrl();
  }

  @Get('projects')
  listProjects(@Req() req: AuthenticatedRequest) {
    return this.catalog.listProjects(req.userId);
  }

  @Post('projects')
  addProject(
    @Req() req: AuthenticatedRequest,
    @Body() repo: RepoSummary & { installationId: number },
  ) {
    return this.catalog.addProject(req.userId, repo);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  removeProject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.catalog.removeProject(req.userId, id);
  }
}
