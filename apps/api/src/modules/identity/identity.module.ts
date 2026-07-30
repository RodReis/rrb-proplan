import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './application/auth.service';
import { GithubAuth } from './application/github-auth.service';
import { CryptoService } from './infrastructure/crypto.service';
import { GithubOauthClient } from './infrastructure/github-oauth.client';
import { GoogleOauthClient } from './infrastructure/google-oauth.client';
import { GithubInstallationsClient } from './infrastructure/github-installations.client';
import { GithubOrgMembershipClient } from './infrastructure/github-org-membership.client';
import { RoleSyncService } from './application/role-sync.service';
import { InstallationTokenService } from './infrastructure/installation-token.service';
import { RedisProvider } from './infrastructure/redis.provider';
import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/jwt-auth.guard';
import { MembershipService } from './application/membership.service';
import { TenantGuard } from './presentation/tenant.guard';
import { RoleGuard } from './presentation/require-role.decorator';
import { TenantContextInterceptor } from './presentation/tenant-context.interceptor';

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
    GoogleOauthClient,
    GithubInstallationsClient,
    InstallationTokenService,
    RedisProvider,
    JwtAuthGuard,
    MembershipService,
    RoleSyncService,
    GithubOrgMembershipClient,
    TenantGuard,
    RoleGuard,
    TenantContextInterceptor,
  ],
  exports: [
    AuthService,
    // Exportado para a SPEC-039: o `licensing` cifra o PAT de source com o mesmo
    // `TOKEN_ENCRYPTION_KEY` (decisão PI #2). A alternativa era duplicar
    // AES-256-GCM no outro módulo — dois lugares para a mesma primitiva, e o
    // risco de os formatos divergirem em silêncio. Isto **não** abre o
    // `identity` para o `licensing` ler tokens de ninguém: `CryptoService` é
    // cifra pura, sem Prisma e sem estado.
    CryptoService,
    GithubAuth,
    GithubInstallationsClient,
    JwtAuthGuard,
    MembershipService,
    RoleSyncService,
    TenantGuard,
    RoleGuard,
    TenantContextInterceptor,
  ],
})
export class IdentityModule {}
