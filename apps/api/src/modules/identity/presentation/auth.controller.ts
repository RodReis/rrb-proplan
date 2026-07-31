import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from '../application/auth.service';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

const SESSION_COOKIE = 'proplan_session';
const STATE_COOKIE = 'proplan_oauth_state';

/**
 * Flags de cookie compartilhadas por set/clear (SPEC-027).
 *
 * `secure` só em produção: em dev a API é http://localhost e um cookie Secure
 * seria descartado pelo browser, quebrando o login local. Em produção web e api
 * são subdomínios de `rrbtrading.com.br` (same-site), então `lax` basta — não
 * introduzir `SameSite=None`.
 *
 * O clearCookie usa as MESMAS flags de propósito: o browser só remove um cookie
 * quando os atributos batem com os do set.
 */
const cookieFlags = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
} as const;

/**
 * URL absoluta de uma rota da web. O `FRONTEND_URL` é a raiz do app; a barra
 * final some antes de concatenar para não gerar `//entrar`, que o React Router
 * não casa com nenhuma rota.
 */
function frontendUrl(path: string): string {
  const base = (process.env.FRONTEND_URL ?? 'http://localhost:5180').replace(/\/+$/, '');
  return `${base}${path}`;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('github')
  login(@Res() res: Response) {
    const state = this.auth.createState();
    res.cookie(STATE_COOKIE, state, {
      ...cookieFlags,
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(this.auth.loginUrl(state));
  }

  /** Entrada da sessão do app (SPEC-026). O `/auth/github` acima continua, mas
   *  como porta da **conexão** GitHub — não da identidade. */
  @Get('google')
  googleLogin(@Res() res: Response) {
    const state = this.auth.createState();
    res.cookie(STATE_COOKIE, state, {
      ...cookieFlags,
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(this.auth.googleLoginUrl(state));
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const expected = req.cookies?.[STATE_COOKIE];
    if (!code || !state || !expected || state !== expected) {
      throw new BadRequestException('OAuth state inválido');
    }
    const { jwt } = await this.auth.handleGoogleCallback(code);
    res.clearCookie(STATE_COOKIE, cookieFlags);
    res.cookie(SESSION_COOKIE, jwt, {
      ...cookieFlags,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    // Login sempre — o Google é porta de identidade, não de conexão.
    res.redirect(frontendUrl('/entrar'));
  }

  @Get('github/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const expected = req.cookies?.[STATE_COOKIE];
    if (!code || !state || !expected || state !== expected) {
      throw new BadRequestException('OAuth state inválido');
    }
    // Sessão já ativa ⇒ **conectar** o GitHub à identidade de quem está logado
    // (SPEC-025). Sem sessão ⇒ login legado pelo GitHub, como antes da
    // SPEC-026. A leitura é opcional de propósito: um cookie inválido não pode
    // barrar quem está chegando pela porta de login.
    const userId = await this.auth.userIdFromSession(
      req.cookies?.[SESSION_COOKIE],
    );
    const { jwt } = await this.auth.handleCallback(code, userId);
    res.clearCookie(STATE_COOKIE, cookieFlags);
    res.cookie(SESSION_COOKIE, jwt, {
      ...cookieFlags,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    // Só quem estava DESLOGADO está entrando (FIX #230). Com sessão viva, este
    // callback é a volta de uma **conexão** do GitHub (SPEC-025): a pessoa saiu
    // do catálogo para conectar e espera voltar para lá, não cair no dashboard.
    res.redirect(frontendUrl(userId ? '/' : '/entrar'));
  }

  /** Estado da conexão GitHub — o catálogo usa para decidir o que mostrar. */
  @Get('connections/github')
  @UseGuards(JwtAuthGuard)
  githubConnection(@Req() req: AuthenticatedRequest) {
    return this.auth.githubConnection(req.userId);
  }

  /**
   * Desconecta o GitHub (SPEC-025). Deliberadamente **não** limpa o cookie de
   * sessão: desconectar ≠ deslogar. Quem quer sair usa `/auth/logout`.
   */
  @Post('connections/github/disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnectGithub(@Req() req: AuthenticatedRequest) {
    await this.auth.disconnectGithub(req.userId);
    return { connected: false };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthenticatedRequest) {
    return this.auth.me(req.userId);
  }

  @Post('logout')
  logout(@Res() res: Response) {
    res.clearCookie(SESSION_COOKIE, cookieFlags);
    res.status(204).send();
  }
}
