/**
 * Conexão Redis para o BullMQ a partir de REDIS_URL (SPEC-027).
 *
 * Por que existe: o `app.module.ts` montava a conexão com apenas `hostname` e
 * `port`, descartando usuário, senha e o scheme. No docker-compose local isso
 * funciona (Redis sem auth, sem TLS); no Railway a URL vem com credenciais e
 * o worker não autenticaria. O parse fica aqui — e não inline no módulo — para
 * ser testável sem subir o Nest.
 *
 * `rediss://` (com dois 's') é Redis sobre TLS. O ioredis só negocia TLS quando
 * recebe a opção `tls`; derivar do scheme é o que liga as duas coisas.
 */
export type RedisConnection = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
};

export const DEFAULT_REDIS_URL = 'redis://localhost:6379';

export function redisConnectionFromUrl(
  rawUrl: string = DEFAULT_REDIS_URL,
): RedisConnection {
  const url = new URL(rawUrl);
  const isTls = url.protocol === 'rediss:';

  const connection: RedisConnection = {
    host: url.hostname,
    port: Number(url.port) || 6379,
  };

  // decodeURIComponent: senha gerada pelo provedor pode conter caracteres
  // percent-encoded na URL (ex. `@`, `/`), que quebrariam o AUTH se passassem crus.
  if (url.username) connection.username = decodeURIComponent(url.username);
  if (url.password) connection.password = decodeURIComponent(url.password);
  if (isTls) connection.tls = {};

  return connection;
}
