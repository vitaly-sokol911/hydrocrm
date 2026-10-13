import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@hydrocrm/shared';
import type { AuthUser } from './request-context';

export const IS_PUBLIC = 'isPublic';
export const PERMS = 'permissions';

/** Эндпоинт доступен без входа. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Эндпоинт требует все перечисленные права (ПРВ-10). */
export const Perm = (...permissions: Permission[]) => SetMetadata(PERMS, permissions);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

export function can(user: AuthUser, permission: Permission): boolean {
  return user.permissions.has(permission);
}
