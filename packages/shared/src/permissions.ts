import type { RoleCode } from './enums';

// Права из docs/02-роли-и-права.md. Сервер проверяет их в guards, интерфейс скрывает недоступное.
export const PERMISSIONS = {
  clientsView: 'clients.view',
  clientsViewAll: 'clients.viewAll',
  clientsEdit: 'clients.edit',
  clientsViewFinance: 'clients.viewFinance',
  clientsMerge: 'clients.merge',

  leadsView: 'leads.view',
  leadsEdit: 'leads.edit',

  ordersView: 'orders.view',
  ordersViewAll: 'orders.viewAll',
  ordersCreate: 'orders.create',
  ordersEdit: 'orders.edit',
  ordersChangeStage: 'orders.changeStage',
  ordersChangeProductionStage: 'orders.changeProductionStage',
  ordersAssign: 'orders.assign',
  ordersViewPrices: 'orders.viewPrices',
  ordersEditEstimate: 'orders.editEstimate',
  ordersProposeItems: 'orders.proposeItems',
  ordersViewMargin: 'orders.viewMargin',
  ordersApproveDiscount: 'orders.approveDiscount',
  ordersOverrideChecks: 'orders.overrideChecks',

  visitsView: 'visits.view',
  visitsPlan: 'visits.plan',
  visitsWork: 'visits.work',

  commentsWrite: 'comments.write',
  tasksViewAll: 'tasks.viewAll',

  analyticsView: 'analytics.view',
  analyticsMoney: 'analytics.money',

  usersManage: 'users.manage',
  settingsManage: 'settings.manage',
  auditView: 'audit.view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

const P = PERMISSIONS;

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  admin: ALL_PERMISSIONS,
  director: ALL_PERMISSIONS.filter((p) => p !== P.usersManage),
  manager: [
    P.clientsView,
    P.clientsViewAll,
    P.clientsEdit,
    P.clientsViewFinance,
    P.leadsView,
    P.leadsEdit,
    P.ordersView,
    P.ordersViewAll,
    P.ordersCreate,
    P.ordersEdit,
    P.ordersChangeStage,
    P.ordersChangeProductionStage,
    P.ordersAssign,
    P.ordersViewPrices,
    P.ordersEditEstimate,
    P.ordersProposeItems,
    P.visitsView,
    P.visitsPlan,
    P.commentsWrite,
    P.analyticsView,
  ],
  master: [
    P.clientsView,
    P.ordersView,
    P.ordersChangeProductionStage,
    P.ordersProposeItems,
    P.visitsView,
    P.visitsWork,
    P.commentsWrite,
  ],
  accountant: [
    P.clientsView,
    P.clientsViewAll,
    P.clientsEdit,
    P.clientsViewFinance,
    P.leadsView,
    P.ordersView,
    P.ordersViewAll,
    P.ordersViewPrices,
    P.ordersViewMargin,
    P.commentsWrite,
    P.analyticsView,
    P.analyticsMoney,
  ],
};

