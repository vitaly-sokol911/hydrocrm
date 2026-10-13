import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PERMISSIONS } from '@hydrocrm/shared';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { orderScope, priceVisibility } from '../common/visibility';
import { PrismaService } from '../prisma/prisma.service';

const HOUR = 3_600_000;

/** Главная по ролям (ИНФ §3) и простой дашборд руководителя (АНЛ-10). */
@Injectable()
class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async get(user: AuthUser) {
    const db = this.prisma.db;
    const s = await this.settings.get();
    const scope = orderScope(user, s);
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * HOUR);
    const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const openOrders = await db.order.findMany({
      where: { ...scope, stage: { kind: 'open' } },
      select: {
        id: true,
        number: true,
        title: true,
        type: true,
        managerId: true,
        plannedFinishAt: true,
        stageChangedAt: true,
        totalKop: true,
        client: { select: { name: true } },
        stage: { select: { code: true, name: true, color: true, normHours: true, sort: true } },
        assignees: { select: { userId: true } },
      },
    });
    const stuck = openOrders
      .filter((o) => o.stage.normHours && now.getTime() - o.stageChangedAt.getTime() > o.stage.normHours * HOUR)
      .map((o) => ({ ...o, totalKop: undefined, hoursOnStage: Math.round((now.getTime() - o.stageChangedAt.getTime()) / HOUR) }))
      .sort((a, b) => b.hoursOnStage - a.hoursOnStage);
    const overdue = openOrders.filter((o) => o.plannedFinishAt && o.plannedFinishAt < now);

    const byStage = new Map<string, { type: string; code: string; name: string; color: string | null; sort: number; count: number }>();
    for (const o of openOrders) {
      const key = `${o.type}:${o.stage.code}`;
      const row = byStage.get(key) ?? { type: o.type, code: o.stage.code, name: o.stage.name, color: o.stage.color, sort: o.stage.sort, count: 0 };
      row.count++;
      byStage.set(key, row);
    }

    const canLeads = user.permissions.has(PERMISSIONS.leadsView);
    const [leadsToday, leadsWeek, leadsOverdue, leadsNewList] = canLeads
      ? await Promise.all([
          db.lead.count({ where: { createdAt: { gte: dayStart }, status: { not: 'spam' } } }),
          db.lead.count({ where: { createdAt: { gte: weekAgo }, status: { not: 'spam' } } }),
          db.lead.count({ where: { status: 'new', firstResponseAt: null, responseDueAt: { lt: now } } }),
          db.lead.findMany({
            where: { status: { in: ['new', 'in_progress'] }, ...(user.roles.includes('director') ? {} : { OR: [{ assigneeId: user.id }, { assigneeId: null }] }) },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { id: true, number: true, status: true, channel: true, contactName: true, description: true, responseDueAt: true, firstResponseAt: true, createdAt: true, client: { select: { name: true } } },
          }),
        ])
      : [0, 0, 0, []];

    const visitsToday = await db.visit.findMany({
      where: {
        plannedStartAt: { gte: dayStart, lt: dayEnd },
        status: { not: 'cancelled' },
        order: scope,
        ...(user.permissions.has(PERMISSIONS.visitsPlan) ? {} : { assignees: { some: { userId: user.id } } }),
      },
      orderBy: { plannedStartAt: 'asc' },
      select: { id: true, status: true, plannedStartAt: true, address: true, assignees: { select: { userId: true } }, order: { select: { id: true, number: true, client: { select: { name: true } } } } },
    });

    const tasks = await db.task.findMany({
      where: { assigneeId: user.id, status: 'open', OR: [{ dueAt: null }, { dueAt: { lt: dayEnd } }] },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }],
      take: 10,
      select: { id: true, title: true, dueAt: true, priority: true, order: { select: { id: true, number: true } } },
    });

    const overdueTasksByUser = user.permissions.has(PERMISSIONS.tasksViewAll)
      ? await db.task.groupBy({ by: ['assigneeId'], where: { status: 'open', dueAt: { lt: now } }, _count: { _all: true } })
      : [];

    const vis = priceVisibility(user, s);
    let money: null | { inWorkKop: number; doneMonthKop: number; doneMonthCount: number; marginMonthKop: number | null } = null;
    if (vis.prices && user.permissions.has(PERMISSIONS.analyticsView)) {
      const done = await db.order.findMany({
        where: { ...scope, stage: { kind: 'won' }, finishedAt: { gte: monthStart } },
        select: { totalKop: true, costKop: true },
      });
      money = {
        inWorkKop: openOrders.reduce((sum, o) => sum + Number(o.totalKop), 0),
        doneMonthKop: done.reduce((sum, o) => sum + Number(o.totalKop), 0),
        doneMonthCount: done.length,
        marginMonthKop: vis.margin ? done.reduce((sum, o) => sum + Number(o.totalKop) - Number(o.costKop), 0) : null,
      };
    }

    const mine = openOrders.filter((o) => o.managerId === user.id || o.assignees.some((a) => a.userId === user.id));
    return {
      leads: canLeads ? { today: leadsToday, week: leadsWeek, overdue: leadsOverdue, latest: leadsNewList } : null,
      orders: {
        open: openOrders.length,
        overdue: overdue.length,
        stuck: stuck.slice(0, 8),
        stuckCount: stuck.length,
        byStage: [...byStage.values()].sort((a, b) => a.type.localeCompare(b.type) || a.sort - b.sort),
        mine: mine
          .sort((a, b) => a.stage.sort - b.stage.sort)
          .slice(0, 12)
          .map((o) => ({ ...o, totalKop: undefined })),
        ready: openOrders.filter((o) => o.stage.code === 'ready').length,
        estimate: openOrders.filter((o) => o.stage.code === 'estimate').length,
      },
      visitsToday,
      tasks,
      overdueTasksByUser: overdueTasksByUser.map((r) => ({ userId: r.assigneeId, count: r._count._all })),
      money,
    };
  }
}

@Controller('dashboard')
class DashboardController {
  constructor(private readonly service: DashboardService) {}
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
