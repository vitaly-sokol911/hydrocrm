import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export const ThemeModeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void; dark: boolean }>({
  mode: 'system',
  setMode: () => {},
  dark: false,
});

export const useThemeMode = () => useContext(ThemeModeContext);
