import type { Tx } from '../prisma/prisma.service';
import { requestContext } from './request-context';

/**
 * Человекочитаемый номер без пропусков: «З-2026-0042».
 * Счётчик увеличивается атомарно: upsert с increment блокирует строку до конца транзакции.
 */
export async function nextNumber(tx: Tx, key: string, prefix: string, date = new Date()): Promise<string> {
  const companyId = requestContext.companyId();
  if (!companyId) throw new Error('nextNumber вызван вне контекста компании');
  const year = date.getFullYear();
  const row = await tx.counter.upsert({
    where: { companyId_key_year: { companyId, key, year } },
    create: { companyId, key, year, last: 1 },
    update: { last: { increment: 1 } },
  });
  return `${prefix}-${year}-${String(row.last).padStart(4, '0')}`;
}
