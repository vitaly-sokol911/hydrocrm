import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { requestContext } from './request-context';

/** Настройки компании (docs/02-роли-и-права.md §5, ИНФ §8). Хранятся в companies.settings. */
export interface CompanySettings {
  managerOwnOnly: boolean;
  showMarginToManagers: boolean;
  discountLimitPercent: number;
  masterSeesPrices: boolean;
  /** Рабочее время для сроков реакции на заявки: часы и дни недели (1 = понедельник). */
  workStartHour: number;
  workEndHour: number;
  workDays: number[];
  leadResponseHours: number;
  visitPriceKop: number;
  visitKmPriceKop: number;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  managerOwnOnly: false,
  showMarginToManagers: false,
  discountLimitPercent: 10,
  masterSeesPrices: false,
  workStartHour: 9,
  workEndHour: 18,
  workDays: [1, 2, 3, 4, 5],
  leadResponseHours: 1,
  visitPriceKop: 300_000,
  visitKmPriceKop: 3_000,
};

@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, { value: CompanySettings; at: number }>();
  constructor(private readonly prisma: PrismaService) {}

  async get(companyId = requestContext.companyId()): Promise<CompanySettings> {
    if (!companyId) return DEFAULT_SETTINGS;
    const hit = this.cache.get(companyId);
    if (hit && Date.now() - hit.at < 30_000) return hit.value;
    const company = await this.prisma.db.company.findUnique({ where: { id: companyId }, select: { settings: true } });
    const value = { ...DEFAULT_SETTINGS, ...((company?.settings as Partial<CompanySettings>) ?? {}) };
    this.cache.set(companyId, { value, at: Date.now() });
    return value;
  }
}

/**
 * Срок с учётом рабочего времени: «1 рабочий час» от заявки в пятницу в 17:30 — понедельник 9:30.
 * Время считается в часовом поясе сервера (в проде — Europe/Moscow через TZ).
 */
export function addWorkHours(from: Date, hours: number, s: Pick<CompanySettings, 'workStartHour' | 'workEndHour' | 'workDays'>): Date {
  let remaining = hours * 60;
  const d = new Date(from);
  const isWorkDay = (x: Date) => s.workDays.includes(x.getDay() === 0 ? 7 : x.getDay());
  for (let guard = 0; remaining > 0 && guard < 10_000; guard++) {
    const start = new Date(d);
    start.setHours(s.workStartHour, 0, 0, 0);
    const end = new Date(d);
    end.setHours(s.workEndHour, 0, 0, 0);
    if (!isWorkDay(d) || d >= end) {
      d.setDate(d.getDate() + 1);
      d.setHours(s.workStartHour, 0, 0, 0);
      continue;
    }
    if (d < start) d.setTime(start.getTime());
    const available = (end.getTime() - d.getTime()) / 60_000;
    const step = Math.min(available, remaining);
    d.setTime(d.getTime() + step * 60_000);
    remaining -= step;
  }
  return d;
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
