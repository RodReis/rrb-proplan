import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import {
  RoleGuard,
  RequireRole,
} from '../../identity/presentation/require-role.decorator';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import {
  ClientsService,
  type ClientInput,
  type ClientProjectInput,
  type TransitionInput,
} from '../application/clients.service';

/**
 * Rotas da Frente Clientes sob `/t/:tenant` (SPEC-029).
 *
 * Cadeia igual à do board: `TenantGuard` resolve tenant + papel, o interceptor
 * abre o contexto de RLS. Sem `@RequireRole` na classe — `viewer` LÊ (a spec
 * pede viewer read-only, não cego); toda escrita marca `@RequireRole('member')`.
 * Isso é a metade servidor da defesa em profundidade: a UI esconde os controles
 * E a API recusa com 403.
 *
 * O `tenantId` vem sempre de `req.tenantId!` (posto pelo TenantGuard a partir
 * da membership), nunca do path cru nem do corpo — ADR-020 regra 1.
 */
@Controller('t/:tenant/clients')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest, @Query('q') q?: string) {
    return this.clients.listClients(req.tenantId!, q);
  }

  @Post()
  @RequireRole('member')
  create(@Req() req: AuthenticatedRequest, @Body() input: ClientInput) {
    return this.clients.createClient(req.tenantId!, input);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.clients.getClient(req.tenantId!, id);
  }

  @Patch(':id')
  @RequireRole('member')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: Partial<ClientInput>,
  ) {
    return this.clients.updateClient(req.tenantId!, id, input);
  }

  @Delete(':id')
  @RequireRole('member')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.clients.deleteClient(req.tenantId!, id);
  }

  @Post(':id/projects')
  @RequireRole('member')
  createProject(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: ClientProjectInput,
  ) {
    return this.clients.createProject(req.tenantId!, id, input);
  }
}

/**
 * Projetos de cliente e funil. Controller separado porque o path não é filho de
 * `/clients/:id` — o Kanban é cross-cliente (`GET /t/:tenant/client-projects`),
 * e aninhar forçaria um `:clientId` que o board não tem.
 */
@Controller('t/:tenant/client-projects')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class ClientProjectsController {
  constructor(private readonly clients: ClientsService) {}

  /** Composição do Kanban: 4 colunas com os cards já distribuídos. */
  @Get()
  board(@Req() req: AuthenticatedRequest, @Query('q') q?: string) {
    return this.clients.getBoard(req.tenantId!, q);
  }

  @Get(':id')
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.clients.getProject(req.tenantId!, id);
  }

  @Get(':id/history')
  history(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.clients.getHistory(req.tenantId!, id);
  }

  /** Transição validada no servidor; inválida → 422 e a UI faz rollback. */
  @Post(':id/transition')
  @RequireRole('member')
  transition(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: TransitionInput,
  ) {
    return this.clients.transition(req.tenantId!, id, input, req.userId);
  }
}
