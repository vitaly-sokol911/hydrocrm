import { Injectable } from '@nestjs/common';
import { normalizePhone, PERMISSIONS, type ClientInput, type EquipmentInput } from '@hydrocrm/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { contactSchema } from '@hydrocrm/shared';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { assertCompanyUsers, assertLeadSource } from '../common/ownership';
import { clientScope } from '../common/visibility';
import { PrismaService } from '../prisma/prisma.service';

type ContactInput = z.infer<typeof contactSchema>;

const FINANCE_FIELDS = ['legalName', 'inn', 'kpp', 'ogrn', 'legalAddress', 'paymentTermsDays'] as const;

export interface ClientListQuery {
  page: number;
  pageSize: number;
  q?: string;
  type?: string;
  managerId?: string;
  withOpenOrders?: boolean;
  archived?: boolean;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Поиск одной строкой (КЛН-2): название, ФИО, телефон в любом формате, email, ИНН, контакты, серийный номер. */
  static searchWhere(q: string): Prisma.ClientWhereInput {
    const digits = q.replace(/\D/g, '');
    const or: Prisma.ClientWhereInput[] = [
      { name: { contains: q, mode: 'insensitive' } },
      { legalName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { contacts: { some: { fullName: { contains: q, mode: 'insensitive' } } } },
      { equipment: { some: { serialNumber: { contains: q, mode: 'insensitive' } } } },
    ];
    if (digits.length >= 4) {
      const tail = digits.length >= 10 ? digits.slice(-10) : digits;
      or.push({ phone: { contains: tail } }, { inn: { startsWith: digits } }, { contacts: { some: { phone: { contains: tail } } } });
    }
    return { OR: or };
  }

  async list(user: AuthUser, query: ClientListQuery) {
    const s = await this.settings.get();
    const where: Prisma.ClientWhereInput = {
      AND: [
        clientScope(user, s),
        { deletedAt: null },
        query.archived ? { archivedAt: { not: null } } : { archivedAt: null },
        query.q ? ClientsService.searchWhere(query.q) : {},
        query.type ? { type: query.type as Prisma.EnumClientTypeFilter['equals'] } : {},
        query.managerId ? { managerId: query.managerId } : {},
        query.withOpenOrders ? { orders: { some: { stage: { kind: 'open' } } } } : {},
      ],
    };
    const db = this.prisma.db;
    const [rows, total] = await Promise.all([
      db.client.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          orders: { select: { totalKop: true, createdAt: true, stage: { select: { kind: true } } } },
          _count: { select: { equipment: true } },
        },
      }),
      db.client.count({ where }),
    ]);
    const finance = user.permissions.has(PERMISSIONS.clientsViewFinance);
    const items = rows.map(({ orders, _count, ...c }) => ({
      ...this.mask(c, finance),
      ordersCount: orders.length,
      openOrders: orders.filter((o) => o.stage.kind === 'open').length,
      ordersSumKop: finance ? orders.filter((o) => o.stage.kind !== 'lost').reduce((sum, o) => sum + Number(o.totalKop), 0) : null,
      lastOrderAt: orders.reduce<Date | null>((max, o) => (!max || o.createdAt > max ? o.createdAt : max), null),
      equipmentCount: _count.equipment,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private mask<T extends Record<string, unknown>>(client: T, finance: boolean): T {
    if (finance) return client;
    const copy: Record<string, unknown> = { ...client };
    for (const f of FINANCE_FIELDS) delete copy[f];
    return copy as T;
  }

  async get(user: AuthUser, id: string) {
    const s = await this.settings.get();
    const client = await this.prisma.db.client.findFirst({
      where: { id, deletedAt: null, ...clientScope(user, s) },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }] },
        equipment: { orderBy: { createdAt: 'desc' } },
        source: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            number: true,
            type: true,
            title: true,
            totalKop: true,
            createdAt: true,
            finishedAt: true,
            equipmentId: true,
            stage: { select: { name: true, kind: true, color: true } },
          },
        },
        leads: { orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, number: true, status: true, channel: true, description: true, createdAt: true } },
      },
    });
    if (!client) throw notFound('Клиент');
    const finance = user.permissions.has(PERMISSIONS.clientsViewFinance);
    const orders = finance ? client.orders : client.orders.map((o) => ({ ...o, totalKop: null }));
    return { ...this.mask(client, finance), orders };
  }

  /** КЛН-24: поиск возможных дублей по телефону, email, ИНН. */
  async duplicates(params: { phone?: string; email?: string; inn?: string; excludeId?: string }) {
    const or: Prisma.ClientWhereInput[] = [];
    const phone = normalizePhone(params.phone);
    if (phone) or.push({ phone }, { contacts: { some: { phone } } });
    if (params.email) or.push({ email: { equals: params.email, mode: 'insensitive' } });
    if (params.inn) or.push({ inn: params.inn });
    if (!or.length) return [];
    return this.prisma.db.client.findMany({
      where: { OR: or, deletedAt: null, ...(params.excludeId ? { id: { not: params.excludeId } } : {}) },
      select: { id: true, name: true, type: true, phone: true, email: true, inn: true },
      take: 5,
    });
  }

  private toData(input: ClientInput) {
    const { pdConsent, ...rest } = input;
    return {
      ...rest,
      phone: normalizePhone(rest.phone),
      email: rest.email ? rest.email.toLowerCase() : null,
      ...(pdConsent === undefined ? {} : { pdConsentAt: pdConsent ? new Date() : null }),
    };
  }

  async create(user: AuthUser, input: ClientInput) {
    await assertCompanyUsers(this.prisma.db, [input.managerId], 'managerId');
    await assertLeadSource(this.prisma.db, input.sourceId);
    const client = await this.prisma.db.client.create({
      data: { ...this.toData(input), companyId: currentCompanyId(), createdById: user.id, managerId: input.managerId ?? (user.roles.includes('manager') ? user.id : null) },
    });
    await this.audit.log('create', 'client', client.id);
    return client;
  }

  async update(user: AuthUser, id: string, input: ClientInput, version?: number) {
    const db = this.prisma.db;
    const before = await this.get(user, id);
    if (version !== undefined && before.version !== version) {
      throw new AppError('CONFLICT', 'Карточку клиента уже изменил другой пользователь. Обновите страницу');
    }
    await assertCompanyUsers(db, [input.managerId], 'managerId');
    await assertLeadSource(db, input.sourceId);
    const data = this.toData(input);
    if (before.pdConsentAt && input.pdConsent) delete (data as { pdConsentAt?: Date }).pdConsentAt;
    const client = await db.client.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    await this.audit.log('update', 'client', id, AuditService.diff(before as Record<string, unknown>, data));
    return client;
  }

  /** КЛН-60: без заказов — мягкое удаление, с заказами — только архив. */
  async archive(user: AuthUser, id: string, archived: boolean) {
    const db = this.prisma.db;
    await this.get(user, id);
    await db.client.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await this.audit.log(archived ? 'archive' : 'unarchive', 'client', id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.prisma.db;
    const client = await this.get(user, id);
    if (client.orders.length) throw new AppError('CONFLICT', 'У клиента есть заказы — его можно только архивировать');
    await db.client.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log('delete', 'client', id);
  }

  // ---------- Контакты ----------
  async addContact(user: AuthUser, clientId: string, input: ContactInput) {
    await this.get(user, clientId);
    return this.prisma.db.$transaction(async (tx) => {
      if (input.isPrimary) await tx.contact.updateMany({ where: { clientId }, data: { isPrimary: false } });
      return tx.contact.create({ data: { ...input, phone: normalizePhone(input.phone), clientId } });
    });
  }

  private async contactOrThrow(user: AuthUser, id: string) {
    const contact = await this.prisma.db.contact.findFirst({ where: { id, client: { companyId: user.companyId } } });
    if (!contact) throw notFound('Контакт');
    await this.get(user, contact.clientId);
    return contact;
  }

  async updateContact(user: AuthUser, id: string, input: ContactInput) {
    const contact = await this.contactOrThrow(user, id);
    return this.prisma.db.$transaction(async (tx) => {
      if (input.isPrimary) await tx.contact.updateMany({ where: { clientId: contact.clientId }, data: { isPrimary: false } });
      return tx.contact.update({ where: { id }, data: { ...input, phone: normalizePhone(input.phone) } });
    });
  }

  async removeContact(user: AuthUser, id: string) {
    await this.contactOrThrow(user, id);
    await this.prisma.db.contact.delete({ where: { id } });
  }

  // ---------- Оборудование ----------
  async addEquipment(user: AuthUser, clientId: string, input: EquipmentInput) {
    await this.get(user, clientId);
    const eq = await this.prisma.db.equipment.create({ data: { ...input, clientId } });
    await this.audit.log('create', 'equipment', eq.id);
    return eq;
  }

  async getEquipment(user: AuthUser, id: string) {
    const eq = await this.prisma.db.equipment.findFirst({
      where: { id, client: { companyId: user.companyId } },
      include: {
        client: { select: { id: true, name: true, type: true } },
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            number: true,
            type: true,
            title: true,
            createdAt: true,
            finishedAt: true,
            isWarrantyCase: true,
            totalKop: true,
            stage: { select: { name: true, kind: true, color: true } },
            items: { where: { kind: 'part', status: 'approved' }, select: { name: true, quantity: true } },
          },
        },
      },
    });
    if (!eq) throw notFound('Оборудование');
    await this.get(user, eq.clientId);
    const finance = user.permissions.has(PERMISSIONS.clientsViewFinance);
    return finance ? eq : { ...eq, orders: eq.orders.map((o) => ({ ...o, totalKop: null })) };
  }

  async updateEquipment(user: AuthUser, id: string, input: EquipmentInput) {
    const before = await this.getEquipment(user, id);
    const eq = await this.prisma.db.equipment.update({ where: { id }, data: input });
    await this.audit.log('update', 'equipment', id, AuditService.diff(before as unknown as Record<string, unknown>, input));
    return eq;
  }
}
