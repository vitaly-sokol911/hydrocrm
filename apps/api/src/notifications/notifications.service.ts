import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@hydrocrm/shared';
import { requestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

/** Уведомления сотрудникам в CRM (ЗАД-20…26). Push и Telegram подключаются следующим шагом этапа 1. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Автор действия не получает уведомление о собственном действии (ЗАД-26). */
  async notify(userIds: (string | null | undefined)[], input: NotifyInput) {
    const actor = requestContext.user()?.id;
    const companyId = requestContext.companyId();
    const ids = [...new Set(userIds.filter((id): id is string => !!id && id !== actor))];
    if (!ids.length || !companyId) return;
    await this.prisma.db.notification.createMany({
      data: ids.map((userId) => ({ companyId, userId, type: input.type, title: input.title, body: input.body, link: input.link })),
    });
    for (const id of ids) this.realtime.toUser(id, 'notification.new', { type: input.type, title: input.title, link: input.link });
  }

  async list(userId: string, onlyUnread: boolean) {
    const db = this.prisma.db;
    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId, ...(onlyUnread ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, ids?: string[]) {
    await this.prisma.db.notification.updateMany({
      where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
  }
}
