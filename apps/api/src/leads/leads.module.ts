import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  LEAD_CHANNEL_LABELS,
  leadConvertSchema,
  leadCreateSchema,
  leadRejectSchema,
  leadUpdateSchema,
  normalizePhone,
  PERMISSIONS,
  type LeadCreateInput,
} from '@hydrocrm/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { CurrentUser, Perm } from '../common/decorators';
import { nextNumber } from '../common/numbering';
import { assertClient, assertCompanyUsers, assertLeadSource } from '../common/ownership';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { addWorkHours, SettingsService } from '../common/settings.service';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';

type Reject = z.infer<typeof leadRejectSchema>;
type Convert = z.infer<typeof leadConvertSchema>;
type Update = z.infer<typeof leadUpdateSchema>;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly orders: OrdersService,
  ) {}

  async list(user: AuthUser, q: { status?: string; mine?: boolean; overdue?: boolean; q?: string; page: number; pageSize: number }) {
    const now = new Date();
    const and: Prisma.LeadWhereInput[] = [{ status: { not: 'spam' } }];
    if (q.status === 'open') and.push({ status: { in: ['new', 'in_progress'] } });
    else if (q.status) and.push({ status: q.status as Prisma.EnumLeadStatusFilter['equals'] });
    if (q.mine) and.push({ assigneeId: user.id });
    if (q.overdue) and.push({ status: 'new', firstResponseAt: null, responseDueAt: { lt: now } });
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      and.push({
        OR: [
          { number: { contains: q.q, mode: 'insensitive' } },
          { contactName: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          { client: { name: { contains: q.q, mode: 'insensitive' } } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-10) } }] : []),
        ],
      });
    }
    const where = { AND: and };
    const db = this.prisma.db;
    const [rows, total, counters] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { client: { select: { id: true, name: true } }, source: true, order: { select: { id: true, number: true } } },
      }),
      db.lead.count({ where }),
      this.counters(user),
    ]);
    const items = rows.map((l) => ({ ...l, overdue: !l.firstResponseAt && ['new'].includes(l.status) && l.responseDueAt < now }));
    return { items, total, page: q.page, pageSize: q.pageSize, counters };
  }

  async counters(user: AuthUser) {
    const db = this.prisma.db;
    const now = new Date();
    const [fresh, overdue, mine] = await Promise.all([
      db.lead.count({ where: { status: 'new' } }),
      db.lead.count({ where: { status: 'new', firstResponseAt: null, responseDueAt: { lt: now } } }),
      db.lead.count({ where: { assigneeId: user.id, status: { in: ['new', 'in_progress'] } } }),
    ]);
    return { new: fresh, overdue, mine };
  }

  async get(id: string) {
    const lead = await this.prisma.db.lead.findFirst({
      where: { id },
      include: { client: { select: { id: true, name: true, type: true, phone: true } }, source: true, rejectReason: true, order: { select: { id: true, number: true } } },
    });
    if (!lead) throw notFound('Заявка');
    return lead;
  }

  /** ЗАЯ-3: ответственный клиента → по кругу между менеджерами → без ответственного. */
  private async pickAssignee(clientId?: string | null): Promise<string | null> {
    const db = this.prisma.db;
    if (clientId) {
      const client = await db.client.findFirst({ where: { id: clientId }, select: { managerId: true } });
      if (client?.managerId) return client.managerId;
    }
    const managers = await db.user.findMany({
      where: { isActive: true, roles: { some: { role: { code: 'manager' } } } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!managers.length) return null;
    const last = await db.lead.findFirst({ where: { assigneeId: { in: managers.map((m) => m.id) } }, orderBy: { createdAt: 'desc' }, select: { assigneeId: true } });
    const idx = managers.findIndex((m) => m.id === last?.assigneeId);
    return managers[(idx + 1) % managers.length].id;
  }

  async create(user: AuthUser | null, input: LeadCreateInput) {
    const s = await this.settings.get();
    const db = this.prisma.db;
    await assertClient(db, input.clientId);
    await assertCompanyUsers(db, [input.assigneeId], 'assigneeId');
    await assertLeadSource(db, input.sourceId);
    const phone = normalizePhone(input.phone);
    let clientId = input.clientId ?? null;
    if (!clientId && phone) {
      clientId = (await db.client.findFirst({ where: { OR: [{ phone }, { contacts: { some: { phone } } }], deletedAt: null }, select: { id: true } }))?.id ?? null;
    }
    const assigneeId = input.assigneeId ?? (await this.pickAssignee(clientId));
    const lead = await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, 'lead', 'ЗЯ');
      const created = await tx.lead.create({
        data: {
          companyId: currentCompanyId(),
          number,
          channel: input.channel,
          sourceId: input.sourceId,
          clientId,
          contactName: input.contactName,
          phone,
          email: input.email?.toLowerCase(),
          description: input.description,
          assigneeId,
          isStatusQuestion: input.isStatusQuestion,
          responseDueAt: addWorkHours(new Date(), s.leadResponseHours, s),
          createdById: user?.id,
        },
      });
      await this.audit.log('create', 'lead', created.id, undefined, tx);
      return created;
    });
    // ЗАЯ-4: уведомление ответственному или всем менеджерам.
    const recipients = assigneeId
      ? [assigneeId]
      : (await db.user.findMany({ where: { isActive: true, roles: { some: { role: { code: 'manager' } } } }, select: { id: true } })).map((u) => u.id);
    await this.notifications.notify(recipients, {
      type: 'lead_new',
      title: `Новая заявка ${lead.number} (${LEAD_CHANNEL_LABELS[lead.channel]})`,
      body: lead.description.slice(0, 200),
      link: `/leads/${lead.id}`,
    });
    this.realtime.toCompany(currentCompanyId(), 'lead.created', { id: lead.id });
    return lead;
  }

  async update(id: string, input: Update) {
    const before = await this.get(id);
    const db = this.prisma.db;
    await assertClient(db, input.clientId);
    await assertCompanyUsers(db, [input.assigneeId], 'assigneeId');
    await assertLeadSource(db, input.sourceId);
    const lead = await this.prisma.db.lead.update({ where: { id }, data: { ...input, phone: input.phone === undefined ? undefined : normalizePhone(input.phone) } });
    await this.audit.log('update', 'lead', id, AuditService.diff(before as unknown as Record<string, unknown>, input));
    if (input.assigneeId && input.assigneeId !== before.assigneeId) {
      await this.notifications.notify([input.assigneeId], { type: 'lead_new', title: `Вам передана заявка ${lead.number}`, body: lead.description.slice(0, 200), link: `/leads/${id}` });
    }
    this.realtime.toCompany(currentCompanyId(), 'lead.updated', { id });
    return lead;
  }

  /** ЗАЯ-6: «Взять в работу» — первая реакция. */
  async take(user: AuthUser, id: string) {
    const lead = await this.get(id);
    if (!['new', 'in_progress'].includes(lead.status)) throw new AppError('CONFLICT', 'Заявка уже закрыта');
    await this.prisma.db.lead.update({
      where: { id },
      data: { status: 'in_progress', assigneeId: lead.assigneeId ?? user.id, firstResponseAt: lead.firstResponseAt ?? new Date() },
    });
    await this.audit.log('take', 'lead', id);
    this.realtime.toCompany(user.companyId, 'lead.updated', { id });
  }

  async reject(user: AuthUser, id: string, input: Reject) {
    const lead = await this.get(id);
    if (lead.status === 'converted') throw new AppError('CONFLICT', 'По заявке уже создан заказ');
    await this.prisma.db.lead.update({
      where: { id },
      data: { status: input.spam ? 'spam' : 'rejected', rejectReasonId: input.reasonId, rejectComment: input.comment, firstResponseAt: lead.firstResponseAt ?? new Date() },
    });
    await this.audit.log(input.spam ? 'spam' : 'reject', 'lead', id);
    this.realtime.toCompany(user.companyId, 'lead.updated', { id });
  }

  async reopen(user: AuthUser, id: string) {
    const lead = await this.get(id);
    if (lead.status !== 'rejected') throw new AppError('CONFLICT', 'Вернуть в работу можно только отклонённую заявку');
    await this.prisma.db.lead.update({ where: { id }, data: { status: 'in_progress', rejectReasonId: null, rejectComment: null } });
    await this.audit.log('reopen', 'lead', id);
    this.realtime.toCompany(user.companyId, 'lead.updated', { id });
  }

  /** ЗАЯ-7: заявка → заказ. Клиент создаётся, если его ещё нет. */
  async convert(user: AuthUser, id: string, input: Convert) {
    const lead = await this.get(id);
    if (lead.status === 'converted') throw new AppError('CONFLICT', 'По заявке уже создан заказ');
    const db = this.prisma.db;
    const order = await db.$transaction(async (tx) => {
      let clientId = input.clientId ?? lead.clientId;
      if (!clientId) {
        if (!input.newClient) throw new AppError('VALIDATION_ERROR', 'Выберите клиента или создайте нового', [{ field: 'clientId', reason: 'required' }]);
        const client = await tx.client.create({
          data: {
            companyId: currentCompanyId(),
            type: input.newClient.type,
            name: input.newClient.name,
            phone: lead.phone,
            email: lead.email,
            sourceId: lead.sourceId,
            managerId: lead.assigneeId ?? user.id,
            createdById: user.id,
          },
        });
        clientId = client.id;
      }
      await tx.lead.update({ where: { id }, data: { firstResponseAt: lead.firstResponseAt ?? new Date() } });
      return this.orders.create(
        user,
        {
          type: input.type,
          clientId,
          title: input.title || lead.description.slice(0, 120),
          complaint: lead.description,
          managerId: lead.assigneeId ?? undefined,
          masterIds: [],
          priority: 'normal',
          isWarrantyCase: false,
          leadId: id,
        },
        tx,
      );
    });
    this.realtime.toCompany(user.companyId, 'lead.updated', { id });
    return order;
  }
}

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  q: z.string().trim().max(200).optional(),
  mine: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  overdue: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

