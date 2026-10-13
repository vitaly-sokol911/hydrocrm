import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { requestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type Changes = Record<string, [unknown, unknown]>;

/** Журнал действий (АРХ-30…32): только дописывается. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(action: string, entityType: string, entityId: string | null, changes?: Changes, tx?: Tx) {
    const ctx = requestContext.get();
    const companyId = requestContext.companyId();
    if (!companyId) return;
    await (tx ?? this.prisma.db).auditLog.create({
      data: {
        companyId,
        userId: ctx?.user?.id,
        action,
        entityType,
        entityId,
        changes: changes ? (JSON.parse(JSON.stringify(changes)) as Prisma.InputJsonValue) : undefined,
        ip: ctx?.ip,
      },
    });
  }

  /** Разница между старой записью и изменениями: { поле: [было, стало] }. */
  static diff(before: Record<string, unknown>, patch: Record<string, unknown>): Changes {
    const out: Changes = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      const old = before[k];
      if (String(old ?? '') !== String(v ?? '')) out[k] = [old ?? null, v ?? null];
    }
    return out;
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
