/* eslint-disable @typescript-eslint/no-explicit-any */
// Хранилище демо-данных в браузере посетителя.
// Источник — снимок public/demo/snapshot.json (pnpm --filter @hydrocrm/api export:demo). Даты сдвигаются
// относительно момента первой загрузки, поэтому данные всегда выглядят свежими.
// Изменения посетителя сохраняются в localStorage и видны во всех его вкладках (BroadcastChannel).

export type Row = Record<string, any>;

export interface DemoDb {
  exportedAt: string;
  company: Row;
  roles: Row[];
  users: Row[];
  userRoles: Row[];
  leadSources: Row[];
  rejectReasons: Row[];
  pipelines: Row[];
  stages: Row[];
  clients: Row[];
  contacts: Row[];
  equipment: Row[];
  leads: Row[];
  orders: Row[];
  orderAssignees: Row[];
  orderStageHistory: Row[];
  orderItems: Row[];
  orderApprovals: Row[];
  orderReads: Row[];
  visits: Row[];
  visitAssignees: Row[];
  comments: Row[];
  files: Row[];
  tasks: Row[];
  notifications: Row[];
  chatChannels: Row[];
  chatMembers: Row[];
  chatMessages: Row[];
  counters: Row[];
}

const KEY = 'hcrm-static-db-v1';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function shiftDates(value: any, offset: number): any {
  if (typeof value === 'string' && ISO.test(value)) return new Date(Date.parse(value) + offset).toISOString();
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, offset));
  if (value && typeof value === 'object') {
    const out: Row = {};
    for (const [k, v] of Object.entries(value)) out[k] = shiftDates(v, offset);
    return out;
  }
  return value;
}

let db: DemoDb | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('hcrm-demo') : null;
const listeners = new Set<(event: string, data: any) => void>();

async function fresh(): Promise<DemoDb> {
  const res = await fetch(`${import.meta.env.BASE_URL}demo/snapshot.json`);
  if (!res.ok) throw new Error('Не удалось загрузить данные');
  const snap = (await res.json()) as DemoDb;
  // Сдвигаем так, чтобы «сейчас» снимка совпало с текущим моментом.
  const offset = Date.now() - Date.parse(snap.exportedAt);
  const shifted = shiftDates(snap, offset) as DemoDb;
  return { ...shifted, orderReads: [], files: [] };
}

export async function getDb(): Promise<DemoDb> {
  if (db) return db;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) db = JSON.parse(saved) as DemoDb;
  } catch {
    db = null;
  }
  db ??= await fresh();
  return db;
}

export function save() {
  if (!db) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // Квота переполнена (много фото) — убираем вложенные изображения и пробуем ещё раз.
    try {
      db.files = db.files.map((f) => ({ ...f, url: null }));
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      /* без сохранения — данные живут до перезагрузки вкладки */
    }
  }
}

export async function resetDb() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  db = await fresh();
  save();
}

/** Событие «что изменилось» — для этой вкладки и для других вкладок посетителя. */
export function emit(event: string, data: any = {}) {
  listeners.forEach((l) => l(event, data));
  channel?.postMessage({ event, data });
}

export function onEvent(l: (event: string, data: any) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

channel?.addEventListener('message', (e: MessageEvent<{ event: string; data: any }>) => {
  // Другая вкладка изменила данные — перечитываем их из хранилища.
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) db = JSON.parse(saved) as DemoDb;
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(e.data.event, e.data.data));
});
