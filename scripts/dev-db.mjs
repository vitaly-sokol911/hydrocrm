// Встроенный PostgreSQL для разработки без Docker (docs/01-архитектура.md, АРХ-50).
//
// PostgreSQL на Windows не работает, если в пути к его программам или данным есть кириллица
// (папка проекта называется «срм»). Поэтому на Windows скрипт один раз копирует программы
// PostgreSQL из node_modules в %LOCALAPPDATA%\hydrocrm и запускает их оттуда. Данные тоже лежат там.
// На Linux и macOS используется пакет embedded-postgres как есть.
//
// Настройки: DEV_DB_PORT (5433), DEV_DB_PASSWORD (hydrocrm), DEV_DB_DIR (папка данных).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';

const port = Number(process.env.DEV_DB_PORT ?? 5433);
const user = 'hydrocrm';
const password = process.env.DEV_DB_PASSWORD ?? 'hydrocrm';
const dbName = 'hydrocrm';
const baseDir = resolve(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'hydrocrm');
const dataDir = process.env.DEV_DB_DIR ?? join(baseDir, 'pg');

const log = (...a) => console.log('[db]', ...a);

function waitForPort(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((ok, fail) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => {
        s.destroy();
        ok();
      });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - started > timeoutMs) fail(new Error('PostgreSQL не запустился за 30 секунд'));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

async function ensureDatabase() {
  // Сразу после открытия порта сервер может ещё отвечать «starting up» — повторяем.
  for (let attempt = 0; ; attempt++) {
    const client = new pg.Client({ host: '127.0.0.1', port, user, password, database: 'postgres' });
    try {
      await client.connect();
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (!rowCount) {
        await client.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8' TEMPLATE template0`);
        log('создана база', dbName);
      }
      await client.end();
      return;
    } catch (e) {
      await client.end().catch(() => {});
      if (attempt > 20) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function startWindows() {
  const require = createRequire(require_resolve_base());
  // package.json пакета не экспортируется, поэтому идём от точки входа вверх до корня пакета.
  const entry = require.resolve('@embedded-postgres/windows-x64');
  const pkgDir = entry.slice(0, entry.lastIndexOf('windows-x64') + 'windows-x64'.length);
  const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  const nativeSrc = join(pkgDir, 'native');
  const nativeDir = join(baseDir, `pgbin-${version}`);
  if (!existsSync(join(nativeDir, 'bin', 'postgres.exe'))) {
    log('копирую программы PostgreSQL в', nativeDir);
    mkdirSync(nativeDir, { recursive: true });
    cpSync(nativeSrc, nativeDir, { recursive: true });
  }
  const bin = (name) => join(nativeDir, 'bin', `${name}.exe`);

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    log('первый запуск: создаю кластер в', dataDir);
    mkdirSync(dirname(dataDir), { recursive: true });
    const pwFile = join(tmpdir(), `hydrocrm-pw-${process.pid}`);
    writeFileSync(pwFile, password);
    const r = spawnSync(
      bin('initdb'),
      ['-D', dataDir, '-U', user, `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C', '-A', 'scram-sha-256'],
      { encoding: 'utf8' },
    );
    rmSync(pwFile, { force: true });
    if (r.status !== 0) {
      console.error(r.stdout, r.stderr);
      throw new Error('initdb завершился с ошибкой');
    }
  }

  const child = spawn(bin('postgres'), ['-D', dataDir, '-p', String(port), '-c', 'listen_addresses=127.0.0.1'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (/FATAL|PANIC|ERROR/.test(text) && !/starting up/.test(text)) process.stderr.write('[db] ' + text);
  });
  child.on('exit', (code) => {
    log('PostgreSQL остановлен, код', code);
    process.exit(code ?? 0);
  });
  const stop = () => {
    // pg_ctl stop -m fast корректно завершает сервер на Windows.
    spawnSync(bin('pg_ctl'), ['stop', '-D', dataDir, '-m', 'fast'], { stdio: 'ignore' });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', stop);
  await waitForPort();
}

function require_resolve_base() {
  // embedded-postgres — зависимость корня, а платформенный пакет — его зависимость.
  return createRequire(import.meta.url).resolve('embedded-postgres');
}

async function startOther() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const db = new EmbeddedPostgres({ databaseDir: dataDir, user, password, port, persistent: true, onLog: () => {} });
  if (!existsSync(join(dataDir, 'PG_VERSION'))) await db.initialise();
  await db.start();
  const stop = async () => {
    await db.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.platform === 'win32') await startWindows();
else await startOther();
await ensureDatabase();
log(`PostgreSQL готов: postgresql://${user}:***@localhost:${port}/${dbName}`);
