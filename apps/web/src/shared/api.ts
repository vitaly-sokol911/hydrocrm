import type { ApiErrorBody, ErrorCode } from '@hydrocrm/shared';

/** Ошибка API с кодом и текстом для пользователя (API-30…32). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: { field?: string; reason: string }[],
  ) {
    super(message);
  }
}

/** Демо-сборка без сервера (GitHub Pages): запросы обрабатывает демо-сервер в браузере. */
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true';

/** Как объяснить посетителю, что будет с его изменениями. */
export const DEMO_RESET_NOTE = STATIC_DEMO
  ? 'Ваши изменения видны только вам, исходные данные можно вернуть в один клик.'
  : 'Каждую ночь данные возвращаются к исходным.';

const doFetch = async (url: string, init: RequestInit): Promise<Response> => {
  if (!STATIC_DEMO) return fetch(url, init);
  const { demoFetch } = await import('../demo-static/server');
  return demoFetch(url, init);
};

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const tokenStore = {
  get: () => accessToken,
  set(token: string | null) {
    accessToken = token;
  },
};

/** Обновление access-токена по refresh-cookie (API-10). Параллельные запросы ждут один и тот же refresh. */
export function refreshToken(): Promise<boolean> {
  refreshing ??= doFetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) {
        tokenStore.set(null);
        return false;
      }
      tokenStore.set(((await r.json()) as { accessToken: string }).accessToken);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query) {
  const url = new URL('/api/v1' + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.pathname + url.search;
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await doFetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'include',
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'INTERNAL', 'Нет связи с сервером. Проверьте интернет');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshToken()) return request<T>(method, path, opts, false);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'INTERNAL', e?.message ?? `Ошибка ${res.status}`, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, { body: body ?? {}, query }),
  patch: <T>(path: string, body: unknown, query?: Query) => request<T>('PATCH', path, { body, query }),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File | Blob, query?: Query, name = 'file') => {
    const form = new FormData();
    form.append('file', file, file instanceof File ? file.name : name);
    return request<T>('POST', path, { form, query });
  },
};
