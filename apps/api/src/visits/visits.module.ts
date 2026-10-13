import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  VISIT_RESULT_LABELS,
  VISIT_STATUS_LABELS,
  visitCreateSchema,
  visitStatusSchema,
  visitUpdateSchema,
  type VisitCreateInput,
} from '@hydrocrm/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { CurrentUser, Perm } from '../common/decorators';
import { assertCompanyUsers } from '../common/ownership';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { orderScope } from '../common/visibility';
import { ZodPipe } from '../common/zod.pipe';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FeedService } from '../orders/feed.service';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';

type VisitStatusInput = z.infer<typeof visitStatusSchema>;
type VisitUpdate = z.infer<typeof visitUpdateSchema>;

const fmt = (d: Date) => d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Выезды (ВЫЕ-1…31). Статус выезда двигает этап выездного заказа. */
@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly feed: FeedService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly files: FilesService,
  ) {}

  private include = {
    assignees: true,
    order: {
      select: {
        id: true,
        number: true,
        title: true,
        type: true,
        complaint: true,
        managerId: true,
        client: { select: { id: true, name: true, phone: true } },
        equipment: { select: { id: true, name: true, model: true, serialNumber: true } },
        stage: { select: { code: true, name: true, color: true } },
      },
    },
    files: true,
  } satisfies Prisma.VisitInclude;

  async list(user: AuthUser, q: { from: string; to: string; masterId?: string }) {
    const s = await this.settings.get();
    const where: Prisma.VisitWhereInput = {
      plannedStartAt: { lt: new Date(q.to) },
      plannedEndAt: { gt: new Date(q.from) },
      order: orderScope(user, s),
      ...(q.masterId ? { assignees: { some: { userId: q.masterId } } } : {}),
    };
    const rows = await this.prisma.db.visit.findMany({ where, orderBy: { plannedStartAt: 'asc' }, include: this.include });
    return rows.map((v) => ({ ...v, files: v.files.map((f) => this.files.toDto(f)) }));
  }

  async get(user: AuthUser, id: string) {
    const s = await this.settings.get();
    const v = await this.prisma.db.visit.findFirst({ where: { id, order: orderScope(user, s) }, include: this.include });
    if (!v) throw notFound('Выезд');
    return { ...v, files: v.files.map((f) => this.files.toDto(f)) };
  }

  /** ВЫЕ-3: пересечения по мастеру. Возвращаются как предупреждение, не блокируют. */
  private async conflicts(masterIds: string[], start: Date, end: Date, excludeId?: string) {
    const rows = await this.prisma.db.visit.findMany({
      where: {
        status: { in: ['planned', 'on_the_way', 'on_site'] },
        plannedStartAt: { lt: end },
        plannedEndAt: { gt: start },
        assignees: { some: { userId: { in: masterIds } } },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      include: { order: { select: { number: true } }, assignees: true },
    });
    return rows.map((r) => ({ visitId: r.id, orderNumber: r.order.number, start: r.plannedStartAt, masterIds: r.assignees.map((a) => a.userId).filter((u) => masterIds.includes(u)) }));
  }

  private async moveOrder(user: AuthUser, tx: Tx, orderId: string, stageCode: string, comment: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { stage: true } });
    if (order.type !== 'repair_field' || order.stage.code === stageCode) return;
    const pipeline = await tx.pipeline.findFirstOrThrow({ where: { orderType: order.type }, include: { stages: true } });
    const to = pipeline.stages.find((s) => s.code === stageCode);
    if (!to || to.sort < order.stage.sort) return;
    const now = new Date();
    await tx.order.update({
      where: { id: orderId },
      data: { stageId: to.id, stageChangedAt: now, stuckNotifiedAt: null, finishedAt: to.kind === 'won' ? now : null, version: { increment: 1 } },
    });
    await tx.orderStageHistory.create({
      data: { orderId, fromStageId: order.stageId, toStageId: to.id, changedById: user.id, comment, durationHours: Math.round((now.getTime() - order.stageChangedAt.getTime()) / 3_600_000) },
    });
    await this.feed.system(tx, orderId, `Этап: «${order.stage.name}» → «${to.name}» (${comment})`, { event: 'stage', from: order.stage.code, to: to.code }, user.id);
  }

  async create(user: AuthUser, input: VisitCreateInput) {
    const s = await this.settings.get();
    const order = await this.prisma.db.order.findFirst({ where: { id: input.orderId, ...orderScope(user, s) }, include: { stage: true } });
    if (!order) throw notFound('Заказ');
    if (order.stage.kind !== 'open') throw new AppError('CONFLICT', 'Заказ закрыт');
    const start = new Date(input.plannedStartAt);
    const end = new Date(input.plannedEndAt);
    if (end <= start) throw new AppError('VALIDATION_ERROR', 'Окончание должно быть позже начала', [{ field: 'plannedEndAt', reason: 'invalid' }]);
    await assertCompanyUsers(this.prisma.db, input.masterIds, 'masterIds');
    const warnings = await this.conflicts(input.masterIds, start, end);
    const visit = await this.prisma.db.$transaction(async (tx) => {
      const v = await tx.visit.create({
        data: {
          companyId: currentCompanyId(),
          orderId: order.id,
          plannedStartAt: start,
          plannedEndAt: end,
          address: input.address,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          createdById: user.id,
          assignees: { create: input.masterIds.map((userId) => ({ userId })) },
        },
      });
      // Мастера выезда становятся исполнителями заказа.
      for (const userId of input.masterIds) {
        await tx.orderAssignee.upsert({ where: { orderId_userId: { orderId: order.id, userId } }, create: { orderId: order.id, userId }, update: {} });
      }
      await this.feed.system(tx, order.id, `Запланирован выезд на ${fmt(start)}, ${input.address}`, { event: 'visit', visitId: v.id }, user.id);
      await this.moveOrder(user, tx, order.id, 'visit_planned', 'выезд запланирован');
      await this.audit.log('create', 'visit', v.id, undefined, tx);
      return v;
    });
    await this.notifications.notify(input.masterIds, {
      type: 'visit_assigned',
      title: `Выезд ${fmt(start)}: ${order.number}`,
      body: input.address,
      link: `/visits/${visit.id}`,
    });
    this.realtime.toCompany(user.companyId, 'visit.changed', { id: visit.id });
    this.realtime.toCompany(user.companyId, 'order.updated', { id: order.id });
    return { visit, warnings };
  }

  async update(user: AuthUser, id: string, input: VisitUpdate) {
    if (!user.permissions.has(PERMISSIONS.visitsPlan)) throw forbidden();
    const v = await this.get(user, id);
    const start = input.plannedStartAt ? new Date(input.plannedStartAt) : v.plannedStartAt;
    const end = input.plannedEndAt ? new Date(input.plannedEndAt) : v.plannedEndAt;
    const masters = input.masterIds ?? v.assignees.map((a) => a.userId);
    if (end <= start) throw new AppError('VALIDATION_ERROR', 'Окончание должно быть позже начала', [{ field: 'plannedEndAt', reason: 'invalid' }]);
    await assertCompanyUsers(this.prisma.db, masters, 'masterIds');
    const warnings = await this.conflicts(masters, start, end, id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.visit.update({
        where: { id },
        data: { plannedStartAt: start, plannedEndAt: end, address: input.address, contactName: input.contactName, contactPhone: input.contactPhone },
      });
      if (input.masterIds) {
        await tx.visitAssignee.deleteMany({ where: { visitId: id } });
        await tx.visitAssignee.createMany({ data: input.masterIds.map((userId) => ({ visitId: id, userId })) });
      }
      await this.audit.log('update', 'visit', id, AuditService.diff(v as unknown as Record<string, unknown>, input), tx);
    });
    const added = masters.filter((m) => !v.assignees.some((a) => a.userId === m));
    await this.notifications.notify(added, { type: 'visit_assigned', title: `Выезд ${fmt(start)}: ${v.order.number}`, body: v.address, link: `/visits/${id}` });
    this.realtime.toCompany(user.companyId, 'visit.changed', { id });
    return { warnings };
  }

  /** ВЫЕ-10…13, 30, 31: кнопки мастера на объекте. Время берётся с устройства (офлайн-очередь). */
  async setStatus(user: AuthUser, id: string, input: VisitStatusInput) {
    const v = await this.get(user, id);
    const isMaster = v.assignees.some((a) => a.userId === user.id);
    if (!(isMaster && user.permissions.has(PERMISSIONS.visitsWork)) && !user.permissions.has(PERMISSIONS.visitsPlan)) {
      throw forbidden('Отмечать работу на выезде может только назначенный мастер');
    }
    if (input.status === 'done' && !input.result) throw new AppError('VALIDATION_ERROR', 'Выберите результат выезда', [{ field: 'result', reason: 'required' }]);
    const at = input.at ? new Date(input.at) : new Date();
    const data: Prisma.VisitUpdateInput = { status: input.status };
    if (input.status === 'on_the_way') data.departedAt = at;
    if (input.status === 'on_site') data.arrivedAt = at;
    if (input.status === 'done') Object.assign(data, { finishedAt: at, result: input.result, report: input.report, travelKm: input.travelKm });

    let childOrderId: string | null = null;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.visit.update({ where: { id }, data });
      const label = input.status === 'done' && input.result ? `${VISIT_STATUS_LABELS.done}: ${VISIT_RESULT_LABELS[input.result].toLowerCase()}` : VISIT_STATUS_LABELS[input.status];
      await this.feed.system(tx, v.orderId, `Выезд — ${label}${input.report ? `. ${input.report}` : ''}`, { event: 'visit_status', visitId: id, status: input.status }, user.id);
      if (input.status === 'on_site') await this.moveOrder(user, tx, v.orderId, 'on_site', 'мастер на объекте');
      if (input.status === 'done' && input.result === 'fixed') await this.moveOrder(user, tx, v.orderId, 'visit_done', 'работы на выезде завершены');
      if (input.status === 'done' && input.result === 'need_workshop') {
        // ВЫЕ-30: связанный заказ «Ремонт в цеху» с тем же клиентом и оборудованием.
        const parent = await tx.order.findUniqueOrThrow({ where: { id: v.orderId } });
        const child = await this.orders.create(
          user,
          {
            type: 'repair_workshop',
            clientId: parent.clientId,
            contactId: parent.contactId,
            equipmentId: parent.equipmentId,
            title: parent.title,
            complaint: [parent.complaint, input.report ? `Отчёт выезда: ${input.report}` : null].filter(Boolean).join('\n\n'),
            managerId: parent.managerId,
            masterIds: v.assignees.map((a) => a.userId),
            priority: parent.priority,
            isWarrantyCase: parent.isWarrantyCase,
            parentOrderId: parent.id,
          },
          tx,
        );
        childOrderId = child.id;
        await tx.file.updateMany({ where: { visitId: id }, data: { orderId: child.id } });
        await this.moveOrder(user, tx, v.orderId, 'moved_to_workshop', `создан заказ ${child.number}`);
      }
      if (input.status === 'done' && input.result === 'need_revisit' && v.order.managerId) {
        await tx.task.create({
          data: {
            companyId: currentCompanyId(),
            title: `Запланировать повторный выезд по ${v.order.number}`,
            assigneeId: v.order.managerId,
            authorId: user.id,
            orderId: v.orderId,
            isAuto: true,
            priority: 'high',
          },
        });
      }
      await this.audit.log('visit_status', 'visit', id, { status: [v.status, input.status] }, tx);
    });
    await this.notifications.notify([v.order.managerId], {
      type: 'stage_changed',
      title: `${v.order.number}: выезд — ${VISIT_STATUS_LABELS[input.status].toLowerCase()}`,
      body: input.report ?? undefined,
      link: `/orders/${v.orderId}`,
    });
    this.realtime.toCompany(user.companyId, 'visit.changed', { id });
    this.realtime.toCompany(user.companyId, 'order.updated', { id: v.orderId });
    this.realtime.toRoom(`order:${v.orderId}`, 'comment.created', { orderId: v.orderId });
    return { childOrderId };
  }
}

const listQuery = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }), masterId: z.string().uuid().optional() });

@Controller('visits')
class VisitsController {
  constructor(private readonly service: VisitsService) {}

  @Get()
  @Perm(PERMISSIONS.visitsView)
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.service.list(user, q);
  }

  @Get(':id')
  @Perm(PERMISSIONS.visitsView)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Perm(PERMISSIONS.visitsPlan)
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(visitCreateSchema)) body: VisitCreateInput) {
    return this.service.create(user, body);
  }

  @Patch(':id')
  @Perm(PERMISSIONS.visitsPlan)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(visitUpdateSchema)) body: VisitUpdate) {
    return this.service.update(user, id, body);
  }

  @Post(':id/status')
  @Perm(PERMISSIONS.visitsView)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(visitStatusSchema)) body: VisitStatusInput) {
    return this.service.setStatus(user, id, body);
  }
}

@Module({ imports: [OrdersModule], controllers: [VisitsController], providers: [VisitsService] })
export class VisitsModule {}
