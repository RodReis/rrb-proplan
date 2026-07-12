import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

/** Token de injeção para o cliente Redis compartilhado (cache de tokens). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Cliente ioredis dedicado ao cache de tokens do App. Reusa a mesma URL do
 * BullMQ (REDIS_URL). Conexão própria — não compartilha a do worker de filas.
 */
export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'),
};
