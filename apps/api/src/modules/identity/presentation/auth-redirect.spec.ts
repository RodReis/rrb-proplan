import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from '../application/auth.service';

/**
 * Para onde o callback de OAuth devolve o browser (FIX #230).
 *
 * O que se prova: **entrar** no app cai em `/entrar` (a porta que escolhe entre
 * Dashboard e Catálogo), mas **conectar** o GitHub numa sessão que já existia
 * volta ao Catálogo. Os dois passam pelo mesmo `github/callback`, e confundi-los
 * arrancaria a pessoa do catálogo no meio do fluxo de conexão (SPEC-025).
 */
function makeRes() {
  const destinos: string[] = [];
  const res = {
    cookie: () => undefined,
    clearCookie: () => undefined,
    redirect: (url: string) => destinos.push(url),
  } as unknown as Response;
  return { res, destinos };
}

const req = {
  cookies: { proplan_oauth_state: 'estado-fixo' },
} as unknown as Request;

describe('AuthController — destino depois do OAuth (FIX #230)', () => {
  const originalUrl = process.env.FRONTEND_URL;
  afterEach(() => {
    process.env.FRONTEND_URL = originalUrl;
  });

  function controller(userIdDaSessao: string | null) {
    const auth = {
      handleGoogleCallback: async () => ({ jwt: 'jwt' }),
      handleCallback: async () => ({ jwt: 'jwt' }),
      userIdFromSession: async () => userIdDaSessao,
    } as unknown as AuthService;
    return new AuthController(auth);
  }

  it('login pelo Google → /entrar', async () => {
    process.env.FRONTEND_URL = 'https://app.exemplo.com';
    const { res, destinos } = makeRes();

    await controller(null).googleCallback('code', 'estado-fixo', req, res);

    expect(destinos).toEqual(['https://app.exemplo.com/entrar']);
  });

  it('login pelo GitHub (SEM sessão) → /entrar', async () => {
    process.env.FRONTEND_URL = 'https://app.exemplo.com';
    const { res, destinos } = makeRes();

    await controller(null).callback('code', 'estado-fixo', req, res);

    expect(destinos).toEqual(['https://app.exemplo.com/entrar']);
  });

  it('conexão do GitHub (COM sessão viva) → catálogo, não o dashboard', async () => {
    // A pessoa saiu do catálogo para conectar e espera voltar para lá. Mandá-la
    // ao dashboard seria arrancá-la do meio do próprio fluxo.
    process.env.FRONTEND_URL = 'https://app.exemplo.com';
    const { res, destinos } = makeRes();

    await controller('user-123').callback('code', 'estado-fixo', req, res);

    expect(destinos).toEqual(['https://app.exemplo.com/']);
  });

  it('barra final no FRONTEND_URL não vira `//entrar`', async () => {
    // `//entrar` não casa com nenhuma rota do React Router — o login morreria
    // numa tela em branco por causa de uma barra na variável de ambiente.
    process.env.FRONTEND_URL = 'https://app.exemplo.com/';
    const { res, destinos } = makeRes();

    await controller(null).googleCallback('code', 'estado-fixo', req, res);

    expect(destinos).toEqual(['https://app.exemplo.com/entrar']);
  });
});
