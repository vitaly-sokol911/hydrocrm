import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { requestContext } from '../common/request-context';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const HOUR = 3_600_000;

/**
 * Проверки по расписанию: просроченные заявки (ЗАЯ-5), заказы без движения (ЗАК-7),
 * просроченные задачи (ЗАД-6). Каждое событие уведомляется один раз (поле *NotifiedAt).
 * Выполняется по каждой компании внутри её контекста, чтобы работала изоляция данных.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger('Jobs');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const companies = await this.prisma.db.company.findMany({ select: { id: true } });
      for (const c of companies) await requestContext.run({ companyId: c.id }, () => this.runForCompany());
    } catch (e) {
      this.logger.error('Ошибка задач по расписанию', (e as Error).stack);
    } finally {
      this.running = false;
    }
  }

  private async directors() {
    const rows = await this.prisma.db.user.findMany({
      where: { isActive: true, roles: { some: { role: { code: 'director' } } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async runForCompany() {
    const db = this.prisma.db;
    const now = new Date();

    const leads = await db.lead.findMany({
      where: { status: 'new', firstResponseAt: null, responseDueAt: { lt: now }, overdueNotifiedAt: null },
      take: 100,
    });
    if (leads.length) {
      const directors = await this.directors();
      for (const l of leads) {
        await this.notifications.notify([l.assigneeId, ...directors], {
          type: 'lead_overdue',
          title: `Заявка ${l.number} просрочена`,
          body: l.description.slice(0, 200),
          link: `/leads/${l.id}`,
        });
        await db.lead.update({ where: { id: l.id }, data: { overdueNotifiedAt: now } });
      }
    }

    const open = await db.order.findMany({
      where: { stuckNotifiedAt: null, stage: { kind: 'open', normHours: { not: null } } },
      include: { stage: true },
      take: 500,
    });
    const stuck = open.filter((o) => now.getTime() - o.stageChangedAt.getTime() > (o.stage.normHours ?? 0) * HOUR);
    for (const o of stuck) {
      await this.notifications.notify([o.managerId], {
        type: 'order_stuck',
        title: `${o.number} без движения: «${o.stage.name}»`,
        body: o.title,
        link: `/orders/${o.id}`,
      });
      await db.order.update({ where: { id: o.id }, data: { stuckNotifiedAt: now } });
    }

    const tasks = await db.task.findMany({ where: { status: 'open', dueAt: { lt: now }, overdueNotifiedAt: null }, take: 200 });
    for (const t of tasks) {
      await this.notifications.notify([t.assigneeId], {
        type: 'task_overdue',
        title: 'Задача просрочена',
        body: t.title,
        link: t.orderId ? `/orders/${t.orderId}?tab=tasks` : '/tasks',
      });
      await db.task.update({ where: { id: t.id }, data: { overdueNotifiedAt: now } });
    }
  }
}

@Module({ providers: [JobsService] })
export class JobsModule {}
