import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { App } from 'antd';
import { useMemo } from 'react';
import { api, ApiError } from './api';
import type { Dictionaries, User } from './types';

/** Сотрудники компании — по ним интерфейс подставляет имена ответственных и мастеров. */
export function useUsers() {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users'), staleTime: 5 * 60_000 });
  const byId = useMemo(() => new Map((q.data ?? []).map((u) => [u.id, u])), [q.data]);
  return {
    users: q.data ?? [],
    byId,
    name: (id: string | null | undefined) => (id ? byId.get(id)?.fullName ?? '—' : '—'),
    withRole: (role: string) => (q.data ?? []).filter((u) => u.isActive && u.roles.includes(role as never)),
  };
}

export function useDictionaries() {
  const q = useQuery({ queryKey: ['dictionaries'], queryFn: () => api.get<Dictionaries>('/dictionaries'), staleTime: 10 * 60_000 });
  return {
    ...q.data,
    loading: q.isLoading,
    pipeline: (type: string) => q.data?.pipelines.find((p) => p.orderType === type),
  };
}

/** Мутация с показом ошибки пользователю и обновлением нужных списков. */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { invalidate?: QueryKey[]; success?: string | ((r: TResult) => string); onSuccess?: (r: TResult, v: TVars) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await Promise.all((opts.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: k })));
      if (opts.success) message.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r, v);
    },
    onError: (e) => {
      if (!opts.silentError) message.error(e instanceof ApiError ? e.message : 'Что-то пошло не так');
    },
  });
}

/** Ошибки валидации сервера → поля формы Ant Design. */
export function fieldErrors(e: unknown): { name: string[]; errors: string[] }[] {
  if (!(e instanceof ApiError) || !e.details) return [];
  return e.details.filter((d) => d.field).map((d) => ({ name: d.field!.split('.'), errors: [d.reason] }));
}
