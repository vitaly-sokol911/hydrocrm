import { DEFAULT_PIPELINES, DEFAULT_ROLE_PERMISSIONS, ROLE_CODES, ROLE_LABELS, type RoleCode } from '@hydrocrm/shared';
import { hashPassword } from '../auth/auth.service';
import { DEFAULT_SETTINGS } from '../common/settings.service';
import type { Db } from '../prisma/prisma.service';

/** Справочники по умолчанию (docs/03-модель-данных.md, раздел 14). */
const LEAD_SOURCES: { name: string; channel?: 'phone' | 'email' | 'site' | 'vk' | 'avito' | 'telegram' | 'other' }[] = [
  { name: 'Звонок', channel: 'phone' },
  { name: 'Почта', channel: 'email' },
  { name: 'Сайт', channel: 'site' },
  { name: 'ВКонтакте', channel: 'vk' },
  { name: 'Авито', channel: 'avito' },
  { name: 'Telegram', channel: 'telegram' },
  { name: 'Рекомендация' },
  { name: 'Повторный клиент' },
  { name: 'Выставка' },
];

const REJECT_REASONS = ['Дорого', 'Долгий срок', 'Ушёл к конкурентам', 'Ремонт нецелесообразен', 'Не вышел на связь', 'Другое'];

export interface SeedCompanyInput {
  name: string;
  legalName?: string;
  inn?: string;
  phone?: string;
  email?: string;
  address?: string;
  admin: { email: string; password: string; fullName: string };
}

/** Создаёт компанию с ролями, воронками и справочниками. Выполняется вне контекста запроса — companyId передаётся явно. */
export async function seedCompany(db: Db, input: SeedCompanyInput) {
  const company = await db.company.create({
    data: {
      name: input.name,
      legalName: input.legalName,
      inn: input.inn,
      phone: input.phone,
      email: input.email,
      address: input.address,
      settings: { ...DEFAULT_SETTINGS },
    },
  });
  const companyId = company.id;

  const roles = {} as Record<RoleCode, string>;
  for (const code of ROLE_CODES) {
    const role = await db.role.create({
      data: { companyId, code, name: ROLE_LABELS[code], permissions: DEFAULT_ROLE_PERMISSIONS[code] },
    });
    roles[code] = role.id;
  }

  for (const [orderType, def] of Object.entries(DEFAULT_PIPELINES)) {
    await db.pipeline.create({
      data: {
        companyId,
        orderType: orderType as keyof typeof DEFAULT_PIPELINES,
        name: def.name,
        stages: {
          create: def.stages.map((s, i) => ({
            code: s.code,
            name: s.name,
            clientName: s.clientName,
            sort: i,
            kind: s.kind ?? 'open',
            isProduction: !!s.isProduction,
            normHours: s.normHours,
            clientNotify: !!s.clientNotify,
            hiddenFromClient: !!s.hiddenFromClient,
            color: s.color,
          })),
        },
      },
    });
  }

  await db.leadSource.createMany({ data: LEAD_SOURCES.map((s) => ({ companyId, name: s.name, channel: s.channel })) });
  await db.rejectReason.createMany({ data: REJECT_REASONS.map((name) => ({ companyId, name })) });
  await db.chatChannel.create({ data: { companyId, type: 'general', name: 'Общий' } });

  const admin = await db.user.create({
    data: {
      companyId,
      email: input.admin.email.toLowerCase(),
      fullName: input.admin.fullName,
      passwordHash: await hashPassword(input.admin.password),
      roles: { create: [{ roleId: roles.admin }, { roleId: roles.director }] },
    },
  });

  return { company, roles, admin };
}
