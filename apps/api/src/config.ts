import { resolve } from 'node:path';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: (() => {
    const s = required('JWT_SECRET', isProd ? undefined : 'dev-only-secret-change-me');
    if (isProd && s.length < 32) throw new Error('JWT_SECRET должен быть не короче 32 символов');
    return s;
  })(),
  accessTtlSec: 15 * 60,
  refreshTtlDays: 30,
  demoMode: process.env.DEMO_MODE === 'true',
  uploadsDir: resolve(process.cwd(), process.env.UPLOADS_DIR ?? '../../.data/uploads'),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  /** Собранный интерфейс, который API раздаёт сам (один процесс на сервере). */
  webDistDir: process.env.WEB_DIST_DIR ? resolve(process.cwd(), process.env.WEB_DIST_DIR) : null,
  maxUploadBytes: 20 * 1024 * 1024,
};
