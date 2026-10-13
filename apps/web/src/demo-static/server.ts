/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Демо-сервер в браузере для статической сборки (GitHub Pages).
 * Повторяет ответы REST API из apps/api: те же адреса, формы ответов, коды ошибок,
 * проверка входных данных теми же Zod-схемами и правила этапов из @hydrocrm/shared.
 * Работает только с вымышленными данными посетителя в его браузере.
 */
import {
  APPROVAL_METHOD_LABELS,
  approveEstimateSchema,
  calcEstimate,
  chatChannelSchema,
  chatMessageSchema,
  checkTransition,
  clientSchema,
  commentSchema,
  contactSchema,
  DEFAULT_ROLE_PERMISSIONS,
  directChannelSchema,
  equipmentSchema,
  LEAD_CHANNEL_LABELS,
  leadConvertSchema,
  leadCreateSchema,
  leadRejectSchema,
  leadUpdateSchema,
  normalizePhone,
  ORDER_TYPE_LABELS,
  orderAssigneesSchema,
  orderCreateSchema,
  orderItemSchema,
  orderItemUpdateSchema,
  orderUpdateSchema,
  PERMISSIONS,
  stageChangeSchema,
  taskCreateSchema,
  taskUpdateSchema,
  VISIT_RESULT_LABELS,
  VISIT_STATUS_LABELS,
  visitCreateSchema,
  visitStatusSchema,
  visitUpdateSchema,
  type ErrorCode,
  type Permission,
  type RoleCode,
  type StageInfo,
} from '@hydrocrm/shared';
import { emit, getDb, resetDb, save, type DemoDb, type Row } from './store';

// ---------- Инфраструктура ----------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: { field?: string; reason: string }[],
  ) {
    super(message);
  }
}
const bad = (message: string, field?: string) => new HttpError(400, 'VALIDATION_ERROR', message, field ? [{ field, reason: message }] : undefined);
const forbidden = (message = 'Недостаточно прав для этого действия') => new HttpError(403, 'FORBIDDEN', message);
const notFound = (what = 'Запись') => new HttpError(404, 'NOT_FOUND', `${what} не найдена`);
const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);
const demoOnly = (message: string) => new HttpError(403, 'DEMO_RESTRICTED', message);

const HOUR = 3_600_000;
const SESSION = 'hcrm-static-session';
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const num = (v: any) => (v === null || v === undefined ? 0 : Number(v));
const by = <T extends Row>(key: string, value: any) => (r: T) => r[key] === value;

interface Ctx {
  db: DemoDb;
  user: Row;
  roles: RoleCode[];
  perms: Set<Permission>;
}

/** Проверка теми же схемами, что и на сервере. Ошибку проверки (ZodError) отдаём как VALIDATION_ERROR. */
function parse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  return schema.parse(value ?? {});
}
interface ValidationIssue {
  path: (string | number)[];
  message: string;
}
const isValidationError = (e: unknown): e is { issues: ValidationIssue[] } =>
  !!e && typeof e === 'object' && (e as { name?: string }).name === 'ZodError' && Array.isArray((e as { issues?: unknown }).issues);

function sessionUserId(): string | null {
  try {
    return sessionStorage.getItem(SESSION) ?? localStorage.getItem(SESSION);
  } catch {
    return null;
  }
}

function rolesOf(db: DemoDb, userId: string): RoleCode[] {
  const roleIds = db.userRoles.filter(by('userId', userId)).map((r) => r.roleId);
  return db.roles.filter((r) => roleIds.includes(r.id)).map((r) => r.code as RoleCode);
}

function ctxOf(db: DemoDb): Ctx {
  const id = sessionUserId();
  const user = id ? db.users.find(by('id', id)) : undefined;
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход');
  const roles = rolesOf(db, user.id);
  const perms = new Set<Permission>(roles.flatMap((r) => DEFAULT_ROLE_PERMISSIONS[r] ?? []));
  return { db, user, roles, perms };
}

const need = (c: Ctx, ...p: Permission[]) => {
  if (p.some((x) => !c.perms.has(x))) throw forbidden();
};

function settings(db: DemoDb) {
  return {
    managerOwnOnly: false,
    showMarginToManagers: false,
    discountLimitPercent: 10,
    masterSeesPrices: false,
    ...(db.company.settings ?? {}),
  } as Row;
}

function nextNumber(db: DemoDb, key: string, prefix: string) {
  const year = new Date().getFullYear();
  let row = db.counters.find((c) => c.key === key && c.year === year);
  if (!row) db.counters.push((row = { companyId: db.company.id, key, year, last: 0 }));
  row.last += 1;
  return `${prefix}-${year}-${String(row.last).padStart(4, '0')}`;
}

function notify(c: Ctx, userIds: (string | null | undefined)[], n: { type: string; title: string; body?: string; link?: string }) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id && id !== c.user.id))];
  for (const userId of ids) {
    c.db.notifications.push({ id: uid(), companyId: c.db.company.id, userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, readAt: null, createdAt: nowIso() });
  }
  if (ids.length) emit('notification.new', { userIds: ids, title: n.title, link: n.link });
}

function systemComment(c: Ctx, orderId: string, text: string, payload: Row = {}) {
  c.db.comments.push({ id: uid(), orderId, authorId: c.user.id, kind: 'system', text, mentions: [], payload, editedAt: null, deletedAt: null, createdAt: nowIso() });
}

// ---------- Видимость (как apps/api/src/common/visibility.ts) ----------

function orderVisible(c: Ctx, o: Row) {
  if (!c.perms.has(PERMISSIONS.ordersViewAll)) return c.db.orderAssignees.some((a) => a.orderId === o.id && a.userId === c.user.id);
  return true;
}
function clientVisible(c: Ctx, cl: Row) {
  if (cl.deletedAt) return false;
  if (!c.perms.has(PERMISSIONS.clientsViewAll)) {
    return c.db.orders.some((o) => o.clientId === cl.id && c.db.orderAssignees.some((a) => a.orderId === o.id && a.userId === c.user.id));
  }
  return true;
}
function priceVis(c: Ctx) {
  const s = settings(c.db);
  return {
    prices: c.perms.has(PERMISSIONS.ordersViewPrices) || !!s.masterSeesPrices,
    margin: c.perms.has(PERMISSIONS.ordersViewMargin) || (!!s.showMarginToManagers && c.roles.includes('manager')),
  };
}

const stageOf = (db: DemoDb, id: string) => db.stages.find(by('id', id))!;
const pipelineOf = (db: DemoDb, type: string) => db.pipelines.find(by('orderType', type))!;
const stagesOf = (db: DemoDb, type: string) =>
  db.stages.filter((s) => s.pipelineId === pipelineOf(db, type).id).sort((a, b) => a.sort - b.sort);

function orderOr404(c: Ctx, id: string) {
  const o = c.db.orders.find(by('id', id));
  if (!o || !orderVisible(c, o)) throw notFound('Заказ');
  return o;
}

function totalsOf(db: DemoDb, o: Row) {
  return calcEstimate(
    db.orderItems
      .filter(by('orderId', o.id))
      .map((i) => ({ kind: i.kind, status: i.status, quantity: num(i.quantity), priceKop: num(i.priceKop), costKop: num(i.costKop), discountPercent: num(i.discountPercent) })),
    num(o.discountPercent),
  );
}
function recalc(c: Ctx, o: Row) {
  const t = totalsOf(c.db, o);
  o.totalKop = t.totalKop;
  o.costKop = t.costKop;
  o.version = (o.version ?? 1) + 1;
  o.updatedAt = nowIso();
  return t;
}

function fileDto(f: Row) {
  return { id: f.id, name: f.originalName, mimeType: f.mimeType, size: f.sizeBytes, createdAt: f.createdAt, url: f.url };
}

function paged<T>(items: T[], page = 1, pageSize = 50) {
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

const includes = (hay: any, q: string) => typeof hay === 'string' && hay.toLowerCase().includes(q.toLowerCase());

// ---------- Обработчики ----------

type Handler = (c: Ctx | null, p: Record<string, string>, q: URLSearchParams, body: any) => any;
const routes: { method: string; re: RegExp; keys: string[]; handler: Handler; public?: boolean }[] = [];

function route(method: string, path: string, handler: Handler, isPublic = false) {
  const keys: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_m, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler, public: isPublic });
}

// --- Авторизация ---
route('GET', '/auth/config', () => ({ demoMode: true }), true);
route(
  'POST',
  '/auth/demo-login',
  (_c, _p, _q, body) => {
    const role = String(body?.role ?? '');
    const db = current!;
    const roleRow = db.roles.find(by('code', role));
    const user = roleRow && db.users.find((u) => db.userRoles.some((r) => r.userId === u.id && r.roleId === roleRow.id));
    if (!user) throw notFound('Пользователь с такой ролью');
    try {
      sessionStorage.setItem(SESSION, user.id);
      localStorage.setItem(SESSION, user.id);
    } catch {
      /* ignore */
    }
    user.lastLoginAt = nowIso();
    return { accessToken: user.id, expiresIn: 3600 };
  },
  true,
);
route('POST', '/auth/login', () => {
  throw new HttpError(401, 'UNAUTHORIZED', 'В демо вход только по ролям');
}, true);
route(
  'POST',
  '/auth/refresh',
  () => {
    const id = sessionUserId();
    if (!id || !current!.users.some(by('id', id))) throw new HttpError(401, 'UNAUTHORIZED', 'Сессия истекла, войдите снова');
    return { accessToken: id, expiresIn: 3600 };
  },
  true,
);
route(
  'POST',
  '/auth/logout',
  () => {
    try {
      sessionStorage.removeItem(SESSION);
      localStorage.removeItem(SESSION);
    } catch {
      /* ignore */
    }
  },
  true,
);
route('GET', '/auth/me', (c) => ({
  user: { id: c!.user.id, email: c!.user.email, fullName: c!.user.fullName, phone: c!.user.phone, position: c!.user.position, mustChangePassword: false, roles: c!.roles, permissions: [...c!.perms] },
  company: { id: c!.db.company.id, name: c!.db.company.name, timezone: c!.db.company.timezone, settings: c!.db.company.settings },
  demoMode: true,
}));
route('POST', '/auth/change-password', () => {
  throw demoOnly('В демо пароли не меняются');
});

