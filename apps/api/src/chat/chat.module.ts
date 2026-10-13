import { Body, Controller, Get, HttpCode, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { chatChannelSchema, chatMessageSchema, directChannelSchema, PERMISSIONS } from '@hydrocrm/shared';
import { z } from 'zod';
import { AppError, forbidden, notFound } from '../common/app-error';
import { CurrentUser } from '../common/decorators';
import { assertCompanyUsers } from '../common/ownership';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.gateway';

/** Внутренний чат команды (ОБЩ-10…18). */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Канал «Общий» есть всегда, и в нём все активные сотрудники. */
  private async ensureGeneral(user: AuthUser) {
    const db = this.prisma.db;
    let general = await db.chatChannel.findFirst({ where: { type: 'general' } });
    if (!general) general = await db.chatChannel.create({ data: { companyId: currentCompanyId(), type: 'general', name: 'Общий' } });
    await db.chatMember.upsert({
      where: { channelId_userId: { channelId: general.id, userId: user.id } },
      create: { channelId: general.id, userId: user.id },
      update: {},
    });
  }

  async channels(user: AuthUser) {
    await this.ensureGeneral(user);
    const db = this.prisma.db;
    const channels = await db.chatChannel.findMany({
      where: { members: { some: { userId: user.id } } },
      include: {
        members: { select: { userId: true, lastReadAt: true } },
        messages: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const result = await Promise.all(
      channels.map(async (c) => {
        const me = c.members.find((m) => m.userId === user.id)!;
        const unread = await db.chatMessage.count({
          where: { channelId: c.id, deletedAt: null, authorId: { not: user.id }, createdAt: { gt: me.lastReadAt } },
        });
        return {
          id: c.id,
          type: c.type,
          name: c.name,
          memberIds: c.members.map((m) => m.userId),
          lastMessage: c.messages[0] ?? null,
          unread,
        };
      }),
    );
    const order = { general: 0, group: 1, direct: 2 };
    return result.sort(
      (a, b) =>
        order[a.type] - order[b.type] ||
        (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0),
    );
  }

  private async member(user: AuthUser, channelId: string) {
    const channel = await this.prisma.db.chatChannel.findFirst({ where: { id: channelId }, include: { members: true } });
    if (!channel) throw notFound('Канал');
    if (!channel.members.some((m) => m.userId === user.id)) throw forbidden('Вы не участник этого канала');
    return channel;
  }

  async messages(user: AuthUser, channelId: string, before?: string) {
    await this.member(user, channelId);
    const rows = await this.prisma.db.chatMessage.findMany({
      where: { channelId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.reverse().map((m) => (m.deletedAt ? { ...m, text: '' } : m));
  }

  async post(user: AuthUser, channelId: string, text: string) {
    const channel = await this.member(user, channelId);
    const db = this.prisma.db;
    const msg = await db.chatMessage.create({ data: { channelId, authorId: user.id, text } });
    await db.chatMember.update({ where: { channelId_userId: { channelId, userId: user.id } }, data: { lastReadAt: msg.createdAt } });
    const others = channel.members.map((m) => m.userId).filter((id) => id !== user.id);
    for (const id of others) this.realtime.toUser(id, 'chat.message', { channelId, id: msg.id });
    this.realtime.toUser(user.id, 'chat.message', { channelId, id: msg.id });
    // Упоминания и личные сообщения дают уведомление, остальное — только счётчик непрочитанных.
    const users = await db.user.findMany({ where: { id: { in: others } }, select: { id: true, fullName: true } });
    const mentioned = users.filter((u) => text.toLowerCase().includes('@' + u.fullName.toLowerCase())).map((u) => u.id);
    const notifyIds = channel.type === 'direct' ? others : mentioned;
    await this.notifications.notify(notifyIds, {
      type: 'mention',
      title: channel.type === 'direct' ? `Сообщение от ${user.fullName}` : `${user.fullName} упомянул вас в «${channel.name}»`,
      body: text.slice(0, 200),
      link: `/chat/${channelId}`,
    });
    return msg;
  }

  async read(user: AuthUser, channelId: string) {
    await this.member(user, channelId);
    await this.prisma.db.chatMember.update({ where: { channelId_userId: { channelId, userId: user.id } }, data: { lastReadAt: new Date() } });
  }

  async createGroup(user: AuthUser, name: string, memberIds: string[]) {
    if (!user.permissions.has(PERMISSIONS.settingsManage)) throw forbidden('Создавать каналы может руководитель или администратор');
    await assertCompanyUsers(this.prisma.db, memberIds, 'memberIds');
    const ids = [...new Set([user.id, ...memberIds])];
    const channel = await this.prisma.db.chatChannel.create({
      data: { companyId: currentCompanyId(), type: 'group', name, members: { create: ids.map((userId) => ({ userId })) } },
    });
    for (const id of ids) this.realtime.toUser(id, 'chat.channels', {});
    return channel;
  }

  async direct(user: AuthUser, otherId: string) {
    if (otherId === user.id) throw new AppError('VALIDATION_ERROR', 'Нельзя написать самому себе');
    const db = this.prisma.db;
    const other = await db.user.findFirst({ where: { id: otherId, isActive: true } });
    if (!other) throw notFound('Сотрудник');
    const existing = await db.chatChannel.findFirst({
      where: { type: 'direct', AND: [{ members: { some: { userId: user.id } } }, { members: { some: { userId: otherId } } }] },
    });
    if (existing) return existing;
    return db.chatChannel.create({
      data: { companyId: currentCompanyId(), type: 'direct', members: { create: [{ userId: user.id }, { userId: otherId }] } },
    });
  }
}

@Controller('chat')
class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('channels')
  channels(@CurrentUser() user: AuthUser) {
    return this.chat.channels(user);
  }

  @Get('channels/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('before') before?: string) {
    return this.chat.messages(user, id, before);
  }

  @Post('channels/:id/messages')
  post(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(chatMessageSchema)) body: z.infer<typeof chatMessageSchema>) {
    return this.chat.post(user, id, body.text);
  }

  @Post('channels/:id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.read(user, id);
  }

  @Post('channels')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(chatChannelSchema)) body: z.infer<typeof chatChannelSchema>) {
    return this.chat.createGroup(user, body.name, body.memberIds);
  }

  @Post('direct')
  direct(@CurrentUser() user: AuthUser, @Body(new ZodPipe(directChannelSchema)) body: z.infer<typeof directChannelSchema>) {
    return this.chat.direct(user, body.userId);
  }
}

@Module({ controllers: [ChatController], providers: [ChatService] })
export class ChatModule {}
