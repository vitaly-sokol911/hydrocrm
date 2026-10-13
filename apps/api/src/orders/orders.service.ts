import { Injectable } from '@nestjs/common';
import {
  APPROVAL_METHOD_LABELS,
  approveEstimateSchema,
  calcEstimate,
  checkTransition,
  ORDER_TYPE_LABELS,
  orderAssigneesSchema,
  orderUpdateSchema,
  PERMISSIONS,
  type OrderCreateInput,
  type OrderFacts,
  type OrderItemInput,
  type StageChangeInput,
} from '@hydrocrm/shared';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, forbidden, notFound } from '../common/app-error';
import { nextNumber } from '../common/numbering';
import { assertClientChildren, assertCompanyUsers, assertLead, assertOrder } from '../common/ownership';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { orderScope, priceVisibility } from '../common/visibility';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';
import { FeedService } from './feed.service';

type OrderUpdate = z.infer<typeof orderUpdateSchema>;
type Approve = z.infer<typeof approveEstimateSchema>;
type Assignees = z.infer<typeof orderAssigneesSchema>;

export interface OrderListQuery {
  page: number;
  pageSize: number;
  type?: string;
  stageCode?: string;
  managerId?: string;
  masterId?: string;
  clientId?: string;
  q?: string;
  overdue?: boolean;
  stuck?: boolean;
  open?: boolean;
  mine?: boolean;
  view?: 'kanban' | 'table';
}