// --- Пользователи и справочники ---
route('GET', '/users', (c) =>
  c!.db.users
    .map((u) => ({ id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, position: u.position, isActive: u.isActive, lastLoginAt: u.lastLoginAt, roles: rolesOf(c!.db, u.id) }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName)),
);
route('POST', '/users', () => {
  throw demoOnly('В демо нельзя создавать пользователей');
});
route('PATCH', '/users/:id', () => {
  throw demoOnly('В демо нельзя менять сотрудников');
});
route('GET', '/dictionaries', (c) => ({
  leadSources: c!.db.leadSources.filter((s) => s.isActive).sort((a, b) => a.name.localeCompare(b.name)),
  rejectReasons: [...c!.db.rejectReasons].sort((a, b) => a.name.localeCompare(b.name)),
  pipelines: c!.db.pipelines.map((p) => ({ ...p, stages: stagesOf(c!.db, p.orderType) })),
}));
// В демо без сервера данные — копия посетителя, поэтому сбросить их может любая роль.
route('POST', '/demo/reset', async () => {
  await resetDb();
  return { ok: true };
});

// --- Клиенты ---
const FINANCE = ['legalName', 'inn', 'kpp', 'ogrn', 'legalAddress', 'paymentTermsDays'];
const maskClient = (c: Ctx, cl: Row) => {
  if (c.perms.has(PERMISSIONS.clientsViewFinance)) return { ...cl };
  const copy = { ...cl };
  for (const f of FINANCE) delete copy[f];
  return copy;
};
function clientMatches(db: DemoDb, cl: Row, q: string) {
  const digits = q.replace(/\D/g, '');
  const tail = digits.length >= 10 ? digits.slice(-10) : digits;
  return (
    includes(cl.name, q) ||
    includes(cl.legalName, q) ||
    includes(cl.email, q) ||
    db.contacts.some((ct) => ct.clientId === cl.id && (includes(ct.fullName, q) || (tail.length >= 4 && ct.phone?.includes(tail)))) ||
    db.equipment.some((e) => e.clientId === cl.id && includes(e.serialNumber, q)) ||
    (digits.length >= 4 && (cl.phone?.includes(tail) || cl.inn?.startsWith(digits)))
  );
}
route('GET', '/clients', (c, _p, q) => {
  need(c!, PERMISSIONS.clientsView);
  const db = c!.db;
  const search = q.get('q') ?? '';
  const finance = c!.perms.has(PERMISSIONS.clientsViewFinance);
  const rows = db.clients
    .filter((cl) => clientVisible(c!, cl))
    .filter((cl) => (q.get('archived') === 'true' ? !!cl.archivedAt : !cl.archivedAt))
    .filter((cl) => !search || clientMatches(db, cl, search))
    .filter((cl) => !q.get('type') || cl.type === q.get('type'))
    .filter((cl) => !q.get('managerId') || cl.managerId === q.get('managerId'))
    .filter((cl) => q.get('withOpenOrders') !== 'true' || db.orders.some((o) => o.clientId === cl.id && stageOf(db, o.stageId).kind === 'open'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((cl) => {
      const orders = db.orders.filter(by('clientId', cl.id));
      return {
        ...maskClient(c!, cl),
        ordersCount: orders.length,
        openOrders: orders.filter((o) => stageOf(db, o.stageId).kind === 'open').length,
        ordersSumKop: finance ? orders.filter((o) => stageOf(db, o.stageId).kind !== 'lost').reduce((s, o) => s + num(o.totalKop), 0) : null,
        lastOrderAt: orders.map((o) => o.createdAt).sort().pop() ?? null,
        equipmentCount: db.equipment.filter(by('clientId', cl.id)).length,
      };
    });
  return paged(rows, Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 50));
});
route('GET', '/clients/duplicates', (c, _p, q) => {
  const db = c!.db;
  const phone = normalizePhone(q.get('phone'));
  const email = q.get('email')?.toLowerCase();
  const inn = q.get('inn');
  if (!phone && !email && !inn) return [];
  return db.clients
    .filter((cl) => !cl.deletedAt && cl.id !== q.get('excludeId'))
    .filter((cl) => (phone && (cl.phone === phone || db.contacts.some((ct) => ct.clientId === cl.id && ct.phone === phone))) || (email && cl.email?.toLowerCase() === email) || (inn && cl.inn === inn))
    .slice(0, 5)
    .map((cl) => ({ id: cl.id, name: cl.name, type: cl.type, phone: cl.phone, email: cl.email, inn: cl.inn }));
});
function clientOr404(c: Ctx, id: string) {
  const cl = c.db.clients.find(by('id', id));
  if (!cl || !clientVisible(c, cl)) throw notFound('Клиент');
  return cl;
}
route('GET', '/clients/:id', (c, p) => {
  need(c!, PERMISSIONS.clientsView);
  const db = c!.db;
  const cl = clientOr404(c!, p.id);
  const finance = c!.perms.has(PERMISSIONS.clientsViewFinance);
  return {
    ...maskClient(c!, cl),
    contacts: db.contacts.filter(by('clientId', cl.id)).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.fullName.localeCompare(b.fullName)),
    equipment: db.equipment.filter(by('clientId', cl.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    source: db.leadSources.find(by('id', cl.sourceId)) ?? null,
    orders: db.orders
      .filter(by('clientId', cl.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => {
        const s = stageOf(db, o.stageId);
        return { id: o.id, number: o.number, type: o.type, title: o.title, totalKop: finance ? num(o.totalKop) : null, createdAt: o.createdAt, finishedAt: o.finishedAt, equipmentId: o.equipmentId, stage: { name: s.name, kind: s.kind, color: s.color } };
      }),
    leads: db.leads
      .filter(by('clientId', cl.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((l) => ({ id: l.id, number: l.number, status: l.status, channel: l.channel, description: l.description, createdAt: l.createdAt })),
  };
});
function clientData(input: any) {
  const { pdConsent, ...rest } = input;
  return { ...rest, phone: normalizePhone(rest.phone), email: rest.email ? rest.email.toLowerCase() : null, ...(pdConsent === undefined ? {} : { pdConsentAt: pdConsent ? nowIso() : null }) };
}
route('POST', '/clients', (c, _p, _q, body) => {
  need(c!, PERMISSIONS.clientsEdit);
  const input = parse(clientSchema, body);
  const row = {
    id: uid(),
    companyId: c!.db.company.id,
    ...clientData(input),
    managerId: input.managerId ?? (c!.roles.includes('manager') ? c!.user.id : null),
    archivedAt: null,
    deletedAt: null,
    createdById: c!.user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    version: 1,
  };
  c!.db.clients.push(row);
  return row;
});
route('PATCH', '/clients/:id', (c, p, q, body) => {
  need(c!, PERMISSIONS.clientsEdit);
  const cl = clientOr404(c!, p.id);
  if (q.get('version') && Number(q.get('version')) !== cl.version) throw conflict('Карточку клиента уже изменил другой пользователь. Обновите страницу');
  const data = clientData(parse(clientSchema, body));
  if (cl.pdConsentAt && data.pdConsentAt) delete data.pdConsentAt;
  Object.assign(cl, data, { version: cl.version + 1, updatedAt: nowIso() });
  return cl;
});
route('POST', '/clients/:id/archive', (c, p, _q, body) => {
  need(c!, PERMISSIONS.clientsEdit);
  clientOr404(c!, p.id).archivedAt = body?.archived === false ? null : nowIso();
});
route('DELETE', '/clients/:id', (c, p) => {
  need(c!, PERMISSIONS.clientsEdit);
  const cl = clientOr404(c!, p.id);
  if (c!.db.orders.some(by('clientId', cl.id))) throw conflict('У клиента есть заказы — его можно только архивировать');
  cl.deletedAt = nowIso();
});
route('POST', '/clients/:id/contacts', (c, p, _q, body) => {
  need(c!, PERMISSIONS.clientsEdit);
  const cl = clientOr404(c!, p.id);
  const input = parse(contactSchema, body);
  if (input.isPrimary) c!.db.contacts.filter(by('clientId', cl.id)).forEach((ct) => (ct.isPrimary = false));
  const row = { id: uid(), clientId: cl.id, ...input, phone: normalizePhone(input.phone) };
  c!.db.contacts.push(row);
  return row;
});
function contactOr404(c: Ctx, id: string) {
  const ct = c.db.contacts.find(by('id', id));
  if (!ct) throw notFound('Контакт');
  clientOr404(c, ct.clientId);
  return ct;
}
route('PATCH', '/contacts/:id', (c, p, _q, body) => {
  need(c!, PERMISSIONS.clientsEdit);
  const ct = contactOr404(c!, p.id);
  const input = parse(contactSchema, body);
  if (input.isPrimary) c!.db.contacts.filter(by('clientId', ct.clientId)).forEach((x) => (x.isPrimary = false));
  Object.assign(ct, input, { phone: normalizePhone(input.phone) });
  return ct;
});
route('DELETE', '/contacts/:id', (c, p) => {
  need(c!, PERMISSIONS.clientsEdit);
  const ct = contactOr404(c!, p.id);
  c!.db.contacts = c!.db.contacts.filter((x) => x !== ct);
});
route('POST', '/clients/:id/equipment', (c, p, _q, body) => {
  need(c!, PERMISSIONS.clientsEdit);
  const cl = clientOr404(c!, p.id);
  const row = { id: uid(), clientId: cl.id, ...parse(equipmentSchema, body), createdAt: nowIso() };
  c!.db.equipment.push(row);
  return row;
});
function equipmentDetail(c: Ctx, id: string) {
  const db = c.db;
  const e = db.equipment.find(by('id', id));
  if (!e) throw notFound('Оборудование');
  const cl = clientOr404(c, e.clientId);
  const finance = c.perms.has(PERMISSIONS.clientsViewFinance);
  return {
    ...e,
    client: { id: cl.id, name: cl.name, type: cl.type },
    orders: db.orders
      .filter(by('equipmentId', e.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => {
        const s = stageOf(db, o.stageId);
        return {
          id: o.id,
          number: o.number,
          type: o.type,
          title: o.title,
          createdAt: o.createdAt,
          finishedAt: o.finishedAt,
          isWarrantyCase: o.isWarrantyCase,
          totalKop: finance ? num(o.totalKop) : null,
          stage: { name: s.name, kind: s.kind, color: s.color },
          items: db.orderItems.filter((i) => i.orderId === o.id && i.kind === 'part' && i.status === 'approved').map((i) => ({ name: i.name, quantity: i.quantity })),
        };
      }),
  };
}
route('GET', '/equipment/:id', (c, p) => {
  need(c!, PERMISSIONS.clientsView);
  return equipmentDetail(c!, p.id);
});
route('PATCH', '/equipment/:id', (c, p, _q, body) => {
  need(c!, PERMISSIONS.clientsEdit);
  equipmentDetail(c!, p.id);
  const e = c!.db.equipment.find(by('id', p.id))!;
  Object.assign(e, parse(equipmentSchema, body));
  return e;
});

// --- Заявки ---
function leadView(db: DemoDb, l: Row) {
  const client = db.clients.find(by('id', l.clientId));
  const order = db.orders.find(by('id', l.orderId));
  return {
    ...l,
    client: client ? { id: client.id, name: client.name, type: client.type, phone: client.phone } : null,
    source: db.leadSources.find(by('id', l.sourceId)) ?? null,
    rejectReason: db.rejectReasons.find(by('id', l.rejectReasonId)) ?? null,
    order: order ? { id: order.id, number: order.number } : null,
  };
}
const leadOverdue = (l: Row) => l.status === 'new' && !l.firstResponseAt && l.responseDueAt < nowIso();
function leadCounters(c: Ctx) {
  const db = c.db;
  return {
    new: db.leads.filter((l) => l.status === 'new').length,
    overdue: db.leads.filter(leadOverdue).length,
    mine: db.leads.filter((l) => l.assigneeId === c.user.id && ['new', 'in_progress'].includes(l.status)).length,
  };
}
route('GET', '/leads', (c, _p, q) => {
  need(c!, PERMISSIONS.leadsView);
  const db = c!.db;
  const status = q.get('status');
  const search = q.get('q') ?? '';
  const digits = search.replace(/\D/g, '');
  const rows = db.leads
    .filter((l) => l.status !== 'spam')
    .filter((l) => (status === 'open' ? ['new', 'in_progress'].includes(l.status) : !status || l.status === status))
    .filter((l) => q.get('mine') !== 'true' || l.assigneeId === c!.user.id)
    .filter((l) => q.get('overdue') !== 'true' || leadOverdue(l))
    .filter(
      (l) =>
        !search ||
        includes(l.number, search) ||
        includes(l.contactName, search) ||
        includes(l.description, search) ||
        includes(db.clients.find(by('id', l.clientId))?.name, search) ||
        (digits.length >= 4 && l.phone?.includes(digits.slice(-10))),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((l) => ({ ...leadView(db, l), overdue: leadOverdue(l) }));
  return { ...paged(rows, Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 50)), counters: leadCounters(c!) };
});
function leadOr404(c: Ctx, id: string) {
  const l = c.db.leads.find(by('id', id));
  if (!l) throw notFound('Заявка');
  return l;
}
route('GET', '/leads/:id', (c, p) => {
  need(c!, PERMISSIONS.leadsView);
  return leadView(c!.db, leadOr404(c!, p.id));
});
route('POST', '/leads', (c, _p, _q, body) => {
  need(c!, PERMISSIONS.leadsEdit);
  const db = c!.db;
  const input = parse(leadCreateSchema, body);
  const phone = normalizePhone(input.phone);
  let clientId = input.clientId ?? null;
  if (!clientId && phone) clientId = db.clients.find((cl) => !cl.deletedAt && (cl.phone === phone || db.contacts.some((ct) => ct.clientId === cl.id && ct.phone === phone)))?.id ?? null;
  const managers = db.users.filter((u) => u.isActive && rolesOf(db, u.id).includes('manager'));
  let assigneeId = input.assigneeId ?? db.clients.find(by('id', clientId))?.managerId ?? null;
  if (!assigneeId && managers.length) {
    const last = [...db.leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((l) => managers.some((m) => m.id === l.assigneeId));
    const idx = managers.findIndex((m) => m.id === last?.assigneeId);
    assigneeId = managers[(idx + 1) % managers.length].id;
  }
  const lead = {
    id: uid(),
    companyId: db.company.id,
    number: nextNumber(db, 'lead', 'ЗЯ'),
    status: 'new',
    channel: input.channel,
    sourceId: input.sourceId,
    clientId,
    contactName: input.contactName,
    phone,
    email: input.email?.toLowerCase() ?? null,
    description: input.description,
    assigneeId,
    responseDueAt: new Date(Date.now() + HOUR).toISOString(),
    firstResponseAt: null,
    orderId: null,
    rejectReasonId: null,
    rejectComment: null,
    isStatusQuestion: input.isStatusQuestion,
    createdById: c!.user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.leads.push(lead);
  notify(c!, assigneeId ? [assigneeId] : managers.map((m) => m.id), {
    type: 'lead_new',
    title: `Новая заявка ${lead.number} (${LEAD_CHANNEL_LABELS[lead.channel as keyof typeof LEAD_CHANNEL_LABELS]})`,
    body: lead.description.slice(0, 200),
    link: `/leads/${lead.id}`,
  });
  emit('lead.created', { id: lead.id });
  return lead;
});
route('PATCH', '/leads/:id', (c, p, _q, body) => {
  need(c!, PERMISSIONS.leadsEdit);
  const l = leadOr404(c!, p.id);
  const input = parse(leadUpdateSchema, body);
  const before = l.assigneeId;
  Object.assign(l, input, input.phone === undefined ? {} : { phone: normalizePhone(input.phone) }, { updatedAt: nowIso() });
  if (input.assigneeId && input.assigneeId !== before) notify(c!, [input.assigneeId], { type: 'lead_new', title: `Вам передана заявка ${l.number}`, link: `/leads/${l.id}` });
  emit('lead.updated', { id: l.id });
  return l;
});
route('POST', '/leads/:id/take', (c, p) => {
  need(c!, PERMISSIONS.leadsEdit);
  const l = leadOr404(c!, p.id);
  if (!['new', 'in_progress'].includes(l.status)) throw conflict('Заявка уже закрыта');
  Object.assign(l, { status: 'in_progress', assigneeId: l.assigneeId ?? c!.user.id, firstResponseAt: l.firstResponseAt ?? nowIso() });
  emit('lead.updated', { id: l.id });
});
route('POST', '/leads/:id/reject', (c, p, _q, body) => {
  need(c!, PERMISSIONS.leadsEdit);
  const l = leadOr404(c!, p.id);
  const input = parse(leadRejectSchema, body);
  if (l.status === 'converted') throw conflict('По заявке уже создан заказ');
  Object.assign(l, { status: input.spam ? 'spam' : 'rejected', rejectReasonId: input.reasonId ?? null, rejectComment: input.comment, firstResponseAt: l.firstResponseAt ?? nowIso() });
  emit('lead.updated', { id: l.id });
});
route('POST', '/leads/:id/reopen', (c, p) => {
  need(c!, PERMISSIONS.leadsEdit);
  const l = leadOr404(c!, p.id);
  if (l.status !== 'rejected') throw conflict('Вернуть в работу можно только отклонённую заявку');
  Object.assign(l, { status: 'in_progress', rejectReasonId: null, rejectComment: null });
  emit('lead.updated', { id: l.id });
});
route('POST', '/leads/:id/convert', (c, p, _q, body) => {
  need(c!, PERMISSIONS.leadsEdit, PERMISSIONS.ordersCreate);
  const db = c!.db;
  const l = leadOr404(c!, p.id);
  const input = parse(leadConvertSchema, body);
  if (l.status === 'converted') throw conflict('По заявке уже создан заказ');
  let clientId = input.clientId ?? l.clientId;
  if (!clientId) {
    if (!input.newClient) throw bad('Выберите клиента или создайте нового', 'clientId');
    const cl = { id: uid(), companyId: db.company.id, type: input.newClient.type, name: input.newClient.name, phone: l.phone, email: l.email, sourceId: l.sourceId, managerId: l.assigneeId ?? c!.user.id, tags: [], paymentTermsDays: 0, archivedAt: null, deletedAt: null, createdById: c!.user.id, createdAt: nowIso(), updatedAt: nowIso(), version: 1 };
    db.clients.push(cl);
    clientId = cl.id;
  }
  l.firstResponseAt ??= nowIso();
  const order = createOrder(c!, { type: input.type, clientId, title: input.title || l.description.slice(0, 120), complaint: l.description, managerId: l.assigneeId ?? undefined, masterIds: [], priority: 'normal', isWarrantyCase: false, leadId: l.id });
  emit('lead.updated', { id: l.id });
  return order;
});

// --- Заказы ---
function createOrder(c: Ctx, raw: unknown) {
  const db = c.db;
  const input = parse(orderCreateSchema, raw);
  const client = db.clients.find((cl) => cl.id === input.clientId && !cl.deletedAt);
  if (!client) throw notFound('Клиент');
  const stages = stagesOf(db, input.type);
  let equipmentId = input.equipmentId ?? null;
  if (equipmentId && !db.equipment.some((e) => e.id === equipmentId && e.clientId === client.id)) throw bad('Оборудование принадлежит другому клиенту', 'equipmentId');
  if (!equipmentId && input.newEquipment) {
    const e = { id: uid(), clientId: client.id, ...input.newEquipment, createdAt: nowIso() };
    db.equipment.push(e);
    equipmentId = e.id;
  }
  const normHours = stages.filter((s) => s.kind === 'open').reduce((s, x) => s + (x.normHours ?? 0), 0);
  const order: Row = {
    id: uid(),
    companyId: db.company.id,
    number: nextNumber(db, 'order', 'З'),
    type: input.type,
    stageId: stages[0].id,
    stageChangedAt: nowIso(),
    clientId: client.id,
    contactId: input.contactId ?? null,
    equipmentId,
    title: input.title,
    complaint: input.complaint,
    managerId: input.managerId ?? client.managerId ?? (c.roles.includes('manager') ? c.user.id : null),
    priority: input.priority,
    plannedFinishAt: input.plannedFinishAt ?? new Date(Date.now() + normHours * HOUR).toISOString(),
    finishedAt: null,
    lostReasonId: null,
    lostComment: null,
    discountPercent: '0',
    totalKop: 0,
    costKop: 0,
    statusToken: uid(),
    isWarrantyCase: input.isWarrantyCase,
    parentOrderId: input.parentOrderId ?? null,
    createdById: c.user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    version: 1,
  };
  db.orders.push(order);
  input.masterIds.forEach((userId, i) => db.orderAssignees.push({ orderId: order.id, userId, isLead: i === 0 }));
  db.orderStageHistory.push({ id: uid(), orderId: order.id, fromStageId: null, toStageId: stages[0].id, changedById: c.user.id, changedAt: nowIso(), comment: null, durationHours: null, overridden: false });
  if (input.leadId) {
    const l = db.leads.find(by('id', input.leadId));
    if (l) Object.assign(l, { orderId: order.id, status: 'converted', clientId: client.id });
  }
  systemComment(c, order.id, `Заказ создан: ${ORDER_TYPE_LABELS[input.type]}`, { event: 'created' });
  notify(c, [order.managerId], { type: 'order_assigned', title: `Вы ответственный за ${order.number}`, body: order.title, link: `/orders/${order.id}` });
  notify(c, input.masterIds, { type: 'order_assigned', title: `Вы исполнитель заказа ${order.number}`, body: order.title, link: `/orders/${order.id}` });
  emit('order.created', { id: order.id });
  return order;
}

route('GET', '/orders', (c, _p, q) => {
  need(c!, PERMISSIONS.ordersView);
  const db = c!.db;
  const now = Date.now();
  const kanban = q.get('view') === 'kanban';
  const search = q.get('q') ?? '';
  const vis = priceVis(c!);
  let rows = db.orders.filter((o) => orderVisible(c!, o));
  const st = (o: Row) => stageOf(db, o.stageId);
  if (q.get('type')) rows = rows.filter((o) => o.type === q.get('type'));
  if (q.get('stageCode')) rows = rows.filter((o) => st(o).code === q.get('stageCode'));
  if (q.get('managerId')) rows = rows.filter((o) => o.managerId === q.get('managerId'));
  if (q.get('masterId')) rows = rows.filter((o) => db.orderAssignees.some((a) => a.orderId === o.id && a.userId === q.get('masterId')));
  if (q.get('mine') === 'true') rows = rows.filter((o) => o.managerId === c!.user.id || db.orderAssignees.some((a) => a.orderId === o.id && a.userId === c!.user.id));
  if (q.get('clientId')) rows = rows.filter((o) => o.clientId === q.get('clientId'));
  if (kanban || ['open', 'overdue', 'stuck'].some((k) => q.get(k) === 'true')) rows = rows.filter((o) => st(o).kind === 'open');
  if (q.get('overdue') === 'true') rows = rows.filter((o) => o.plannedFinishAt && Date.parse(o.plannedFinishAt) < now);
  if (search) {
    rows = rows.filter(
      (o) =>
        includes(o.number, search) ||
        includes(o.title, search) ||
        includes(db.clients.find(by('id', o.clientId))?.name, search) ||
        includes(db.equipment.find(by('id', o.equipmentId))?.serialNumber, search),
    );
  }
  let items = rows
    .sort((a, b) => (kanban ? a.stageChangedAt.localeCompare(b.stageChangedAt) : b.createdAt.localeCompare(a.createdAt)))
    .map((o) => {
      const s = st(o);
      const client = db.clients.find(by('id', o.clientId))!;
      const eq = db.equipment.find(by('id', o.equipmentId));
      const read = db.orderReads.find((r) => r.orderId === o.id && r.userId === c!.user.id)?.lastReadAt;
      const comments = db.comments.filter(by('orderId', o.id));
      return {
        id: o.id,
        number: o.number,
        type: o.type,
        title: o.title,
        priority: o.priority,
        stage: { id: s.id, code: s.code, name: s.name, kind: s.kind, color: s.color, sort: s.sort },
        stageChangedAt: o.stageChangedAt,
        client: { id: client.id, name: client.name, type: client.type },
        equipment: eq ? { id: eq.id, name: eq.name, model: eq.model, serialNumber: eq.serialNumber } : null,
        managerId: o.managerId,
        assignees: db.orderAssignees.filter(by('orderId', o.id)).map((a) => ({ userId: a.userId, isLead: a.isLead })),
        plannedFinishAt: o.plannedFinishAt,
        finishedAt: o.finishedAt,
        createdAt: o.createdAt,
        isWarrantyCase: o.isWarrantyCase,
        totalKop: vis.prices ? num(o.totalKop) : null,
        overdue: s.kind === 'open' && !!o.plannedFinishAt && Date.parse(o.plannedFinishAt) < now,
        stuck: s.kind === 'open' && !!s.normHours && now - Date.parse(o.stageChangedAt) > s.normHours * HOUR,
        // В демо снимок не хранит отметки прочтения — новыми считаем только комментарии за последние сутки, пока заказ не открыт.
        unreadComments: comments.filter((x) => x.kind === 'comment' && !x.deletedAt && x.authorId !== c!.user.id && x.createdAt > (read ?? new Date(now - 24 * HOUR).toISOString())).length,
        commentsCount: comments.length,
      };
    });
  if (q.get('stuck') === 'true') items = items.filter((i) => i.stuck);
  return kanban ? { items, total: items.length, page: 1, pageSize: items.length } : paged(items, Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 50));
});

function maskItem(i: Row, vis: { prices: boolean; margin: boolean }) {
  const quantity = num(i.quantity);
  const discount = num(i.discountPercent);
  return {
    ...i,
    quantity,
    discountPercent: vis.prices ? discount : null,
    priceKop: vis.prices ? num(i.priceKop) : null,
    sumKop: vis.prices ? Math.round(quantity * num(i.priceKop) * (1 - discount / 100)) : null,
    costKop: vis.margin ? num(i.costKop) : null,
  };
}

route('GET', '/orders/:id', (c, p) => {
  need(c!, PERMISSIONS.ordersView);
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  const vis = priceVis(c!);
  const totals = totalsOf(db, o);
  const approvals = db.orderApprovals.filter(by('orderId', o.id)).sort((a, b) => b.version - a.version);
  const client = db.clients.find(by('id', o.clientId))!;
  const files = db.files.filter((f) => f.orderId === o.id && !f.commentId && f.url).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lead = db.leads.find(by('orderId', o.id));
  const parent = db.orders.find(by('id', o.parentOrderId));
  return {
    ...o,
    stage: stageOf(db, o.stageId),
    client: { id: client.id, name: client.name, type: client.type, phone: client.phone, email: client.email, address: client.address },
    contact: db.contacts.find(by('id', o.contactId)) ?? null,
    equipment: db.equipment.find(by('id', o.equipmentId)) ?? null,
    assignees: db.orderAssignees.filter(by('orderId', o.id)),
    items: db.orderItems.filter(by('orderId', o.id)).sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)).map((i) => maskItem(i, vis)),
    approvals: approvals.map((a) => ({ ...a, totalKop: vis.prices ? num(a.totalKop) : null })),
    stageHistory: db.orderStageHistory.filter(by('orderId', o.id)).sort((a, b) => a.changedAt.localeCompare(b.changedAt)),
    visits: db.visits
      .filter(by('orderId', o.id))
      .sort((a, b) => b.plannedStartAt.localeCompare(a.plannedStartAt))
      .map((v) => ({ ...v, assignees: db.visitAssignees.filter(by('visitId', v.id)) })),
    files: files.map(fileDto),
    lead: lead ? { id: lead.id, number: lead.number, channel: lead.channel } : null,
    parentOrder: parent ? { id: parent.id, number: parent.number, type: parent.type } : null,
    childOrders: db.orders.filter(by('parentOrderId', o.id)).map((x) => ({ id: x.id, number: x.number, type: x.type })),
    totalKop: vis.prices ? totals.totalKop : null,
    costKop: vis.margin ? totals.costKop : null,
    discountPercent: num(o.discountPercent),
    totals: vis.prices
      ? { ...totals, costKop: vis.margin ? totals.costKop : null, marginKop: vis.margin ? totals.marginKop : null, marginPercent: vis.margin ? totals.marginPercent : null }
      : null,
    estimateApproved: !!approvals[0] && num(approvals[0].totalKop) === totals.totalKop,
    photoCount: db.files.filter((f) => f.orderId === o.id && f.mimeType.startsWith('image/')).length,
    openTasks: db.tasks.filter((t) => t.orderId === o.id && t.status === 'open').length,
    stages: stagesOf(db, o.type),
    visibility: vis,
    settings: { discountLimitPercent: settings(db).discountLimitPercent },
  };
});

route('POST', '/orders', (c, _p, _q, body) => {
  need(c!, PERMISSIONS.ordersCreate);
  return createOrder(c!, body);
});

route('PATCH', '/orders/:id', (c, p, _q, body) => {
  need(c!, PERMISSIONS.ordersEdit);
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  const input = parse(orderUpdateSchema, body);
  if (o.version !== input.version) throw conflict('Заказ уже изменил другой пользователь. Обновите страницу');
  const limit = settings(db).discountLimitPercent;
  if (input.discountPercent !== undefined && input.discountPercent > limit && !c!.perms.has(PERMISSIONS.ordersApproveDiscount)) {
    for (const d of db.users.filter((u) => rolesOf(db, u.id).includes('director'))) {
      db.tasks.push({ id: uid(), companyId: db.company.id, title: `Подтвердить скидку ${input.discountPercent}% по ${o.number}`, description: null, assigneeId: d.id, authorId: c!.user.id, dueAt: null, status: 'open', completedAt: null, resultComment: null, priority: 'high', orderId: o.id, clientId: o.clientId, leadId: null, isAuto: true, createdAt: nowIso(), updatedAt: nowIso() });
    }
    throw new HttpError(422, 'DISCOUNT_APPROVAL_REQUIRED', `Скидка выше ${limit}% требует подтверждения руководителя. Руководителю поставлена задача`);
  }
  const { version, ...patch } = input;
  void version;
  const managerChanged = patch.managerId && patch.managerId !== o.managerId;
  Object.assign(o, patch, { discountPercent: patch.discountPercent !== undefined ? String(patch.discountPercent) : o.discountPercent });
  recalc(c!, o);
  if (managerChanged) {
    systemComment(c!, o.id, 'Сменился ответственный менеджер', { event: 'manager', userId: patch.managerId });
    notify(c!, [patch.managerId], { type: 'order_assigned', title: `Вы ответственный за ${o.number}`, link: `/orders/${o.id}` });
  }
  emit('order.updated', { id: o.id });
  return o;
});

route('POST', '/orders/:id/assignees', (c, p, _q, body) => {
  need(c!, PERMISSIONS.ordersAssign);
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  const input = parse(orderAssigneesSchema, body);
  const before = new Set(db.orderAssignees.filter(by('orderId', o.id)).map((a) => a.userId));
  const lead = input.leadMasterId && input.masterIds.includes(input.leadMasterId) ? input.leadMasterId : input.masterIds[0];
  db.orderAssignees = db.orderAssignees.filter((a) => a.orderId !== o.id).concat(input.masterIds.map((userId) => ({ orderId: o.id, userId, isLead: userId === lead })));
  o.version += 1;
  systemComment(c!, o.id, 'Изменены исполнители', { event: 'assignees', userIds: input.masterIds });
  notify(c!, input.masterIds.filter((m) => !before.has(m)), { type: 'order_assigned', title: `Вы исполнитель заказа ${o.number}`, body: o.title, link: `/orders/${o.id}` });
  emit('order.updated', { id: o.id });
});

function moveStage(c: Ctx, o: Row, to: Row, comment?: string | null, overridden = false, lostReasonId?: string | null) {
  const db = c.db;
  const from = stageOf(db, o.stageId);
  const now = nowIso();
  db.orderStageHistory.push({ id: uid(), orderId: o.id, fromStageId: from.id, toStageId: to.id, changedById: c.user.id, changedAt: now, comment: comment ?? null, durationHours: Math.round((Date.now() - Date.parse(o.stageChangedAt)) / HOUR), overridden });
  Object.assign(o, {
    stageId: to.id,
    stageChangedAt: now,
    finishedAt: to.kind !== 'open' ? now : null,
    lostReasonId: to.kind === 'lost' ? lostReasonId : null,
    lostComment: to.kind === 'lost' ? comment : null,
    version: o.version + 1,
    updatedAt: now,
  });
  const text = overridden ? `Этап: «${from.name}» → «${to.name}» (проверки пропущены: ${comment})` : `Этап: «${from.name}» → «${to.name}»${comment ? `. ${comment}` : ''}`;
  systemComment(c, o.id, text, { event: 'stage', from: from.code, to: to.code, overridden });
  return from;
}

route('POST', '/orders/:id/stage', (c, p, _q, body) => {
  need(c!, PERMISSIONS.ordersView);
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  const input = parse(stageChangeSchema, body);
  const to = stagesOf(db, o.type).find((s) => s.code === input.stageCode);
  if (!to) throw bad('Такого этапа нет в воронке');
  const from = stageOf(db, o.stageId);
  const items = db.orderItems.filter(by('orderId', o.id));
  const approvals = db.orderApprovals.filter(by('orderId', o.id)).sort((a, b) => b.version - a.version);
  const totals = totalsOf(db, o);
  const assignees = db.orderAssignees.filter(by('orderId', o.id));
  const result = checkTransition({
    from: from as StageInfo,
    to: to as StageInfo,
    facts: {
      type: o.type,
      hasEquipment: !!o.equipmentId,
      // В демо без загрузки файлов приёмка проходила бы только с фото — считаем фото демо-заказов загруженными.
      photoCount: db.files.filter((f) => f.orderId === o.id && f.mimeType.startsWith('image/')).length || (o.createdAt < db.exportedAt ? 1 : 0),
      approvedItemsCount: items.filter((i) => i.status === 'approved').length,
      proposedItemsCount: items.filter((i) => i.status === 'proposed').length,
      assigneesCount: assignees.length,
      hasApproval: !!approvals[0],
      approvalMatchesTotal: !!approvals[0] && num(approvals[0].totalKop) === totals.totalKop,
      isAssignee: assignees.some((a) => a.userId === c!.user.id),
      lostReasonId: input.lostReasonId,
    },
    permissions: c!.perms,
    comment: input.comment,
    override: input.override,
  });
  if (result.denied.length) throw new HttpError(403, 'FORBIDDEN', result.denied[0], result.denied.map((reason) => ({ reason })));
  if (result.blockers.length) {
    throw new HttpError(
      422,
      'STAGE_TRANSITION_BLOCKED',
      `Нельзя перевести заказ в «${to.name}»: ${result.blockers[0].charAt(0).toLowerCase()}${result.blockers[0].slice(1)}`,
      result.blockers.map((reason) => ({ reason })),
    );
  }
  moveStage(c!, o, to, input.comment, result.overridden, input.lostReasonId);
  notify(c!, [o.managerId, ...assignees.map((a) => a.userId)], { type: 'stage_changed', title: `${o.number}: ${to.name}`, body: `${c!.user.fullName} перевёл заказ из «${from.name}»`, link: `/orders/${o.id}` });
  emit('order.stageChanged', { id: o.id });
  emit('comment.created', { orderId: o.id });
  return { ok: true, overridden: result.overridden };
});

route('POST', '/orders/:id/items', (c, p, _q, body) => {
  const full = c!.perms.has(PERMISSIONS.ordersEditEstimate);
  if (!full && !c!.perms.has(PERMISSIONS.ordersProposeItems)) throw forbidden();
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  const input = parse(orderItemSchema, body);
  if (!full && !db.orderAssignees.some((a) => a.orderId === o.id && a.userId === c!.user.id)) throw forbidden('Предлагать позиции может мастер этого заказа');
  if (stageOf(db, o.stageId).kind !== 'open') throw conflict('Заказ закрыт, смету изменить нельзя');
  const item = {
    id: uid(),
    orderId: o.id,
    kind: input.kind,
    name: input.name,
    quantity: String(input.quantity),
    unit: input.unit,
    priceKop: full ? input.priceKop : 0,
    costKop: full ? input.costKop : 0,
    discountPercent: String(full ? input.discountPercent : 0),
    status: full ? (input.status ?? 'approved') : 'proposed',
    isExtra: db.orderApprovals.some(by('orderId', o.id)),
    sort: db.orderItems.filter(by('orderId', o.id)).length,
    proposedById: full ? null : c!.user.id,
    createdAt: nowIso(),
  };
  db.orderItems.push(item);
  recalc(c!, o);
  if (!full) {
    systemComment(c!, o.id, `Мастер предложил: ${input.name} × ${input.quantity} ${input.unit}`, { event: 'proposed' });
    notify(c!, [o.managerId], { type: 'comment_new', title: `${o.number}: мастер предложил позицию`, body: input.name, link: `/orders/${o.id}` });
  }
  emit('order.updated', { id: o.id });
  return item;
});
function itemOr404(c: Ctx, id: string) {
  const item = c.db.orderItems.find(by('id', id));
  if (!item) throw notFound('Позиция');
  const o = orderOr404(c, item.orderId);
  if (stageOf(c.db, o.stageId).kind !== 'open') throw conflict('Заказ закрыт, смету изменить нельзя');
  return { item, o };
}
route('PATCH', '/order-items/:id', (c, p, _q, body) => {
  need(c!, PERMISSIONS.ordersEditEstimate);
  const { item, o } = itemOr404(c!, p.id);
  const input = parse(orderItemUpdateSchema, body);
  Object.assign(
    item,
    input,
    input.quantity !== undefined ? { quantity: String(input.quantity) } : {},
    input.discountPercent !== undefined ? { discountPercent: String(input.discountPercent) } : {},
    { isExtra: item.isExtra || c!.db.orderApprovals.some(by('orderId', o.id)) },
  );
  recalc(c!, o);
  emit('order.updated', { id: o.id });
});
route('DELETE', '/order-items/:id', (c, p) => {
  need(c!, PERMISSIONS.ordersEditEstimate);
  const { item, o } = itemOr404(c!, p.id);
  c!.db.orderItems = c!.db.orderItems.filter((i) => i !== item);
  recalc(c!, o);
  emit('order.updated', { id: o.id });
});
route('POST', '/orders/:id/approve-estimate', (c, p, _q, body) => {
  need(c!, PERMISSIONS.ordersEditEstimate);
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  const input = parse(approveEstimateSchema, body);
  const items = db.orderItems.filter(by('orderId', o.id));
  if (items.some((i) => i.status === 'proposed')) throw conflict('В смете есть предложенные мастером позиции — утвердите или отклоните их');
  if (!items.some((i) => i.status === 'approved')) throw conflict('Смета пустая');
  const totals = totalsOf(db, o);
  const version = (db.orderApprovals.filter(by('orderId', o.id)).reduce((m, a) => Math.max(m, a.version), 0) ?? 0) + 1;
  db.orderApprovals.push({ id: uid(), orderId: o.id, version, totalKop: totals.totalKop, approvedAt: nowIso(), method: input.method, approvedByName: input.approvedByName, createdById: c!.user.id });
  items.forEach((i) => (i.isExtra = false));
  o.version += 1;
  systemComment(c!, o.id, `Смета${version > 1 ? ` (версия ${version})` : ''} согласована: ${input.approvedByName}, ${APPROVAL_METHOD_LABELS[input.method].toLowerCase()}`, { event: 'approved', version });
  notify(c!, db.orderAssignees.filter(by('orderId', o.id)).map((a) => a.userId), { type: 'stage_changed', title: `${o.number}: смета согласована`, link: `/orders/${o.id}` });
  emit('order.updated', { id: o.id });
});

// --- Лента заказа ---
route('GET', '/orders/:id/comments', (c, p) => {
  need(c!, PERMISSIONS.ordersView);
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  return {
    items: db.comments
      .filter(by('orderId', o.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((x) => ({ ...x, text: x.deletedAt ? '' : x.text, files: x.deletedAt ? [] : db.files.filter((f) => f.commentId === x.id && f.url).map(fileDto) })),
    lastReadAt: db.orderReads.find((r) => r.orderId === o.id && r.userId === c!.user.id)?.lastReadAt ?? null,
  };
});
function markRead(c: Ctx, orderId: string) {
  const r = c.db.orderReads.find((x) => x.orderId === orderId && x.userId === c.user.id);
  if (r) r.lastReadAt = nowIso();
  else c.db.orderReads.push({ orderId, userId: c.user.id, lastReadAt: nowIso() });
}
route('POST', '/orders/:id/comments', (c, p, _q, body) => {
  need(c!, PERMISSIONS.commentsWrite);
  const db = c!.db;
  const o = orderOr404(c!, p.id);
  const input = parse(commentSchema, body);
  if (!input.text.trim() && !input.fileIds.length) throw bad('Напишите комментарий или приложите файл');
  const lower = input.text.toLowerCase();
  const mentions = db.users.filter((u) => lower.includes('@' + u.fullName.toLowerCase())).map((u) => u.id);
  const comment = { id: uid(), orderId: o.id, authorId: c!.user.id, kind: 'comment', text: input.text.trim(), mentions, payload: null, editedAt: null, deletedAt: null, createdAt: nowIso() };
  db.comments.push(comment);
  db.files.filter((f) => input.fileIds.includes(f.id) && f.uploadedById === c!.user.id).forEach((f) => Object.assign(f, { commentId: comment.id, orderId: o.id }));
  markRead(c!, o.id);
  notify(c!, mentions, { type: 'mention', title: `${c!.user.fullName} упомянул вас в ${o.number}`, body: input.text.slice(0, 200), link: `/orders/${o.id}` });
  const watchers = [o.managerId, ...db.orderAssignees.filter(by('orderId', o.id)).map((a) => a.userId)].filter((id) => id && !mentions.includes(id));
  notify(c!, watchers, { type: 'comment_new', title: `Новый комментарий в ${o.number}`, body: `${c!.user.fullName}: ${input.text.slice(0, 150)}`, link: `/orders/${o.id}` });
  emit('comment.created', { orderId: o.id });
  emit('order.updated', { id: o.id });
  return comment;
});
route('POST', '/orders/:id/read', (c, p) => {
  markRead(c!, orderOr404(c!, p.id).id);
});
function editComment(c: Ctx, id: string, text: string | null) {
  const x = c.db.comments.find((k) => k.id === id && k.kind === 'comment');
  if (!x) throw notFound('Комментарий');
  orderOr404(c, x.orderId);
  const director = c.roles.includes('director') || c.roles.includes('admin');
  const fresh = x.authorId === c.user.id && Date.now() - Date.parse(x.createdAt) < 15 * 60_000;
  if (!fresh && !director) throw forbidden('Комментарий можно изменить в течение 15 минут после отправки');
  if (text === null) x.deletedAt = nowIso();
  else Object.assign(x, { text, editedAt: nowIso() });
  emit('comment.updated', { orderId: x.orderId });
  return x;
}
route('PATCH', '/comments/:id', (c, p, _q, body) => {
  need(c!, PERMISSIONS.commentsWrite);
  const text = String(body?.text ?? '').trim();
  if (!text) throw bad('Комментарий не может быть пустым', 'text');
  return editComment(c!, p.id, text.slice(0, 10000));
});
route('DELETE', '/comments/:id', (c, p) => {
  need(c!, PERMISSIONS.commentsWrite);
  editComment(c!, p.id, null);
});

// --- Файлы (в демо — хранятся в браузере как data URL) ---
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain)$/;
route('POST', '/files', async (c, _p, q, body: FormData) => {
  const file = body instanceof FormData ? (body.get('file') as File | null) : null;
  if (!file) throw bad('Файл не передан');
  if (file.size > 2 * 1024 * 1024) throw bad('В демо можно загрузить файл до 2 МБ');
  if (!ALLOWED.test(file.type)) throw bad('Такой тип файла загрузить нельзя');
  const orderId = q.get('orderId');
  if (orderId) orderOr404(c!, orderId);
  const url = await new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error('Не удалось прочитать файл'));
    r.readAsDataURL(file);
  });
  const row = { id: uid(), companyId: c!.db.company.id, storageKey: '', originalName: file.name, mimeType: file.type, sizeBytes: file.size, uploadedById: c!.user.id, orderId, commentId: null, visitId: q.get('visitId'), createdAt: nowIso(), url };
  c!.db.files.push(row);
  return fileDto(row);
});

// --- Задачи ---
function taskView(db: DemoDb, t: Row) {
  const o = db.orders.find(by('id', t.orderId));
  const cl = db.clients.find(by('id', t.clientId));
  return { ...t, order: o ? { id: o.id, number: o.number, title: o.title } : null, client: cl ? { id: cl.id, name: cl.name } : null };
}
route('GET', '/tasks', (c, _p, q) => {
  const db = c!.db;
  const scope = q.get('scope') ?? 'mine';
  const status = q.get('status') ?? 'open';
  let rows = db.tasks.filter((t) => t.status === status);
  if (q.get('orderId')) rows = rows.filter((t) => t.orderId === q.get('orderId'));
  else if (q.get('clientId')) rows = rows.filter((t) => t.clientId === q.get('clientId'));
  else if (scope === 'mine') rows = rows.filter((t) => t.assigneeId === c!.user.id);
  else if (scope === 'created') rows = rows.filter((t) => t.authorId === c!.user.id && t.assigneeId !== c!.user.id);
  else if (!c!.perms.has(PERMISSIONS.tasksViewAll)) rows = rows.filter((t) => t.assigneeId === c!.user.id || t.authorId === c!.user.id);
  return rows
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 300)
    .map((t) => taskView(db, t));
});
route('POST', '/tasks', (c, _p, _q, body) => {
  const db = c!.db;
  const input = parse(taskCreateSchema, body);
  const t = { id: uid(), companyId: db.company.id, ...input, authorId: c!.user.id, status: 'open', completedAt: null, resultComment: null, isAuto: false, createdAt: nowIso(), updatedAt: nowIso() };
  db.tasks.push(t);
  if (t.orderId) {
    systemComment(c!, t.orderId, `Поставлена задача: ${t.title}`, { event: 'task', taskId: t.id });
    emit('comment.created', { orderId: t.orderId });
  }
  notify(c!, [t.assigneeId], { type: 'task_assigned', title: `Новая задача от ${c!.user.fullName}`, body: t.title, link: t.orderId ? `/orders/${t.orderId}?tab=tasks` : '/tasks' });
  emit('task.changed', { id: t.id });
  return taskView(db, t);
});
route('PATCH', '/tasks/:id', (c, p, _q, body) => {
  const db = c!.db;
  const t = db.tasks.find(by('id', p.id));
  if (!t) throw notFound('Задача');
  if (t.assigneeId !== c!.user.id && t.authorId !== c!.user.id && !c!.perms.has(PERMISSIONS.tasksViewAll)) throw forbidden('Это не ваша задача');
  const input = parse(taskUpdateSchema, body);
  const completing = input.status === 'done' && t.status !== 'done';
  const beforeAssignee = t.assigneeId;
  Object.assign(t, input, { completedAt: input.status === 'done' ? nowIso() : input.status === 'open' ? null : t.completedAt, updatedAt: nowIso() });
  if (completing) {
    if (t.orderId) {
      systemComment(c!, t.orderId, `Задача выполнена: ${t.title}${input.resultComment ? `. ${input.resultComment}` : ''}`, { event: 'task_done', taskId: t.id });
      emit('comment.created', { orderId: t.orderId });
    }
    notify(c!, [t.authorId], { type: 'task_done', title: `${c!.user.fullName} выполнил задачу`, body: t.title, link: '/tasks?scope=created' });
  }
  if (input.assigneeId && input.assigneeId !== beforeAssignee) notify(c!, [input.assigneeId], { type: 'task_assigned', title: 'Вам передана задача', body: t.title, link: '/tasks' });
  emit('task.changed', { id: t.id });
  return taskView(db, t);
});

// --- Выезды ---
function visitView(db: DemoDb, v: Row) {
  const o = db.orders.find(by('id', v.orderId))!;
  const cl = db.clients.find(by('id', o.clientId))!;
  const eq = db.equipment.find(by('id', o.equipmentId));
  const s = stageOf(db, o.stageId);
  return {
    ...v,
    assignees: db.visitAssignees.filter(by('visitId', v.id)),
    files: db.files.filter((f) => f.visitId === v.id && f.url).map(fileDto),
    order: {
      id: o.id,
      number: o.number,
      title: o.title,
      type: o.type,
      complaint: o.complaint,
      managerId: o.managerId,
      client: { id: cl.id, name: cl.name, phone: cl.phone },
      equipment: eq ? { id: eq.id, name: eq.name, model: eq.model, serialNumber: eq.serialNumber } : null,
      stage: { code: s.code, name: s.name, color: s.color },
    },
  };
}
function visitOr404(c: Ctx, id: string) {
  const v = c.db.visits.find(by('id', id));
  if (!v) throw notFound('Выезд');
  orderOr404(c, v.orderId);
  return v;
}
function conflicts(db: DemoDb, masterIds: string[], start: string, end: string, excludeId?: string) {
  return db.visits
    .filter((v) => v.id !== excludeId && ['planned', 'on_the_way', 'on_site'].includes(v.status) && v.plannedStartAt < end && v.plannedEndAt > start)
    .map((v) => ({ v, masters: db.visitAssignees.filter((a) => a.visitId === v.id && masterIds.includes(a.userId)).map((a) => a.userId) }))
    .filter((x) => x.masters.length)
    .map((x) => ({ visitId: x.v.id, orderNumber: db.orders.find(by('id', x.v.orderId))!.number, start: x.v.plannedStartAt, masterIds: x.masters }));
}
function moveFieldOrder(c: Ctx, o: Row, code: string, comment: string) {
  if (o.type !== 'repair_field') return;
  const from = stageOf(c.db, o.stageId);
  const to = stagesOf(c.db, o.type).find((s) => s.code === code);
  if (!to || to.id === from.id || to.sort < from.sort) return;
  moveStage(c, o, to, comment);
}
const fmtShort = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
route('GET', '/visits', (c, _p, q) => {
  need(c!, PERMISSIONS.visitsView);
  const db = c!.db;
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  return db.visits
    .filter((v) => v.plannedStartAt < to && v.plannedEndAt > from)
    .filter((v) => orderVisible(c!, db.orders.find(by('id', v.orderId))!))
    .filter((v) => !q.get('masterId') || db.visitAssignees.some((a) => a.visitId === v.id && a.userId === q.get('masterId')))
    .sort((a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt))
    .map((v) => visitView(db, v));
});
route('GET', '/visits/:id', (c, p) => {
  need(c!, PERMISSIONS.visitsView);
  return visitView(c!.db, visitOr404(c!, p.id));
});
route('POST', '/visits', (c, _p, _q, body) => {
  need(c!, PERMISSIONS.visitsPlan);
  const db = c!.db;
  const input = parse(visitCreateSchema, body);
  const o = orderOr404(c!, input.orderId);
  if (stageOf(db, o.stageId).kind !== 'open') throw conflict('Заказ закрыт');
  if (input.plannedEndAt <= input.plannedStartAt) throw bad('Окончание должно быть позже начала', 'plannedEndAt');
  const warnings = conflicts(db, input.masterIds, input.plannedStartAt, input.plannedEndAt);
  const v = { id: uid(), companyId: db.company.id, orderId: o.id, status: 'planned', plannedStartAt: input.plannedStartAt, plannedEndAt: input.plannedEndAt, address: input.address, contactName: input.contactName, contactPhone: input.contactPhone, departedAt: null, arrivedAt: null, finishedAt: null, travelKm: null, result: null, report: null, createdById: c!.user.id, createdAt: nowIso(), updatedAt: nowIso() };
  db.visits.push(v);
  input.masterIds.forEach((userId) => {
    db.visitAssignees.push({ visitId: v.id, userId });
    if (!db.orderAssignees.some((a) => a.orderId === o.id && a.userId === userId)) db.orderAssignees.push({ orderId: o.id, userId, isLead: false });
  });
  systemComment(c!, o.id, `Запланирован выезд на ${fmtShort(v.plannedStartAt)}, ${v.address}`, { event: 'visit', visitId: v.id });
  moveFieldOrder(c!, o, 'visit_planned', 'выезд запланирован');
  notify(c!, input.masterIds, { type: 'visit_assigned', title: `Выезд ${fmtShort(v.plannedStartAt)}: ${o.number}`, body: v.address, link: `/visits/${v.id}` });
  emit('visit.changed', { id: v.id });
  emit('order.updated', { id: o.id });
  return { visit: v, warnings };
});
route('PATCH', '/visits/:id', (c, p, _q, body) => {
  need(c!, PERMISSIONS.visitsPlan);
  const db = c!.db;
  const v = visitOr404(c!, p.id);
  const input = parse(visitUpdateSchema, body);
  const start = input.plannedStartAt ?? v.plannedStartAt;
  const end = input.plannedEndAt ?? v.plannedEndAt;
  const masters = input.masterIds ?? db.visitAssignees.filter(by('visitId', v.id)).map((a) => a.userId);
  const warnings = conflicts(db, masters, start, end, v.id);
  Object.assign(v, { plannedStartAt: start, plannedEndAt: end }, input.address ? { address: input.address } : {}, { updatedAt: nowIso() });
  if (input.masterIds) db.visitAssignees = db.visitAssignees.filter((a) => a.visitId !== v.id).concat(input.masterIds.map((userId) => ({ visitId: v.id, userId })));
  emit('visit.changed', { id: v.id });
  return { warnings };
});
route('POST', '/visits/:id/status', (c, p, _q, body) => {
  need(c!, PERMISSIONS.visitsView);
  const db = c!.db;
  const v = visitOr404(c!, p.id);
  const input = parse(visitStatusSchema, body);
  const isMaster = db.visitAssignees.some((a) => a.visitId === v.id && a.userId === c!.user.id);
  if (!(isMaster && c!.perms.has(PERMISSIONS.visitsWork)) && !c!.perms.has(PERMISSIONS.visitsPlan)) throw forbidden('Отмечать работу на выезде может только назначенный мастер');
  if (input.status === 'done' && !input.result) throw bad('Выберите результат выезда', 'result');
  const at = input.at ?? nowIso();
  v.status = input.status;
  if (input.status === 'on_the_way') v.departedAt = at;
  if (input.status === 'on_site') v.arrivedAt = at;
  if (input.status === 'done') Object.assign(v, { finishedAt: at, result: input.result, report: input.report, travelKm: input.travelKm });
  const o = db.orders.find(by('id', v.orderId))!;
  const label = input.status === 'done' && input.result ? `${VISIT_STATUS_LABELS.done}: ${VISIT_RESULT_LABELS[input.result].toLowerCase()}` : VISIT_STATUS_LABELS[input.status];
  systemComment(c!, o.id, `Выезд — ${label}${input.report ? `. ${input.report}` : ''}`, { event: 'visit_status', visitId: v.id, status: input.status });
  let childOrderId: string | null = null;
  if (input.status === 'on_site') moveFieldOrder(c!, o, 'on_site', 'мастер на объекте');
  if (input.status === 'done' && input.result === 'fixed') moveFieldOrder(c!, o, 'visit_done', 'работы на выезде завершены');
  if (input.status === 'done' && input.result === 'need_workshop') {
    const child = createOrder(c!, {
      type: 'repair_workshop',
      clientId: o.clientId,
      contactId: o.contactId,
      equipmentId: o.equipmentId,
      title: o.title,
      complaint: [o.complaint, input.report ? `Отчёт выезда: ${input.report}` : null].filter(Boolean).join('\n\n'),
      managerId: o.managerId,
      masterIds: db.visitAssignees.filter(by('visitId', v.id)).map((a) => a.userId),
      priority: o.priority,
      isWarrantyCase: o.isWarrantyCase,
      parentOrderId: o.id,
    });
    childOrderId = child.id;
    moveFieldOrder(c!, o, 'moved_to_workshop', `создан заказ ${child.number}`);
  }
  if (input.status === 'done' && input.result === 'need_revisit' && o.managerId) {
    db.tasks.push({ id: uid(), companyId: db.company.id, title: `Запланировать повторный выезд по ${o.number}`, description: null, assigneeId: o.managerId, authorId: c!.user.id, dueAt: null, status: 'open', completedAt: null, resultComment: null, priority: 'high', orderId: o.id, clientId: o.clientId, leadId: null, isAuto: true, createdAt: nowIso(), updatedAt: nowIso() });
  }
  notify(c!, [o.managerId], { type: 'stage_changed', title: `${o.number}: выезд — ${VISIT_STATUS_LABELS[input.status].toLowerCase()}`, body: input.report ?? undefined, link: `/orders/${o.id}` });
  emit('visit.changed', { id: v.id });
  emit('order.updated', { id: o.id });
  return { childOrderId };
});

// --- Чат ---
route('GET', '/chat/channels', (c) => {
  const db = c!.db;
  const general = db.chatChannels.find(by('type', 'general'));
  if (general && !db.chatMembers.some((m) => m.channelId === general.id && m.userId === c!.user.id)) db.chatMembers.push({ channelId: general.id, userId: c!.user.id, lastReadAt: nowIso() });
  const order: Record<string, number> = { general: 0, group: 1, direct: 2 };
  return db.chatChannels
    .filter((ch) => db.chatMembers.some((m) => m.channelId === ch.id && m.userId === c!.user.id))
    .map((ch) => {
      const members = db.chatMembers.filter(by('channelId', ch.id));
      const me = members.find(by('userId', c!.user.id))!;
      const msgs = db.chatMessages.filter((m) => m.channelId === ch.id && !m.deletedAt);
      return {
        id: ch.id,
        type: ch.type,
        name: ch.name,
        memberIds: members.map((m) => m.userId),
        lastMessage: msgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
        unread: msgs.filter((m) => m.authorId !== c!.user.id && m.createdAt > me.lastReadAt).length,
      };
    })
    .sort((a, b) => order[a.type] - order[b.type] || (b.lastMessage?.createdAt ?? '').localeCompare(a.lastMessage?.createdAt ?? ''));
});
function memberOf(c: Ctx, channelId: string) {
  const ch = c.db.chatChannels.find(by('id', channelId));
  if (!ch) throw notFound('Канал');
  if (!c.db.chatMembers.some((m) => m.channelId === ch.id && m.userId === c.user.id)) throw forbidden('Вы не участник этого канала');
  return ch;
}
route('GET', '/chat/channels/:id/messages', (c, p) => {
  memberOf(c!, p.id);
  return c!.db.chatMessages
    .filter(by('channelId', p.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-100)
    .map((m) => (m.deletedAt ? { ...m, text: '' } : m));
});
route('POST', '/chat/channels/:id/messages', (c, p, _q, body) => {
  const db = c!.db;
  const ch = memberOf(c!, p.id);
  const { text } = parse(chatMessageSchema, body);
  const msg = { id: uid(), channelId: ch.id, authorId: c!.user.id, text, createdAt: nowIso(), editedAt: null, deletedAt: null };
  db.chatMessages.push(msg);
  db.chatMembers.find((m) => m.channelId === ch.id && m.userId === c!.user.id)!.lastReadAt = msg.createdAt;
  const others = db.chatMembers.filter((m) => m.channelId === ch.id && m.userId !== c!.user.id).map((m) => m.userId);
  const lower = text.toLowerCase();
  const mentioned = db.users.filter((u) => others.includes(u.id) && lower.includes('@' + u.fullName.toLowerCase())).map((u) => u.id);
  notify(c!, ch.type === 'direct' ? others : mentioned, {
    type: 'mention',
    title: ch.type === 'direct' ? `Сообщение от ${c!.user.fullName}` : `${c!.user.fullName} упомянул вас в «${ch.name}»`,
    body: text.slice(0, 200),
    link: `/chat/${ch.id}`,
  });
  emit('chat.message', { channelId: ch.id });
  return msg;
});
route('POST', '/chat/channels/:id/read', (c, p) => {
  memberOf(c!, p.id);
  c!.db.chatMembers.find((m) => m.channelId === p.id && m.userId === c!.user.id)!.lastReadAt = nowIso();
});
route('POST', '/chat/channels', (c, _p, _q, body) => {
  need(c!, PERMISSIONS.settingsManage);
  const input = parse(chatChannelSchema, body);
  const ch = { id: uid(), companyId: c!.db.company.id, type: 'group', name: input.name, createdAt: nowIso() };
  c!.db.chatChannels.push(ch);
  [...new Set([c!.user.id, ...input.memberIds])].forEach((userId) => c!.db.chatMembers.push({ channelId: ch.id, userId, lastReadAt: nowIso() }));
  emit('chat.channels');
  return ch;
});
route('POST', '/chat/direct', (c, _p, _q, body) => {
  const db = c!.db;
  const { userId } = parse(directChannelSchema, body);
  if (userId === c!.user.id) throw bad('Нельзя написать самому себе');
  if (!db.users.some(by('id', userId))) throw notFound('Сотрудник');
  const existing = db.chatChannels.find(
    (ch) => ch.type === 'direct' && [c!.user.id, userId].every((u) => db.chatMembers.some((m) => m.channelId === ch.id && m.userId === u)),
  );
  if (existing) return existing;
  const ch = { id: uid(), companyId: db.company.id, type: 'direct', name: null, createdAt: nowIso() };
  db.chatChannels.push(ch);
  db.chatMembers.push({ channelId: ch.id, userId: c!.user.id, lastReadAt: nowIso() }, { channelId: ch.id, userId, lastReadAt: nowIso() });
  return ch;
});

// --- Уведомления ---
route('GET', '/notifications', (c, _p, q) => {
  const mine = c!.db.notifications.filter(by('userId', c!.user.id));
  return {
    items: mine
      .filter((n) => q.get('unread') !== 'true' || !n.readAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50),
    unread: mine.filter((n) => !n.readAt).length,
  };
});
route('POST', '/notifications/read', (c, _p, _q, body) => {
  const ids: string[] | undefined = body?.ids;
  c!.db.notifications.filter((n) => n.userId === c!.user.id && !n.readAt && (!ids?.length || ids.includes(n.id))).forEach((n) => (n.readAt = nowIso()));
});

// --- Дашборд (как apps/api/src/dashboard) ---
route('GET', '/dashboard', (c) => {
  const db = c!.db;
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * HOUR).toISOString();
  const weekAgo = new Date(now - 7 * 24 * HOUR).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const visible = db.orders.filter((o) => orderVisible(c!, o));
  const withStage = visible.map((o) => ({ o, s: stageOf(db, o.stageId) }));
  const open = withStage.filter((x) => x.s.kind === 'open');
  const brief = ({ o, s }: { o: Row; s: Row }) => ({
    id: o.id,
    number: o.number,
    title: o.title,
    type: o.type,
    managerId: o.managerId,
    plannedFinishAt: o.plannedFinishAt,
    stageChangedAt: o.stageChangedAt,
    client: { name: db.clients.find(by('id', o.clientId))!.name },
    stage: { code: s.code, name: s.name, color: s.color, normHours: s.normHours, sort: s.sort },
    assignees: db.orderAssignees.filter(by('orderId', o.id)).map((a) => ({ userId: a.userId })),
  });
  const stuck = open
    .filter(({ o, s }) => s.normHours && now - Date.parse(o.stageChangedAt) > s.normHours * HOUR)
    .map((x) => ({ ...brief(x), hoursOnStage: Math.round((now - Date.parse(x.o.stageChangedAt)) / HOUR) }))
    .sort((a, b) => b.hoursOnStage - a.hoursOnStage);
  const byStage = new Map<string, Row>();
  for (const { o, s } of open) {
    const key = `${o.type}:${s.code}`;
    const row = byStage.get(key) ?? { type: o.type, code: s.code, name: s.name, color: s.color, sort: s.sort, count: 0 };
    row.count++;
    byStage.set(key, row);
  }
  const canLeads = c!.perms.has(PERMISSIONS.leadsView);
  const isDirector = c!.roles.includes('director');
  const leads = db.leads.filter((l) => l.status !== 'spam');
  const vis = priceVis(c!);
  const done = withStage.filter((x) => x.s.kind === 'won' && x.o.finishedAt >= monthStart);
  const overdueTasks = new Map<string, number>();
  if (c!.perms.has(PERMISSIONS.tasksViewAll)) {
    db.tasks.filter((t) => t.status === 'open' && t.dueAt && t.dueAt < nowIso()).forEach((t) => overdueTasks.set(t.assigneeId, (overdueTasks.get(t.assigneeId) ?? 0) + 1));
  }
  const mine = open.filter(({ o }) => o.managerId === c!.user.id || db.orderAssignees.some((a) => a.orderId === o.id && a.userId === c!.user.id));
  return {
    leads: canLeads
      ? {
          today: leads.filter((l) => l.createdAt >= dayStart.toISOString()).length,
          week: leads.filter((l) => l.createdAt >= weekAgo).length,
          overdue: db.leads.filter(leadOverdue).length,
          latest: db.leads
            .filter((l) => ['new', 'in_progress'].includes(l.status) && (isDirector || !l.assigneeId || l.assigneeId === c!.user.id))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 6)
            .map((l) => ({ ...l, client: l.clientId ? { name: db.clients.find(by('id', l.clientId))?.name } : null })),
        }
      : null,
    orders: {
      open: open.length,
      overdue: open.filter(({ o }) => o.plannedFinishAt && Date.parse(o.plannedFinishAt) < now).length,
      stuck: stuck.slice(0, 8),
      stuckCount: stuck.length,
      byStage: [...byStage.values()].sort((a, b) => a.type.localeCompare(b.type) || a.sort - b.sort),
      mine: mine.sort((a, b) => a.s.sort - b.s.sort).slice(0, 12).map(brief),
      ready: open.filter(({ s }) => s.code === 'ready').length,
      estimate: open.filter(({ s }) => s.code === 'estimate').length,
    },
    visitsToday: db.visits
      .filter((v) => v.plannedStartAt >= dayStart.toISOString() && v.plannedStartAt < dayEnd && v.status !== 'cancelled')
      .filter((v) => orderVisible(c!, db.orders.find(by('id', v.orderId))!))
      .filter((v) => c!.perms.has(PERMISSIONS.visitsPlan) || db.visitAssignees.some((a) => a.visitId === v.id && a.userId === c!.user.id))
      .sort((a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt))
      .map((v) => {
        const o = db.orders.find(by('id', v.orderId))!;
        return { id: v.id, status: v.status, plannedStartAt: v.plannedStartAt, address: v.address, assignees: db.visitAssignees.filter(by('visitId', v.id)), order: { id: o.id, number: o.number, client: { name: db.clients.find(by('id', o.clientId))!.name } } };
      }),
    tasks: db.tasks
      .filter((t) => t.assigneeId === c!.user.id && t.status === 'open' && (!t.dueAt || t.dueAt < dayEnd))
      .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
      .slice(0, 10)
      .map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, priority: t.priority, order: taskView(db, t).order })),
    overdueTasksByUser: [...overdueTasks.entries()].map(([userId, count]) => ({ userId, count })),
    money:
      vis.prices && c!.perms.has(PERMISSIONS.analyticsView)
        ? {
            inWorkKop: open.reduce((s, x) => s + num(x.o.totalKop), 0),
            doneMonthKop: done.reduce((s, x) => s + num(x.o.totalKop), 0),
            doneMonthCount: done.length,
            marginMonthKop: vis.margin ? done.reduce((s, x) => s + num(x.o.totalKop) - num(x.o.costKop), 0) : null,
          }
        : null,
  };
});

// ---------- Точка входа: fetch-совместимый обработчик ----------

let current: DemoDb | null = null;

function json(status: number, body?: unknown) {
  return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
    status: body === undefined && status === 200 ? 204 : status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function demoFetch(input: string, init: RequestInit = {}): Promise<Response> {
  current = await getDb();
  const url = new URL(input, window.location.origin);
  const path = url.pathname.replace(/^.*\/api\/v1/, '');
  const method = (init.method ?? 'GET').toUpperCase();
  const body = init.body instanceof FormData ? init.body : typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  // Небольшая задержка — как у настоящего сервера, чтобы были видны состояния загрузки.
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      const ctx = r.public ? null : ctxOf(current);
      const result = await r.handler(ctx, params, url.searchParams, body);
      if (method !== 'GET') save();
      return json(200, result);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message, details: e.details } });
      if (isValidationError(e)) {
        return json(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: e.issues[0]?.message ?? 'Проверьте заполнение полей',
            details: e.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
          },
        });
      }
      console.error('[demo]', e);
      return json(500, { error: { code: 'INTERNAL', message: 'Внутренняя ошибка демо' } });
    }
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'Не найдено' } });
}
