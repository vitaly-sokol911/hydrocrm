import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const api = process.env.VITE_API_TARGET ?? 'http://localhost:3000';
// Абсолютный адрес сайта для превью в соцсетях (og:image). Без него — относительный путь.
process.env.VITE_SITE_URL ??= process.env.VITE_BASE ?? '/';

/**
 * CSP для собранного интерфейса. На GitHub Pages нельзя задать заголовки — политика задаётся meta-тегом.
 * Стили inline разрешены: Ant Design генерирует их во время работы. Скрипты — только собственные файлы.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityMeta = (): Plugin => ({
  name: 'hydrocrm-security-meta',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    { tag: 'meta', attrs: { name: 'referrer', content: 'strict-origin-when-cross-origin' }, injectTo: 'head' },
  ],
});

export default defineConfig({
  // Для GitHub Pages сайт живёт в подпапке репозитория: VITE_BASE=/имя-репозитория/
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    securityMeta(),
    // ИНФ-20: установка на смартфон мастера. Кешируется только оболочка приложения, данные — всегда из API.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ГидроCRM',
        short_name: 'ГидроCRM',
        description: 'CRM для сервиса по ремонту и сборке гидростанций',
        lang: 'ru',
        theme_color: '#0e1f36',
        background_color: '#f3f5f9',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/, /^\/ws/],
        // Шрифты не кладём в предзагрузку: браузер скачивает только нужные алфавиты, кеш — по факту использования.
        globPatterns: ['**/*.{js,css,html,svg,png}', 'demo/*.json'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Общий пакет берём из исходников: изменения схем видны без пересборки.
      '@hydrocrm/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/ws': { target: api, ws: true, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // React — отдельным долгоживущим чанком; Ant Design делится по страницам автоматически.
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
});
