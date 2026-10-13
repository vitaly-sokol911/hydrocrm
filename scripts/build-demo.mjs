// Сборка демо для GitHub Pages: интерфейс + демо-сервер в браузере, без бэкенда.
// Использование: pnpm build:demo [базовый-путь] [адрес-сайта]
//   базовый путь — имя репозитория в адресе Pages, по умолчанию /hydrocrm/
//   адрес сайта — полный URL для превью в соцсетях, например https://user.github.io/hydrocrm/
// Имя и ссылка разработчика берутся из VITE_AUTHOR_NAME и VITE_AUTHOR_URL, если заданы.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = resolve(root, 'apps', 'web');
const outDir = resolve(web, 'dist-demo');
const base = process.argv[2] ?? process.env.VITE_BASE ?? '/hydrocrm/';
const site = process.argv[3] ?? process.env.VITE_SITE_URL ?? base;

if (!existsSync(resolve(web, 'public', 'demo', 'snapshot.json'))) {
  console.error('Нет apps/web/public/demo/snapshot.json — сначала выполните: pnpm --filter @hydrocrm/api export:demo');
  process.exit(1);
}

const env = { ...process.env, VITE_STATIC_DEMO: 'true', VITE_BASE: base, VITE_SITE_URL: site.endsWith('/') ? site : `${site}/` };
const vite = resolve(web, 'node_modules', 'vite', 'bin', 'vite.js');
const r = spawnSync(process.execPath, [vite, 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: web, env, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);

// GitHub Pages: прямые ссылки на внутренние страницы отдают 404.html — это тот же index.html.
copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
writeFileSync(resolve(outDir, '.nojekyll'), '');
console.log(`\nДемо собрано: ${outDir}\nБазовый путь: ${base}`);
