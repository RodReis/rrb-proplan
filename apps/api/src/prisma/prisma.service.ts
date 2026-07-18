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
   * Roda `fn` numa transação com o contexto de tenant setado (SPEC-022 E1,
   * ADR-020), expondo o client transacional via AsyncLocalStorage. RLS lê
   * `current_setting('app.tenant_ids')` (ARRAY) e escopa toda query à conexão.
   *
   * O contexto é um ARRAY de tenants de membership, não um id só: rota escopada
   * (/t/:tenant) passa array de 1; rota global (catálogo) passa o array completo
   * do usuário — lê cross-tenant sem desligar RLS. A policy usa `= ANY(...)`.
   *
   * `set_config(..., true)` = SET LOCAL: o contexto morre no commit/rollback,
   * então NÃO vaza para o próximo request que reusar a conexão do pool. Nunca
   * `SET` de sessão. Os ids DEVEM vir da identidade autenticada, jamais de input
   * do cliente (ADR-020 regra 1) — quem chama withTenant garante isso.
   */
  async withTenant<T>(
    tenantIds: string[],
    fn: (tx: TenantTxClient) => Promise<T>,
  ): Promise<T> {
    // Formato de array literal do Postgres: {id1,id2}. Ids são uuid (do banco),
    // não input livre — mas montamos via parâmetro para não concatenar em SQL.
    const arrayLiteral = `{${tenantIds.join(',')}}`;
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_ids', ${arrayLiteral}, true)`;
      return tenantStorage.run(tx, () => fn(tx));
    });
  }
}
