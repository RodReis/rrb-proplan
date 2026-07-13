import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import { ActivityService } from '../application/activity.service';

/**
 * Estado de uma operação assíncrona (SPEC-010). O front faz polling deste
 * endpoint — mesmo padrão do sync-run e do mutationId. Ownership validado no
 * service (get filtra por project.userId).
 */
@Controller('operations')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get(':operationId')
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('operationId') operationId: string,
  ) {
    return this.activity.get(req.userId, operationId);
  }
}
