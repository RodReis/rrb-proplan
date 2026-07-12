import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './application/auth.service';
import { GithubAuth } from './application/github-auth.service';
import { CryptoService } from './infrastructure/crypto.service';
import { GithubOauthClient } from './infrastructure/github-oauth.client';
import { GithubInstallationsClient } from './infrastructure/github-installations.client';
import { InstallationTokenService } from './infrastructure/installation-token.service';
import { RedisProvider } from './infrastructure/redis.provider';
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
  providers: [
    AuthService,
    GithubAuth,
    CryptoService,
    GithubOauthClient,
    GithubInstallationsClient,
    InstallationTokenService,
    RedisProvider,
    JwtAuthGuard,
  ],
  exports: [AuthService, GithubAuth, GithubInstallationsClient, JwtAuthGuard],
})
export class IdentityModule {}
