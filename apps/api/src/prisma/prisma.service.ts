import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantStorage, type TenantTxClient } from './tenant-context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Roda `fn` numa transação com o contexto de tenant setado (SPEC-022, PR-3),
   * expondo o client transacional via AsyncLocalStorage. RLS lê
   * `current_setting('app.tenant_id')` e escopa toda query à conexão.
   *
   * `set_config(..., true)` = SET LOCAL: o contexto morre no commit/rollback,
   * então NÃO vaza para o próximo request que reusar a conexão do pool — o erro
   * que a spec proíbe explicitamente. Nunca usar `SET` de sessão aqui.
   */
  async withTenant<T>(
    tenantId: string,
    fn: (tx: TenantTxClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tenantStorage.run(tx, () => fn(tx));
    });
  }
}
