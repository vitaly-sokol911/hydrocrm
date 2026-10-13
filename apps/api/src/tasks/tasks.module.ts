import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS, taskCreateSchema, taskUpdateSchema, type TaskCreateInput } from '@hydrocrm/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError, notFound } from '../common/app-error';
import { CurrentUser } from '../common/decorators';
import { assertClient, assertCompanyUsers, assertLead, assertOrder } from '../common/ownership';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';

type TaskUpdate = z.infer<typeof taskUpdateSchema>;

const include = {
  order: { select: { id: true, number: true, title: true } },
  client: { select: { id: true, name: true } },
} as const;

/** Задачи (ЗАД-1…7). */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(user: AuthUser, q: { scope: 'mine' | 'created' | 'all'; status?: string; orderId?: string; clientId?: string }) {
    const and: Prisma.TaskWhereInput[] = [];
    if (q.orderId) and.push({ orderId: q.orderId });
    if (q.clientId) and.push({ clientId: q.clientId });
    if (!q.orderId && !q.clientId) {
      if (q.scope === 'mine') and.push({ assigneeId: user.id });
      else if (q.scope === 'created') and.push({ authorId: user.id, assigneeId: { not: user.id } });
      else if (!user.permissions.has(PERMISSIONS.tasksViewAll)) and.push({ OR: [{ assigneeId: user.id }, { authorId: user.id }] });
    }
    and.push({ status: (q.status as Prisma.EnumTaskStatusFilter['equals']) ?? 'open' });
    return this.prisma.db.task.findMany({
      where: { AND: and },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      include,
      take: 300,
    });
  }

  private async assertLinks(input: Partial<TaskCreateInput>) {
    const db = this.prisma.db;
    await assertCompanyUsers(db, [input.assigneeId], 'assigneeId');
    await assertOrder(db, input.orderId);
    await assertClient(db, input.clientId);
    await assertLead(db, input.leadId);
  }

  async create(user: AuthUser, input: TaskCreateInput) {
    await this.assertLinks(input);
    const task = await this.prisma.db.task.create({
      data: { ...input, companyId: currentCompanyId(), authorId: user.id, dueAt: input.dueAt ? new Date(input.dueAt) : null },
      include,
    });
    if (task.orderId) {
      await this.prisma.db.comment.create({
        data: { orderId: task.orderId, kind: 'system', authorId: user.id, text: `Поставлена задача: ${task.title}`, payload: { event: 'task', taskId: task.id } },
      });
      this.realtime.toRoom(`order:${task.orderId}`, 'comment.created', { orderId: task.orderId });
    }
    await this.audit.log('create', 'task', task.id);
    await this.notifications.notify([task.assigneeId], {
      type: 'task_assigned',
      title: `Новая задача от ${user.fullName}`,
      body: task.title,
      link: task.orderId ? `/orders/${task.orderId}?tab=tasks` : '/tasks',
    });
    this.realtime.toUser(task.assigneeId, 'task.changed', { id: task.id });
    return task;
  }

  async update(user: AuthUser, id: string, input: TaskUpdate) {
    const db = this.prisma.db;
    const task = await db.task.findFirst({ where: { id } });
    if (!task) throw notFound('Задача');
    const isParty = task.assigneeId === user.id || task.authorId === user.id;
    if (!isParty && !user.permissions.has(PERMISSIONS.tasksViewAll)) throw new AppError('FORBIDDEN', 'Это не ваша задача');
    await this.assertLinks(input);
    const completing = input.status === 'done' && task.status !== 'done';
    const updated = await db.task.update({
      where: { id },
      data: {
        ...input,
        dueAt: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null,
        completedAt: input.status === 'done' ? new Date() : input.status === 'open' ? null : undefined,
        overdueNotifiedAt: input.dueAt !== undefined ? null : undefined,
      },
      include,
    });
    await this.audit.log('update', 'task', id, AuditService.diff(task as unknown as Record<string, unknown>, input));
    if (completing) {
      if (task.orderId) {
        await db.comment.create({
          data: {
            orderId: task.orderId,
            kind: 'system',
            authorId: user.id,
            text: `Задача выполнена: ${task.title}${input.resultComment ? `. ${input.resultComment}` : ''}`,
            payload: { event: 'task_done', taskId: id },
          },
        });
        this.realtime.toRoom(`order:${task.orderId}`, 'comment.created', { orderId: task.orderId });
      }
      await this.notifications.notify([task.authorId], { type: 'task_done', title: `${user.fullName} выполнил задачу`, body: task.title, link: '/tasks?scope=created' });
    }
    if (input.assigneeId && input.assigneeId !== task.assigneeId) {
      await this.notifications.notify([input.assigneeId], { type: 'task_assigned', title: `Вам передана задача`, body: task.title, link: '/tasks' });
    }
    for (const u of [task.assigneeId, task.authorId]) if (u) this.realtime.toUser(u, 'task.changed', { id });
    return updated;
  }
}

const listQuery = z.object({
  scope: z.enum(['mine', 'created', 'all']).default('mine'),
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  orderId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
});

@Controller('tasks')
class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.service.list(user, q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(taskCreateSchema)) body: TaskCreateInput) {
    return this.service.create(user, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(taskUpdateSchema)) body: TaskUpdate) {
    return this.service.update(user, id, body);
  }
}

@Module({ controllers: [TasksController], providers: [TasksService], exports: [TasksService] })
export class TasksModule {}
