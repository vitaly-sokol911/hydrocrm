import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './shared/api';
import { AuthProvider } from './shared/auth';
import { AppRoutes } from './app/routes';
import { ThemeModeContext, type ThemeMode } from './app/theme-mode';
import { makeTheme } from './app/theme';
import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import '@fontsource/jetbrains-mono/500.css';
import './shared/format';
import './app/styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

function readMode(): ThemeMode {
  try {
    return (localStorage.getItem('hcrm-theme') as ThemeMode) || 'system';
  } catch {
    return 'system';
  }
}

function Root() {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = mode === 'dark' || (mode === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('hcrm-theme', mode);
    } catch {
      /* приватный режим */
    }
  }, [dark, mode]);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode, dark }}>
      <ConfigProvider locale={ruRU} theme={makeTheme(dark)}>
        <AntApp>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
              <AuthProvider>
                <AppRoutes />
              </AuthProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </AntApp>
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
