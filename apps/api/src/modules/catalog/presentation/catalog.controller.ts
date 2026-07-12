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

  @Get('repos')
  listRepos(@Req() req: AuthenticatedRequest) {
    return this.catalog.listRepos(req.userId);
  }

  @Get('projects')
  listProjects(@Req() req: AuthenticatedRequest) {
    return this.catalog.listProjects(req.userId);
  }

  @Post('projects')
  addProject(@Req() req: AuthenticatedRequest, @Body() repo: RepoSummary) {
    return this.catalog.addProject(req.userId, repo);
  }

  @Delete('projects/:id')
  @HttpCode(204)
  removeProject(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.catalog.removeProject(req.userId, id);
  }
}
