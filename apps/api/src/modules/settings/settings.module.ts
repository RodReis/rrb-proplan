import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { SettingsService } from './application/settings.service';
import { SettingsController } from './presentation/settings.controller';

@Module({
  imports: [IdentityModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
