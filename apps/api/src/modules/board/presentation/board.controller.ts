import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { TenantGuard } from '../../identity/presentation/tenant.guard';
import { RoleGuard, RequireRole } from '../../identity/presentation/require-role.decorator';
import { TenantContextInterceptor } from '../../identity/presentation/tenant-context.interceptor';
import { InsightService } from '../../insight/application/insight.service';
import { BoardService } from '../application/board.service';
import {
  BoardMutationService,
  MutationInput,
} from '../application/board-mutation.service';
import { BoardImportService, CardToCreate } from '../application/board-import.service';

// Rota sob /t/:tenant (SPEC-022): o TenantGuard resolve tenant + papel; o
// interceptor abre a transação com contexto (RLS). Sem @RequireRole na classe:
// viewer LÊ o board (GET), só não escreve (a spec pede viewer read-only, não
// cego). Escritas marcam @RequireRole('member'); fechar issue exige owner (gate
// no service, closesIssue).
@Controller('t/:tenant/projects/:id/board')
@UseGuards(JwtAuthGuard, TenantGuard, RoleGuard)
@UseInterceptors(TenantContextInterceptor)
export class BoardController {
  constructor(
    private readonly board: BoardService,
    private readonly mutations: BoardMutationService,
    private readonly imports: BoardImportService,
    private readonly insight: InsightService,
  ) {}

  @Get()
  getBoard(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.board.getBoard(req.userId, id);
  }

  /**
   * Detalhe do card — leitura ao vivo no GitHub (SPEC-030). Sem @RequireRole:
   * viewer lê, igual ao GET do board. `ParseIntPipe` porque `:number` chega
   * string do path e o client do GitHub monta URL com ele — número não
   * numérico tem que morrer aqui, na borda, não virar `/issues/NaN`.
   */
  @Get('cards/:number')
  cardDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('number', ParseIntPipe) number: number,
  ) {
    return this.board.cardDetail(req.userId, id, number);
  }

  @Post('mutations')
  @RequireRole('member')
  @HttpCode(202)
  mutate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: MutationInput,
  ) {
    // role! garantido pelo TenantGuard (rota sob /t/:tenant). O gate owner de
    // fechamento (finalizado/descartado) mora no service (closesIssue).
    return this.mutations.enqueue(req.userId, id, input, req.role!);
  }

  @Get('mutations/:mutationId')
  mutationStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('mutationId') mutationId: string,
  ) {
    return this.mutations.status(req.userId, id, mutationId);
  }

  // Importação de STATUS.md legado: prévia editável (GET não muta nada).
  @Get('import-from-status')
  previewImport(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.imports.previewFromStatus(req.userId, id);
  }

  @Post('import-from-status')
  @RequireRole('member')
  @HttpCode(201)
  applyImport(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { cards: CardToCreate[] },
  ) {
    return this.imports.createCards(req.userId, id, body.cards, {
      markLegacyMigrated: true,
    });
  }

  // Bootstrap por IA: propõe cards (revisão na UI) → cria as issues aprovadas.
  @Post('bootstrap')
  @RequireRole('member')
  proposeCards(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.insight.proposeCards(req.userId, id);
  }

  @Post('bootstrap/apply')
  @RequireRole('member')
  @HttpCode(201)
  applyBootstrap(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { cards: CardToCreate[] },
  ) {
    return this.imports.createCards(req.userId, id, body.cards);
  }
}
