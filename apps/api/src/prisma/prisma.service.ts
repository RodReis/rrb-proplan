import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { tenantStorage, type TenantTxClient } from './tenant-context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    // Proxy que roteia o ACESSO a um model (this.project, this.insight, …) para
    // o client transacional do contexto de tenant, quando há um ativo (SPEC-022).
    //
    // Sem isto, um service que chama `this.prisma.project.findFirst` usaria uma
    // conexão do pool SEM o SET LOCAL do withTenant — o RLS veria contexto vazio
    // e cortaria tudo (404 "Projeto não encontrado", listas vazias). O
    // interceptor abre withTenant e põe o tx no AsyncLocalStorage; aqui, o
    // acesso ao model devolve o delegate do MESMO tx, então a query roda na
    // conexão que tem o contexto.
    //
    // Só models são redirecionados. Métodos que começam com `$` ($transaction,
    // $executeRaw, $connect) e o próprio withTenant usam o client base — senão
    // o withTenant recursaria (o tx dele veria a si mesmo no ALS).
    return new Proxy(this, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop !== 'string' || prop.startsWith('$') || prop === 'withTenant') {
          return value;
        }
        // Só intercepta delegates de model (objetos com métodos como findFirst).
        // Propriedades não-model (métodos próprios, etc.) passam direto.
        const tx = tenantStorage.getStore();
        if (tx && value && typeof value === 'object') {
          const delegate = (tx as unknown as Record<string, unknown>)[prop];
          if (delegate) return delegate;
        }
        return value;
      },
    });
  }

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
