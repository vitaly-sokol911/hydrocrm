import { useQueryClient } from '@tanstack/react-query';
import type { Permission, RoleCode } from '@hydrocrm/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshToken, tokenStore } from './api';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  demoMode: boolean;
  can: (p: Permission) => boolean;
  hasRole: (r: RoleCode) => boolean;
  login: (email: string, password: string) => Promise<void>;
  demoLogin: (role: RoleCode) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/auth/me'));
    } catch {
      setMe(null);
      tokenStore.set(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cfg = await api.get<{ demoMode: boolean }>('/auth/config').catch(() => ({ demoMode: false }));
      setDemoMode(cfg.demoMode);
      if (await refreshToken()) await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  const afterLogin = useCallback(
    async (token: string) => {
      tokenStore.set(token);
      qc.clear();
      await loadMe();
    },
    [qc, loadMe],
  );

  const value = useMemo<AuthState>(() => {
    const perms = new Set(me?.user.permissions ?? []);
    return {
      me,
      loading,
      demoMode,
      can: (p) => perms.has(p),
      hasRole: (r) => !!me?.user.roles.includes(r),
      login: async (email, password) => afterLogin((await api.post<{ accessToken: string }>('/auth/login', { email, password })).accessToken),
      demoLogin: async (role) => afterLogin((await api.post<{ accessToken: string }>('/auth/demo-login', { role })).accessToken),
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        tokenStore.set(null);
        setMe(null);
        qc.clear();
      },
      reload: loadMe,
    };
  }, [me, loading, demoMode, afterLogin, loadMe, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth вне AuthProvider');
  return ctx;
}
