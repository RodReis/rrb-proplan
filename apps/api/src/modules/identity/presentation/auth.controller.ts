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

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('github')
  login(@Res() res: Response) {
    const state = this.auth.createState();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
    });
    res.redirect(this.auth.loginUrl(state));
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
    res.clearCookie(STATE_COOKIE);
    res.cookie(SESSION_COOKIE, jwt, {
      httpOnly: true,
      sameSite: 'lax',
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
    res.clearCookie(SESSION_COOKIE);
    res.status(204).send();
  }
}
