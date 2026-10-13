import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@hydrocrm/shared';
import type { Request } from 'express';
import { AppError } from '../common/app-error';
import { IS_PUBLIC, PERMS } from '../common/decorators';
import { AuthService } from './auth.service';

/** Глобальный guard: проверка access-токена и прав по декоратору @Perm (ПРВ-10, АРХ-13). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHORIZED', 'Требуется вход');
    const user = await this.auth.authenticate(header.slice(7));
    req.user = user;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets) ?? [];
    const missing = required.filter((p) => !user.permissions.has(p));
    if (missing.length) throw new AppError('FORBIDDEN', 'Недостаточно прав для этого действия');
    return true;
  }
}
