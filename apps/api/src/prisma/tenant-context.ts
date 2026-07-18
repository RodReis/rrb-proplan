import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

/**
 * Guarda o client transacional do request atual (SPEC-022, PR-3). O interceptor
 * abre uma transação com `SET LOCAL app.tenant_id` e a coloca aqui; os services
 * pegam via `tenantClient()` sem mudar assinatura. Fora de um request com tenant
 * (jobs de sistema, seed) o store é undefined — o chamador usa o client base.
 *
 * O tipo é o client transacional do Prisma (sem $transaction/$connect), que é o
 * que roda dentro do escopo de `SET LOCAL`.
 */
export type TenantTxClient = Prisma.TransactionClient;

export const tenantStorage = new AsyncLocalStorage<TenantTxClient>();

/**
 * Client escopado ao tenant do request atual, ou undefined fora de um. Services
 * que DEVEM ser escopados chamam isto e caem no client base só em contexto de
 * sistema (onde RLS corta de qualquer forma se a query tocar tabela de tenant).
 */
export function tenantClient(): TenantTxClient | undefined {
  return tenantStorage.getStore();
}