const HOUR = 3_600_000;
const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d));

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly feed: FeedService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly files: FilesService,
  ) {}

  // ---------- Чтение ----------

  private async scope(user: AuthUser) {
    return orderScope(user, await this.settings.get());
  }

  async list(user: AuthUser, q: OrderListQuery) {
    const db = this.prisma.db;
    const now = new Date();
    const and: Prisma.OrderWhereInput[] = [await this.scope(user)];
    if (q.type) and.push({ type: q.type as Prisma.EnumOrderTypeFilter['equals'] });
    if (q.stageCode) and.push({ stage: { code: q.stageCode } });
    if (q.managerId) and.push({ managerId: q.managerId });
    if (q.masterId) and.push({ assignees: { some: { userId: q.masterId } } });
    if (q.mine) and.push({ OR: [{ managerId: user.id }, { assignees: { some: { userId: user.id } } }] });
    if (q.clientId) and.push({ clientId: q.clientId });
    if (q.open || q.overdue || q.stuck || q.view === 'kanban') and.push({ stage: { kind: 'open' } });
    if (q.overdue) and.push({ plannedFinishAt: { lt: now } });
    if (q.q) {
      and.push({
        OR: [
          { number: { contains: q.q, mode: 'insensitive' } },
          { title: { contains: q.q, mode: 'insensitive' } },
          { client: { name: { contains: q.q, mode: 'insensitive' } } },
          { equipment: { serialNumber: { contains: q.q, mode: 'insensitive' } } },
        ],
      });
    }
    const where: Prisma.OrderWhereInput = { AND: and };
    const take = q.view === 'kanban' ? 500 : q.pageSize;
    const [rows, total, s] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: q.view === 'kanban' ? { stageChangedAt: 'asc' } : { createdAt: 'desc' },
        skip: q.view === 'kanban' ? 0 : (q.page - 1) * q.pageSize,
        take,
        include: {
          stage: true,
          client: { select: { id: true, name: true, type: true } },
          equipment: { select: { id: true, name: true, model: true, serialNumber: true } },
          assignees: { select: { userId: true, isLead: true } },
          reads: { where: { userId: user.id }, select: { lastReadAt: true } },
          _count: { select: { comments: true } },
        },
      }),
      db.order.count({ where }),
      this.settings.get(),
    ]);
    // Непрочитанные комментарии (ОБЩ-4) одним запросом.
    const unread = rows.length
      ? await db.$queryRaw<{ order_id: string; cnt: bigint }[]>`
          SELECT c."orderId" AS order_id, COUNT(*)::bigint AS cnt
          FROM "Comment" c
          LEFT JOIN "OrderRead" r ON r."orderId" = c."orderId" AND r."userId" = ${user.id}::uuid
          WHERE c."orderId" = ANY(${rows.map((r) => r.id)}::uuid[])
            AND c.kind = 'comment' AND c."deletedAt" IS NULL
            AND (c."authorId" IS NULL OR c."authorId" <> ${user.id}::uuid)
            AND (r."lastReadAt" IS NULL OR c."createdAt" > r."lastReadAt")
          GROUP BY c."orderId"`
      : [];
    const unreadMap = new Map(unread.map((u) => [u.order_id, Number(u.cnt)]));
    const vis = priceVisibility(user, s);
    let items = rows.map((o) => {
      const stuck = o.stage.kind === 'open' && !!o.stage.normHours && now.getTime() - o.stageChangedAt.getTime() > o.stage.normHours * HOUR;
      return {
        id: o.id,
        number: o.number,
        type: o.type,
        title: o.title,
        priority: o.priority,
        stage: { id: o.stage.id, code: o.stage.code, name: o.stage.name, kind: o.stage.kind, color: o.stage.color, sort: o.stage.sort },
        stageChangedAt: o.stageChangedAt,
        client: o.client,
        equipment: o.equipment,
        managerId: o.managerId,
        assignees: o.assignees,
        plannedFinishAt: o.plannedFinishAt,
        finishedAt: o.finishedAt,
        createdAt: o.createdAt,
        isWarrantyCase: o.isWarrantyCase,
        totalKop: vis.prices ? Number(o.totalKop) : null,
        overdue: o.stage.kind === 'open' && !!o.plannedFinishAt && o.plannedFinishAt < now,
        stuck,
        unreadComments: unreadMap.get(o.id) ?? 0,
        commentsCount: o._count.comments,
      };
    });
    if (q.stuck) items = items.filter((i) => i.stuck);
    return { items, total: q.stuck ? items.length : total, page: q.page, pageSize: q.pageSize };
  }

  private async loadOrder(user: AuthUser, id: string, db: Tx | PrismaService['db'] = this.prisma.db) {
    const order = await db.order.findFirst({
      where: { id, ...(await this.scope(user)) },
      include: {
        stage: true,
        items: { orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] },
        approvals: { orderBy: { version: 'desc' } },
        assignees: true,
      },
    });
    if (!order) throw notFound('Заказ');
    return order;
  }

  async get(user: AuthUser, id: string) {
    const db = this.prisma.db;
    const order = await db.order.findFirst({
      where: { id, ...(await this.scope(user)) },
      include: {
        stage: true,
        client: { select: { id: true, name: true, type: true, phone: true, email: true, address: true } },
        contact: true,
        equipment: true,
        assignees: true,
        items: { orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] },
        approvals: { orderBy: { version: 'desc' } },
        stageHistory: { orderBy: { changedAt: 'asc' } },
        visits: { orderBy: { plannedStartAt: 'desc' }, include: { assignees: true } },
        files: { where: { commentId: null }, orderBy: { createdAt: 'desc' } },
        lead: { select: { id: true, number: true, channel: true } },
        parentOrder: { select: { id: true, number: true, type: true } },
        childOrders: { select: { id: true, number: true, type: true } },
        tasks: { where: { status: 'open' }, select: { id: true } },
      },
    });
    if (!order) throw notFound('Заказ');
    const pipeline = await db.pipeline.findFirst({ where: { orderType: order.type }, include: { stages: { orderBy: { sort: 'asc' } } } });
    const s = await this.settings.get();
    const vis = priceVisibility(user, s);
    const totals = this.totals(order.items, order.discountPercent);
    const lastApproval = order.approvals[0];
    const photoCount = await db.file.count({ where: { orderId: id, mimeType: { startsWith: 'image/' } } });
    return {
      ...order,
      totalKop: vis.prices ? totals.totalKop : null,
      costKop: vis.margin ? totals.costKop : null,
      discountPercent: num(order.discountPercent),
      items: order.items.map((i) => this.maskItem(i, vis)),
      approvals: order.approvals.map((a) => ({ ...a, totalKop: vis.prices ? Number(a.totalKop) : null })),
      totals: vis.prices ? { ...totals, costKop: vis.margin ? totals.costKop : null, marginKop: vis.margin ? totals.marginKop : null, marginPercent: vis.margin ? totals.marginPercent : null } : null,
      estimateApproved: !!lastApproval && Number(lastApproval.totalKop) === totals.totalKop,
      files: order.files.map((f) => this.files.toDto(f)),
      photoCount,
      openTasks: order.tasks.length,
      stages: pipeline?.stages ?? [],
      visibility: vis,
      settings: { discountLimitPercent: s.discountLimitPercent },
    };
  }

  private maskItem(i: Prisma.OrderItemGetPayload<object>, vis: { prices: boolean; margin: boolean }) {
    const quantity = num(i.quantity);
    const discount = num(i.discountPercent);
    const sumKop = Math.round(quantity * Number(i.priceKop) * (1 - discount / 100));
    return {
      ...i,
      quantity,
      discountPercent: vis.prices ? discount : null,
      priceKop: vis.prices ? Number(i.priceKop) : null,
      sumKop: vis.prices ? sumKop : null,
      costKop: vis.margin ? Number(i.costKop) : null,
    };
  }

  private totals(items: Prisma.OrderItemGetPayload<object>[], discountPercent: Prisma.Decimal | number) {
    return calcEstimate(
      items.map((i) => ({
        kind: i.kind,
        status: i.status,
        quantity: num(i.quantity),
        priceKop: Number(i.priceKop),
        costKop: Number(i.costKop),
        discountPercent: num(i.discountPercent),
      })),
      num(discountPercent),
    );
  }

  /** Пересчёт итогов заказа после изменения сметы (кешируются в orders.totalKop/costKop). */
  private async recalc(tx: Tx, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const t = this.totals(order.items, order.discountPercent);
    await tx.order.update({ where: { id: orderId }, data: { totalKop: t.totalKop, costKop: t.costKop, version: { increment: 1 } } });
    return t;
  }

  // ---------- Создание и изменение ----------

  async create(user: AuthUser, input: OrderCreateInput, tx?: Tx) {
    const run = async (t: Tx) => {
      const client = await t.client.findFirst({ where: { id: input.clientId, deletedAt: null } });
      if (!client) throw notFound('Клиент');
      const pipeline = await t.pipeline.findFirst({ where: { orderType: input.type }, include: { stages: { orderBy: { sort: 'asc' } } } });
      if (!pipeline?.stages.length) throw new AppError('CONFLICT', 'Не настроена воронка для этого типа заказа');
      const first = pipeline.stages[0];

      let equipmentId = input.equipmentId ?? null;
      await assertClientChildren(t, client.id, { contactId: input.contactId, equipmentId });
      await assertCompanyUsers(t, [input.managerId, ...input.masterIds]);
      await assertOrder(t, input.parentOrderId, 'parentOrderId');
      await assertLead(t, input.leadId);
      if (!equipmentId && input.newEquipment) {
        equipmentId = (await t.equipment.create({ data: { ...input.newEquipment, clientId: client.id } })).id;
      }

      // ЗАК-21: плановая дата = сегодня + сумма норм открытых этапов.
      const normHours = pipeline.stages.filter((s) => s.kind === 'open').reduce((sum, s) => sum + (s.normHours ?? 0), 0);
      const plannedFinishAt = input.plannedFinishAt ? new Date(input.plannedFinishAt) : new Date(Date.now() + normHours * HOUR);
      const number = await nextNumber(t, 'order', 'З');
      const managerId = input.managerId ?? client.managerId ?? (user.roles.includes('manager') ? user.id : null);

      const order = await t.order.create({
        data: {
          companyId: currentCompanyId(),
          number,
          type: input.type,
          stageId: first.id,
          clientId: client.id,
          contactId: input.contactId,
          equipmentId,
          title: input.title,
          complaint: input.complaint,
          managerId,
          priority: input.priority,
          plannedFinishAt,
          isWarrantyCase: input.isWarrantyCase,
          parentOrderId: input.parentOrderId,
          statusToken: randomBytes(24).toString('base64url'),
          createdById: user.id,
          assignees: { create: input.masterIds.map((userId, i) => ({ userId, isLead: i === 0 })) },
          stageHistory: { create: { toStageId: first.id, changedById: user.id } },
        },
      });
      if (input.leadId) {
        await t.lead.update({ where: { id: input.leadId }, data: { orderId: order.id, status: 'converted', clientId: client.id } });
      }
      await this.feed.system(t, order.id, `Заказ создан: ${ORDER_TYPE_LABELS[input.type]}`, { event: 'created' }, user.id);
      await this.audit.log('create', 'order', order.id, undefined, t);
      return order;
    };
    const order = tx ? await run(tx) : await this.prisma.db.$transaction(run);
    const link = `/orders/${order.id}`;
    await this.notifications.notify([order.managerId], { type: 'order_assigned', title: `Вы ответственный за ${order.number}`, body: order.title, link });
    await this.notifications.notify(input.masterIds, { type: 'order_assigned', title: `Вы исполнитель заказа ${order.number}`, body: order.title, link });
    this.realtime.toCompany(user.companyId, 'order.created', { id: order.id });
    return order;
  }

  private assertEdit(user: AuthUser) {
    if (!user.permissions.has(PERMISSIONS.ordersEdit)) throw forbidden();
  }

  async update(user: AuthUser, id: string, input: OrderUpdate) {
    this.assertEdit(user);
    const before = await this.loadOrder(user, id);
    if (before.version !== input.version) throw new AppError('CONFLICT', 'Заказ уже изменил другой пользователь. Обновите страницу');
    const s = await this.settings.get();
    // ЗАК-46: скидка выше лимита — только с подтверждением руководителя.
    if (input.discountPercent !== undefined && input.discountPercent > s.discountLimitPercent && !user.permissions.has(PERMISSIONS.ordersApproveDiscount)) {
      const directors = await this.prisma.db.user.findMany({ where: { isActive: true, roles: { some: { role: { code: 'director' } } } }, select: { id: true } });
      await this.prisma.db.task.createMany({
        data: directors.map((d) => ({
          companyId: currentCompanyId(),
          title: `Подтвердить скидку ${input.discountPercent}% по ${before.number}`,
          assigneeId: d.id,
          authorId: user.id,
          orderId: id,
          isAuto: true,
          priority: 'high' as const,
        })),
      });
      throw new AppError('DISCOUNT_APPROVAL_REQUIRED', `Скидка выше ${s.discountLimitPercent}% требует подтверждения руководителя. Руководителю поставлена задача`);
    }
    const { version, ...patch } = input;
    void version;
    await assertClientChildren(this.prisma.db, before.clientId, { contactId: patch.contactId, equipmentId: patch.equipmentId });
    await assertCompanyUsers(this.prisma.db, [patch.managerId], 'managerId');
    const data: Prisma.OrderUncheckedUpdateInput = {
      ...patch,
      plannedFinishAt: patch.plannedFinishAt === undefined ? undefined : patch.plannedFinishAt ? new Date(patch.plannedFinishAt) : null,
      version: { increment: 1 },
    };
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const o = await tx.order.update({ where: { id }, data });
      if (patch.discountPercent !== undefined) await this.recalc(tx, id);
      if (patch.managerId && patch.managerId !== before.managerId) {
        await this.feed.system(tx, id, 'Сменился ответственный менеджер', { event: 'manager', userId: patch.managerId }, user.id);
      }
      await this.audit.log('update', 'order', id, AuditService.diff(before as unknown as Record<string, unknown>, patch), tx);
      return o;
    });
    if (patch.managerId && patch.managerId !== before.managerId) {
      await this.notifications.notify([patch.managerId], { type: 'order_assigned', title: `Вы ответственный за ${before.number}`, link: `/orders/${id}` });
    }
    this.realtime.toCompany(user.companyId, 'order.updated', { id });
    return updated;
  }

  async setAssignees(user: AuthUser, id: string, input: Assignees) {
    if (!user.permissions.has(PERMISSIONS.ordersAssign)) throw forbidden();
    const order = await this.loadOrder(user, id);
    await assertCompanyUsers(this.prisma.db, input.masterIds, 'masterIds');
    const before = new Set(order.assignees.map((a) => a.userId));
    const lead = input.leadMasterId && input.masterIds.includes(input.leadMasterId) ? input.leadMasterId : input.masterIds[0];
    await this.prisma.db.$transaction(async (tx) => {
      await tx.orderAssignee.deleteMany({ where: { orderId: id } });
      await tx.orderAssignee.createMany({ data: input.masterIds.map((userId) => ({ orderId: id, userId, isLead: userId === lead })) });
      await tx.order.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.feed.system(tx, id, 'Изменены исполнители', { event: 'assignees', userIds: input.masterIds }, user.id);
      await this.audit.log('assign', 'order', id, { masters: [[...before], input.masterIds] }, tx);
    });
    const added = input.masterIds.filter((m) => !before.has(m));
    await this.notifications.notify(added, { type: 'order_assigned', title: `Вы исполнитель заказа ${order.number}`, body: order.title, link: `/orders/${id}` });
    this.realtime.toCompany(user.companyId, 'order.updated', { id });
  }

  // ---------- Этапы ----------

  async changeStage(user: AuthUser, id: string, input: StageChangeInput) {
    const db = this.prisma.db;
    const order = await this.loadOrder(user, id);
    const pipeline = await db.pipeline.findFirstOrThrow({ where: { orderType: order.type }, include: { stages: true } });
    const to = pipeline.stages.find((s) => s.code === input.stageCode);
    if (!to) throw new AppError('VALIDATION_ERROR', 'Такого этапа нет в воронке');
    const from = order.stage;
    const totals = this.totals(order.items, order.discountPercent);
    const lastApproval = order.approvals[0];
    const facts: OrderFacts = {
      type: order.type,
      hasEquipment: !!order.equipmentId,
      photoCount: await db.file.count({ where: { orderId: id, mimeType: { startsWith: 'image/' } } }),
      approvedItemsCount: order.items.filter((i) => i.status === 'approved').length,
      proposedItemsCount: order.items.filter((i) => i.status === 'proposed').length,
      assigneesCount: order.assignees.length,
      hasApproval: !!lastApproval,
      approvalMatchesTotal: !!lastApproval && Number(lastApproval.totalKop) === totals.totalKop,
      isAssignee: order.assignees.some((a) => a.userId === user.id),
      lostReasonId: input.lostReasonId,
    };
    const result = checkTransition({ from, to, facts, permissions: user.permissions, comment: input.comment, override: input.override });
    if (result.denied.length) throw new AppError('FORBIDDEN', result.denied[0], result.denied.map((reason) => ({ reason })));
    if (result.blockers.length) {
      throw new AppError(
        'STAGE_TRANSITION_BLOCKED',
        `Нельзя перевести заказ в «${to.name}»: ${result.blockers[0].charAt(0).toLowerCase()}${result.blockers[0].slice(1)}`,
        result.blockers.map((reason) => ({ reason })),
      );
    }
    const now = new Date();
    const durationHours = Math.round((now.getTime() - order.stageChangedAt.getTime()) / HOUR);
    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          stageId: to.id,
          stageChangedAt: now,
          stuckNotifiedAt: null,
          finishedAt: to.kind === 'won' ? now : to.kind === 'lost' ? now : null,
          lostReasonId: to.kind === 'lost' ? input.lostReasonId : null,
          lostComment: to.kind === 'lost' ? input.comment : null,
          version: { increment: 1 },
        },
      });
      await tx.orderStageHistory.create({
        data: { orderId: id, fromStageId: from.id, toStageId: to.id, changedById: user.id, comment: input.comment, durationHours, overridden: result.overridden },
      });
      const text = result.overridden
        ? `Этап: «${from.name}» → «${to.name}» (проверки пропущены: ${input.comment})`
        : `Этап: «${from.name}» → «${to.name}»${input.comment ? `. ${input.comment}` : ''}`;
      await this.feed.system(tx, id, text, { event: 'stage', from: from.code, to: to.code, overridden: result.overridden }, user.id);
      await this.audit.log(result.overridden ? 'stage_override' : 'stage', 'order', id, { stage: [from.code, to.code] }, tx);
    });
    await this.notifications.notify([order.managerId, ...order.assignees.map((a) => a.userId)], {
      type: 'stage_changed',
      title: `${order.number}: ${to.name}`,
      body: `${user.fullName} перевёл заказ из «${from.name}»`,
      link: `/orders/${id}`,
    });
    this.realtime.toCompany(user.companyId, 'order.stageChanged', { id, from: from.code, to: to.code });
    this.realtime.toRoom(`order:${id}`, 'comment.created', { orderId: id });
    return { ok: true, overridden: result.overridden };
  }

  // ---------- Смета ----------

  /** ЗАК-43: мастер добавляет позиции «Предложено» без цен, менеджер утверждает. */
  async addItem(user: AuthUser, orderId: string, input: OrderItemInput) {
    const canEdit = user.permissions.has(PERMISSIONS.ordersEditEstimate);
    if (!canEdit && !user.permissions.has(PERMISSIONS.ordersProposeItems)) throw forbidden();
    const order = await this.loadOrder(user, orderId);
    if (!canEdit && !order.assignees.some((a) => a.userId === user.id)) throw forbidden('Предлагать позиции может мастер этого заказа');
    if (order.stage.kind !== 'open') throw new AppError('CONFLICT', 'Заказ закрыт, смету изменить нельзя');
    const item = await this.prisma.db.$transaction(async (tx) => {
      const row = await tx.orderItem.create({
        data: {
          orderId,
          kind: input.kind,
          name: input.name,
          quantity: input.quantity,
          unit: input.unit,
          priceKop: canEdit ? input.priceKop : 0,
          costKop: canEdit ? input.costKop : 0,
          discountPercent: canEdit ? input.discountPercent : 0,
          status: canEdit ? (input.status ?? 'approved') : 'proposed',
          isExtra: order.approvals.length > 0,
          sort: order.items.length,
          proposedById: canEdit ? null : user.id,
        },
      });
      if (!canEdit) await this.feed.system(tx, orderId, `Мастер предложил: ${input.name} × ${input.quantity} ${input.unit}`, { event: 'proposed' }, user.id);
      await this.recalc(tx, orderId);
      return row;
    });
    if (!canEdit) {
      await this.notifications.notify([order.managerId], { type: 'comment_new', title: `${order.number}: мастер предложил позицию`, body: input.name, link: `/orders/${orderId}` });
    }
    this.realtime.toCompany(user.companyId, 'order.updated', { id: orderId });
    return item;
  }

  private async itemOrThrow(user: AuthUser, itemId: string) {
    const item = await this.prisma.db.orderItem.findFirst({ where: { id: itemId, order: { companyId: user.companyId } } });
    if (!item) throw notFound('Позиция');
    const order = await this.loadOrder(user, item.orderId);
    if (order.stage.kind !== 'open') throw new AppError('CONFLICT', 'Заказ закрыт, смету изменить нельзя');
    return { item, order };
  }

  async updateItem(user: AuthUser, itemId: string, input: Partial<OrderItemInput>) {
    if (!user.permissions.has(PERMISSIONS.ordersEditEstimate)) throw forbidden();
    const { item, order } = await this.itemOrThrow(user, itemId);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.orderItem.update({ where: { id: itemId }, data: { ...input, isExtra: item.isExtra || order.approvals.length > 0 } });
      await this.recalc(tx, item.orderId);
      await this.audit.log('update', 'order_item', itemId, AuditService.diff(item as unknown as Record<string, unknown>, input), tx);
    });
    this.realtime.toCompany(user.companyId, 'order.updated', { id: item.orderId });
  }

  async removeItem(user: AuthUser, itemId: string) {
    if (!user.permissions.has(PERMISSIONS.ordersEditEstimate)) throw forbidden();
    const { item } = await this.itemOrThrow(user, itemId);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.orderItem.delete({ where: { id: itemId } });
      await this.recalc(tx, item.orderId);
      await this.audit.log('delete', 'order_item', itemId, { name: [item.name, null] }, tx);
    });
    this.realtime.toCompany(user.companyId, 'order.updated', { id: item.orderId });
  }

  /** ЗАК-44: фиксируем согласование сметы клиентом (версия + сумма). */
  async approveEstimate(user: AuthUser, orderId: string, input: Approve) {
    if (!user.permissions.has(PERMISSIONS.ordersEditEstimate)) throw forbidden();
    const order = await this.loadOrder(user, orderId);
    if (order.items.some((i) => i.status === 'proposed')) {
      throw new AppError('CONFLICT', 'В смете есть предложенные мастером позиции — утвердите или отклоните их');
    }
    const totals = this.totals(order.items, order.discountPercent);
    if (totals.totalKop === 0 && !order.items.some((i) => i.status === 'approved')) {
      throw new AppError('CONFLICT', 'Смета пустая');
    }
    const version = (order.approvals[0]?.version ?? 0) + 1;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.orderApproval.create({
        data: { orderId, version, totalKop: totals.totalKop, method: input.method, approvedByName: input.approvedByName, createdById: user.id },
      });
      await tx.orderItem.updateMany({ where: { orderId, isExtra: true }, data: { isExtra: false } });
      await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
      await this.feed.system(
        tx,
        orderId,
        `Смета${version > 1 ? ` (версия ${version})` : ''} согласована: ${input.approvedByName}, ${APPROVAL_METHOD_LABELS[input.method].toLowerCase()}`,
        { event: 'approved', version, totalKop: totals.totalKop },
        user.id,
      );
      await this.audit.log('approve_estimate', 'order', orderId, { total: [null, totals.totalKop] }, tx);
    });
    await this.notifications.notify(order.assignees.map((a) => a.userId), { type: 'stage_changed', title: `${order.number}: смета согласована`, link: `/orders/${orderId}` });
    this.realtime.toCompany(user.companyId, 'order.updated', { id: orderId });
  }
}
