import {
  Body,
  Controller,
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
import { InsightService } from '../../insight/application/insight.service';
import { BoardService } from '../application/board.service';
import {
  BoardMutationService,
  MutationInput,
} from '../application/board-mutation.service';
import { BoardImportService, CardToCreate } from '../application/board-import.service';

@Controller('projects/:id/board')
@UseGuards(JwtAuthGuard)
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

  @Post('mutations')
  @HttpCode(202)
  mutate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: MutationInput,
  ) {
    return this.mutations.enqueue(req.userId, id, input);
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
  proposeCards(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.insight.proposeCards(req.userId, id);
  }

  @Post('bootstrap/apply')
  @HttpCode(201)
  applyBootstrap(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { cards: CardToCreate[] },
  ) {
    return this.imports.createCards(req.userId, id, body.cards);
  }
}
