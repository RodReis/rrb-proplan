import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  tenantStorage,
  tenantIdsStorage,
  type TenantTxClient,
} from './tenant-context';

/** Array literal do Postgres a partir dos ids (uuid do banco, não input livre). */
function tenantArrayLiteral(tenantIds: string[]): string {
  return `{${tenantIds.join(',')}}`;
}

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
    // Só models são redirecionados. Métodos que começam com `$` usam o client
    // base — EXCETO `$transaction` em LOTE (array), tratado abaixo: um
    // `$transaction([deleteMany, createMany])` não passa pela camada de query do
    // client estendido, então rodaria sem o SET LOCAL do contexto (RLS
    // fail-closed → delete não vê nada, createMany colide no unique). Injetamos
    // o set_config como 1ª operação do lote, na mesma transação.
    return new Proxy(this, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);

        if (prop === '$transaction') {
          const tenantIds = tenantIdsStorage.getStore();
          if (!tenantIds) return value;
          // As sobrecargas de $transaction (batch × callback) confundem `.call`;
          // tratamos como função genérica e só desviamos a forma em array.
          const original = value as (...a: unknown[]) => unknown;
          return function (arg: unknown, ...rest: unknown[]) {
            // Só o lote em array precisa do reforço; a forma interativa
            // (callback) recebe um `tx` que já roda na conexão do contexto
            // (não é o caso hoje, mas fica correto se surgir).
            if (Array.isArray(arg)) {
              const withContext = [
                target.$executeRaw`SELECT set_config('app.tenant_ids', ${tenantArrayLiteral(tenantIds)}, true)`,
                ...arg,
              ];
              // O 1º elemento (set_config) é descartado pelo caller — a ordem
              // dos demais resultados é preservada.
              return (
                original.call(target, withContext) as Promise<unknown[]>
              ).then((results) => results.slice(1));
            }
            return original.call(target, arg, ...rest);
          };
        }

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
    const arrayLiteral = tenantArrayLiteral(tenantIds);
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_ids', ${arrayLiteral}, true)`;
      // Ambos os stores: `tenantStorage` roteia model access para o `tx`;
      // `tenantIdsStorage` deixa o Proxy reforçar um `$transaction([...])` em
      // lote (que abriria conexão nova, sem contexto).
      return tenantIdsStorage.run(tenantIds, () =>
        tenantStorage.run(tx, () => fn(tx)),
      );
    });
  }

  /**
   * Contexto de tenant para JOBS (workers BullMQ), fora de request (SPEC-022).
   *
   * `withTenant` não serve aqui: ele mantém UMA transação interativa aberta pelo
   * job inteiro — um sync segura rede (GitHub, probes) por até minutos, e o
   * rollback da tx engoliria o `status: failed` que o catch do job grava (o run
   * ficaria `queued` para sempre, que é exatamente o bug que isto corrige).
   *
   * Aqui o contexto é POR OPERAÇÃO: um client estendido embute cada operação de
   * model numa transação em lote `[set_config(app.tenant_ids), query]` — mesma
   * conexão, SET LOCAL morre no commit (não vaza para o pool), cada escrita
   * commita na hora (status `running`/`failed` visível ao polling). É o padrão
   * documentado do Prisma para RLS. O client vai no AsyncLocalStorage e o Proxy
   * do construtor roteia `this.prisma.<model>` dos services para ele — nenhum
   * service muda.
   */
  async runInTenantContext<T>(
    tenantIds: string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    if (tenantIds.length === 0 || tenantIds.some((id) => !id)) {
      // Fail fast: sem tenant o RLS cortaria tudo em silêncio (fail-closed) e o
      // job morreria com erros enganosos de "não encontrado".
      throw new Error('runInTenantContext exige ao menos um tenantId');
    }
    const arrayLiteral = tenantArrayLiteral(tenantIds);
    // `base` = o Proxy. Métodos `$` passam direto para o client base; para o
    // set_config de CADA operação de model isto basta. (O `$transaction` do
    // Proxy reforça o contexto de novo quando `tenantIdsStorage` está setado —
    // set_config repetido é idempotente e a fatia de resultados compensa.)
    const base = this;
    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const [, result] = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.tenant_ids', ${arrayLiteral}, true)`,
              query(args) as Prisma.PrismaPromise<unknown>,
            ]);
            return result;
          },
        },
      },
      // Estruturalmente compatível com o que o Proxy precisa (delegates de
      // model); o cast evita carregar o tipo gigante do $extends no ALS.
    }) as unknown as TenantTxClient;
    // `tenantStorage` → o Proxy roteia model access ao client estendido;
    // `tenantIdsStorage` → o Proxy reforça `$transaction([...])` em lote que os
    // services chamem (o client estendido NÃO cobre batch: não passa pela
    // camada de query — foi o furo do resolution.rebuild).
    return tenantIdsStorage.run(tenantIds, () =>
      tenantStorage.run(extended, fn),
    );
  }
}
