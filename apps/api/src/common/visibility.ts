import { PERMISSIONS } from '@hydrocrm/shared';
import type { Prisma } from '@prisma/client';
import type { CompanySettings } from './settings.service';
import type { AuthUser } from './request-context';

/**
 * Правила «только своё» из матрицы прав (docs/02-роли-и-права.md, примечания 1–2).
 * Возвращают дополнительное условие where, которое сервисы добавляют к запросам.
 */
export function orderScope(user: AuthUser, s: CompanySettings): Prisma.OrderWhereInput {
  if (!user.permissions.has(PERMISSIONS.ordersViewAll)) {
    return { assignees: { some: { userId: user.id } } };
  }
  if (s.managerOwnOnly && user.roles.length === 1 && user.roles[0] === 'manager') {
    return { managerId: user.id };
  }
  return {};
}

export function clientScope(user: AuthUser, s: CompanySettings): Prisma.ClientWhereInput {
  if (!user.permissions.has(PERMISSIONS.clientsViewAll)) {
    return { orders: { some: { assignees: { some: { userId: user.id } } } } };
  }
  if (s.managerOwnOnly && user.roles.length === 1 && user.roles[0] === 'manager') {
    return { managerId: user.id };
  }
  return {};
}

/** Видит ли пользователь цены и себестоимость в смете (ПРВ-11, примечания 5–6). */
export function priceVisibility(user: AuthUser, s: CompanySettings) {
  const prices = user.permissions.has(PERMISSIONS.ordersViewPrices) || s.masterSeesPrices;
  const margin =
    user.permissions.has(PERMISSIONS.ordersViewMargin) ||
    (s.showMarginToManagers && user.roles.includes('manager'));
  return { prices, margin };
}
