import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../identity/presentation/jwt-auth.guard';
import {
  SettingsService,
  UpdateSettingsInput,
} from '../application/settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.settings.get(req.userId);
  }

  @Put()
  update(@Req() req: AuthenticatedRequest, @Body() body: UpdateSettingsInput) {
    return this.settings.update(req.userId, body);
  }
}
