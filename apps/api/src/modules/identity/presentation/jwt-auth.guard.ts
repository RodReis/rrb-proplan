import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

import type { Role } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  userId: string;
  // Populados pelo TenantGuard (SPEC-022) nas rotas /t/:tenant. Ausentes nas
  // rotas globais (auth, catalog) que não resolvem tenant.
  tenantId?: string;
  role?: Role;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = req.cookies?.['proplan_session'];
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
