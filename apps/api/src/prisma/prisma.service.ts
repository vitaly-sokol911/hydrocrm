import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant.extension';

export function createPrisma() {
  return new PrismaClient().$extends(tenantExtension);
}

export type Db = ReturnType<typeof createPrisma>;
/** Клиент внутри интерактивной транзакции. */
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];

/** Обёртка над расширенным Prisma-клиентом, внедряется в сервисы как `PrismaService`. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db: Db = createPrisma();

  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
