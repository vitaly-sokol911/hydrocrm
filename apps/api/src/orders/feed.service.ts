import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError, notFound } from '../common/app-error';
import type { AuthUser } from '../common/request-context';
import { SettingsService } from '../common/settings.service';
import { orderScope } from '../common/visibility';
import { FilesService } from '../files/files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';

const EDIT_WINDOW_MS = 15 * 60_000;

/** Лента заказа (ОБЩ-1…7): комментарии сотрудников и системные события в одном потоке. */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly files: FilesService,
  ) {}

  /** Системное событие в ленте: смена этапа, согласование, назначение… */
  async system(tx: Tx, orderId: string, text: string, payload?: Prisma.InputJsonValue, authorId?: string) {
    await tx.comment.create({ data: { orderId, kind: 'system', text, payload, authorId } });
  }

  async assertAccess(user: AuthUser, orderId: string) {
    const s = await this.settings.get();
    const order = await this.prisma.db.order.findFirst({
      where: { id: orderId, ...orderScope(user, s) },
      select: { id: true, number: true, managerId: true, assignees: { select: { userId: true } } },
    });
    if (!order) throw notFound('Заказ');
    return order;
  }

  async list(user: AuthUser, orderId: string) {
    await this.assertAccess(user, orderId);
    const rows = await this.prisma.db.comment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      include: { files: true },
    });
    const read = await this.prisma.db.orderRead.findUnique({ where: { orderId_userId: { orderId, userId: user.id } } });
    return {
      items: rows.map((c) => ({
        ...c,
        text: c.deletedAt ? '' : c.text,
        files: c.deletedAt ? [] : c.files.map((f) => this.files.toDto(f)),
      })),
      lastReadAt: read?.lastReadAt ?? null,
    };
  }

  /** Упоминания: «@Имя Фамилия» в тексте сопоставляется с сотрудниками компании. */
  private async findMentions(text: string): Promise<string[]> {
    if (!text.includes('@')) return [];
    const users = await this.prisma.db.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true } });
    const lower = text.toLowerCase();
    return users.filter((u) => lower.includes('@' + u.fullName.toLowerCase())).map((u) => u.id);
  }

  async add(user: AuthUser, orderId: string, text: string, fileIds: string[]) {
    const order = await this.assertAccess(user, orderId);
    if (!text.trim() && !fileIds.length) throw new AppError('VALIDATION_ERROR', 'Напишите комментарий или приложите файл');
    const mentions = await this.findMentions(text);
    const comment = await this.prisma.db.$transaction(async (tx) => {
      const c = await tx.comment.create({ data: { orderId, authorId: user.id, text: text.trim(), mentions } });
      if (fileIds.length) {
        await tx.file.updateMany({ where: { id: { in: fileIds }, uploadedById: user.id }, data: { commentId: c.id, orderId } });
      }
      await tx.orderRead.upsert({
        where: { orderId_userId: { orderId, userId: user.id } },
        create: { orderId, userId: user.id },
        update: { lastReadAt: new Date() },
      });
      return c;
    });
    const link = `/orders/${orderId}`;
    await this.notifications.notify(mentions, { type: 'mention', title: `${user.fullName} упомянул вас в ${order.number}`, body: text.slice(0, 200), link });
    const watchers = [order.managerId, ...order.assignees.map((a) => a.userId)].filter((id) => id && !mentions.includes(id));
    await this.notifications.notify(watchers, { type: 'comment_new', title: `Новый комментарий в ${order.number}`, body: `${user.fullName}: ${text.slice(0, 150)}`, link });
    this.realtime.toRoom(`order:${orderId}`, 'comment.created', { orderId, id: comment.id });
    this.realtime.toCompany(user.companyId, 'order.updated', { id: orderId });
    return comment;
  }

  /** ОБЩ-5: автор правит 15 минут, дальше — только руководитель. */
  async edit(user: AuthUser, commentId: string, text: string | null) {
    const c = await this.prisma.db.comment.findFirst({ where: { id: commentId, kind: 'comment', order: { companyId: user.companyId } } });
    if (!c) throw notFound('Комментарий');
    await this.assertAccess(user, c.orderId);
    const isDirector = user.roles.includes('director') || user.roles.includes('admin');
    const ownFresh = c.authorId === user.id && Date.now() - c.createdAt.getTime() < EDIT_WINDOW_MS;
    if (!ownFresh && !isDirector) throw new AppError('FORBIDDEN', 'Комментарий можно изменить в течение 15 минут после отправки');
    const updated = await this.prisma.db.comment.update({
      where: { id: commentId },
      data: text === null ? { deletedAt: new Date() } : { text, editedAt: new Date() },
    });
    this.realtime.toRoom(`order:${c.orderId}`, 'comment.updated', { orderId: c.orderId, id: c.id });
    return updated;
  }

  async markRead(user: AuthUser, orderId: string) {
    await this.assertAccess(user, orderId);
    await this.prisma.db.orderRead.upsert({
      where: { orderId_userId: { orderId, userId: user.id } },
      create: { orderId, userId: user.id },
      update: { lastReadAt: new Date() },
    });
  }
}
