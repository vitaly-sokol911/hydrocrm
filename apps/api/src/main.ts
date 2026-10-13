import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Переменные из apps/api/.env (в разработке). На сервере их задаёт docker compose.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

// BigInt (копейки) в JSON отдаём числом: суммы CRM помещаются в Number без потери точности.
(BigInt.prototype as unknown as { toJSON(): number }).toJSON = function (this: bigint) {
  return Number(this);
};

async function bootstrap() {
  const { AppModule } = await import('./app.module');
  const { config } = await import('./config');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api/v1', { exclude: [] });
  app.set('trust proxy', 1);
  // Защитные заголовки. CSP рассчитана на собранный интерфейс, который раздаёт этот же сервер:
  // скрипты только свои, стили inline (Ant Design генерирует их во время работы), картинки — свои и data:/blob:.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.disable('x-powered-by');
  if (!config.isProd) app.enableCors({ origin: config.webOrigin, credentials: true });
  app.enableShutdownHooks();
  await app.listen(config.port);
  new Logger('Bootstrap').log(`API: http://localhost:${config.port}/api/v1${config.demoMode ? ' (песочница)' : ''}`);
}

bootstrap();
