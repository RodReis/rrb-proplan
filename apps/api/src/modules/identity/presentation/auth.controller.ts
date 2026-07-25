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
    res.redirect(process.env.FRONTEND_URL ?? 'http://localhost:5180');
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
    const { jwt } = await this.auth.handleCallback(code);
    res.clearCookie(STATE_COOKIE, cookieFlags);
    res.cookie(SESSION_COOKIE, jwt, {
      ...cookieFlags,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.redirect(process.env.FRONTEND_URL ?? 'http://localhost:5180');
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
