import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { changePasswordSchema, demoLoginSchema, loginSchema } from '@hydrocrm/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, type IssuedTokens } from './auth.service';

const COOKIE = 'hcrm_refresh';
const COOKIE_PATH = '/api/v1/auth';
/** АРХ-17: не больше 10 попыток входа в минуту с одного IP (вдобавок к блокировке аккаунта после 5 ошибок). */
const LOGIN_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private respond(res: Response, t: IssuedTokens) {
    res.cookie(COOKIE, t.refreshToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: t.refreshExpiresAt,
    });
    return { accessToken: t.accessToken, expiresIn: config.accessTtlSec };
  }

  @Public()
  @Get('config')
  publicConfig() {
    return { demoMode: config.demoMode };
  }

  @Public()
  @Post('login')
  @Throttle(LOGIN_LIMIT)
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body.email, body.password, this.meta(req)));
  }

  @Public()
  @Post('demo-login')
  @Throttle(LOGIN_LIMIT)
  @HttpCode(200)
  async demoLogin(
    @Body(new ZodPipe(demoLoginSchema)) body: z.infer<typeof demoLoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.demoLogin(body.role, this.meta(req)));
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.refresh(req.cookies?.[COOKIE], this.meta(req)));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const db = this.prisma.db;
    const [u, company] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: user.id } }),
      db.company.findUniqueOrThrow({ where: { id: user.companyId } }),
    ]);
    return {
      user: {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        phone: u.phone,
        position: u.position,
        mustChangePassword: u.mustChangePassword,
        roles: user.roles,
        permissions: [...user.permissions],
      },
      company: { id: company.id, name: company.name, timezone: company.timezone, settings: company.settings },
      demoMode: config.demoMode,
    };
  }

  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
  }
}