@Controller('leads')
class LeadsController {
  constructor(private readonly service: LeadsService) {}

  @Get()
  @Perm(PERMISSIONS.leadsView)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.service.list(user, q);
  }

  @Get(':id')
  @Perm(PERMISSIONS.leadsView)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @Perm(PERMISSIONS.leadsEdit)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(leadCreateSchema)) body: LeadCreateInput) {
    return this.service.create(user, body);
  }

  @Patch(':id')
  @Perm(PERMISSIONS.leadsEdit)
  update(@Param('id') id: string, @Body(new ZodPipe(leadUpdateSchema)) body: Update) {
    return this.service.update(id, body);
  }

  @Post(':id/take')
  @HttpCode(204)
  @Perm(PERMISSIONS.leadsEdit)
  take(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.take(user, id);
  }

  @Post(':id/reject')
  @HttpCode(204)
  @Perm(PERMISSIONS.leadsEdit)
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(leadRejectSchema)) body: Reject) {
    return this.service.reject(user, id, body);
  }

  @Post(':id/reopen')
  @HttpCode(204)
  @Perm(PERMISSIONS.leadsEdit)
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reopen(user, id);
  }

  @Post(':id/convert')
  @Perm(PERMISSIONS.leadsEdit, PERMISSIONS.ordersCreate)
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(leadConvertSchema)) body: Convert) {
    return this.service.convert(user, id, body);
  }
}

@Module({ imports: [OrdersModule], controllers: [LeadsController], providers: [LeadsService], exports: [LeadsService] })
export class LeadsModule {}
