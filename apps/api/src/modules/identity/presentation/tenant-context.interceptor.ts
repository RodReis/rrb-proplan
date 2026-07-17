import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, Observable } from 'rxjs';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * Abre a transação com contexto de tenant por request (SPEC-022, PR-3). Roda
 * DEPOIS do TenantGuard (que resolveu req.tenantId) e envolve o handler em
 * `prisma.withTenant`, expondo o client transacional via AsyncLocalStorage.
 *
 * Sem req.tenantId (rotas globais: auth, catalog) → passa direto, sem tx: essas
 * rotas não tocam tabela escopada, ou tocam `users`/`model_prices` (sem RLS).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.tenantId) return next.handle();

    return from(
      this.prisma.withTenant(req.tenantId, () =>
        // next.handle() é um Observable; consumimos dentro da tx para que o
        // SET LOCAL valha por toda a resolução do handler.
        firstValueFromHandle(next),
      ),
    );
  }
}

// Converte o Observable do handler numa Promise resolvida DENTRO da transação —
// o `withTenant` só commita quando a Promise resolve, mantendo o SET LOCAL vivo.
function firstValueFromHandle(next: CallHandler): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let last: unknown;
    next.handle().subscribe({
      next: (v) => (last = v),
      error: reject,
      complete: () => resolve(last),
    });
  });
}
