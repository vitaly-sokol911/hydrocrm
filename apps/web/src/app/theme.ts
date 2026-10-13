import { theme, type ThemeConfig } from 'antd';

/**
 * Визуальная система ГидроCRM (docs/аудит-портфолио.md, раздел 4).
 * Сталь — фон навигации, синий — действия, «масло HLP» — фирменный акцент (гидролиния, подсказки демо).
 * Шрифты: Onest — интерфейс, Unbounded — заголовки, JetBrains Mono — номера и цифры.
 */
export const BRAND = {
  steel: '#0e1f36',
  steelDark: '#0b141d',
  blue: '#1f5fbf',
  oil: '#e8a317',
  ink: '#14202e',
};

export function makeTheme(dark: boolean): ThemeConfig {
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: BRAND.blue,
      colorInfo: BRAND.blue,
      colorSuccess: '#2f9e44',
      colorWarning: '#d98a0b',
      colorError: '#d9363e',
      colorTextBase: dark ? '#e6ebf2' : BRAND.ink,
      borderRadius: 8,
      fontFamily: "'Onest Variable', 'Segoe UI', Roboto, system-ui, -apple-system, sans-serif",
      fontSize: 14,
      colorBgLayout: dark ? BRAND.steelDark : '#f3f5f9',
    },
    components: {
      Layout: { siderBg: dark ? '#111a24' : BRAND.steel, headerBg: dark ? '#111a24' : '#ffffff', headerPadding: '0 20px', headerHeight: 56 },
      Menu: {
        darkItemBg: dark ? '#111a24' : BRAND.steel,
        darkSubMenuItemBg: dark ? '#111a24' : BRAND.steel,
        darkItemSelectedBg: BRAND.blue,
        itemBorderRadius: 8,
      },
      Card: { paddingLG: 20 },
      Table: { headerBg: dark ? '#17212d' : '#f6f8fb', cellPaddingBlockSM: 6 },
      Typography: { titleMarginBottom: 0 },
    },
  };
}
