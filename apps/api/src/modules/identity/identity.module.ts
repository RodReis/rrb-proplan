import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './application/auth.service';
import { CryptoService } from './infrastructure/crypto.service';
import { GithubOauthClient } from './infrastructure/github-oauth.client';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CryptoService, GithubOauthClient, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class IdentityModule {}
