import { redisConnectionFromUrl } from './redis-connection';

describe('redisConnectionFromUrl', () => {
  it('sem REDIS_URL → localhost do docker-compose', () => {
    expect(redisConnectionFromUrl()).toEqual({ host: 'localhost', port: 6379 });
  });

  it('URL local sem auth → só host e porta (nada de tls/senha inventados)', () => {
    expect(redisConnectionFromUrl('redis://localhost:6380')).toEqual({
      host: 'localhost',
      port: 6380,
    });
  });

  // O bug que esta fatia corrige: a montagem antiga lia só hostname/port, então
  // a senha do Redis gerenciado ia embora e o worker não autenticava.
  it('preserva usuário e senha da URL gerenciada', () => {
    const conn = redisConnectionFromUrl(
      'redis://default:s3nh4@redis.railway.internal:6379',
    );
    expect(conn).toEqual({
      host: 'redis.railway.internal',
      port: 6379,
      username: 'default',
      password: 's3nh4',
    });
  });

  it('rediss:// liga TLS; redis:// não', () => {
    expect(redisConnectionFromUrl('rediss://h:1234').tls).toEqual({});
    expect(redisConnectionFromUrl('redis://h:1234').tls).toBeUndefined();
  });

  it('decodifica senha percent-encoded (caractere que quebraria o AUTH)', () => {
    const conn = redisConnectionFromUrl('redis://default:p%40ss%2Fw@host:6379');
    expect(conn.password).toBe('p@ss/w');
  });

  it('porta ausente → default 6379', () => {
    expect(redisConnectionFromUrl('redis://host').port).toBe(6379);
  });
});
