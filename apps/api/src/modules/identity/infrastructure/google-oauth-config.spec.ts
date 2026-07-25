import { GoogleOauthClient } from './google-oauth.client';

/**
 * Credencial ausente falha no servidor, não no Google.
 *
 * O que se prova: sem `GOOGLE_CLIENT_ID`, a API recusa em vez de montar a URL
 * com `client_id=` vazio. Antes disso o usuário era redirecionado ao Google e
 * batia num `Erro 400: invalid_request` — tela que não diz o que fazer e parece
 * problema da conta dele. Aconteceu no primeiro login em produção, porque a
 * variável só tinha sido configurada no ambiente de dev.
 */
describe('GoogleOauthClient — configuração ausente', () => {
  const original = process.env.GOOGLE_CLIENT_ID;
  const client = new GoogleOauthClient();

  afterEach(() => {
    process.env.GOOGLE_CLIENT_ID = original;
  });

  it('sem GOOGLE_CLIENT_ID: recusa nomeando a variável, sem chamar o Google', () => {
    delete process.env.GOOGLE_CLIENT_ID;

    expect(() => client.authorizeUrl('estado')).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('variável vazia conta como ausente (é o que o deploy sem valor produz)', () => {
    process.env.GOOGLE_CLIENT_ID = '';

    expect(() => client.authorizeUrl('estado')).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('configurada: monta a URL com client_id, escopos e state', () => {
    process.env.GOOGLE_CLIENT_ID = 'id-de-teste.apps.googleusercontent.com';

    const url = new URL(client.authorizeUrl('estado-123'));

    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('client_id')).toBe(
      'id-de-teste.apps.googleusercontent.com',
    );
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('state')).toBe('estado-123');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});
