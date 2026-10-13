import { Global, Injectable, Module } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../common/request-context';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * WebSocket (API-60…64). Сервер только оповещает: в событиях передаются id и тип изменения,
 * сами данные интерфейс перезапрашивает через REST, где работают права. Поэтому скрытые поля
 * (маржа, цены для мастера) по сокету никогда не уходят.
 */
@WebSocketGateway({ path: '/ws', cors: { origin: config.webOrigin, credentials: true } })
@Injectable()
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = String(socket.handshake.auth?.token ?? '');
      const user = await this.auth.authenticate(token);
      socket.data.user = user;
      await socket.join([`user:${user.id}`, `company:${user.companyId}`]);
    } catch {
      socket.emit('auth.error');
      socket.disconnect(true);
    }
  }

  /** Подписка на комнату заказа или канала чата, только если они принадлежат компании пользователя. */
  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() room: string) {
    const user = socket.data.user as AuthUser | undefined;
    if (!user || typeof room !== 'string') return;
    const [kind, id] = room.split(':');
    const db = this.prisma.db;
    let allowed = false;
    if (kind === 'order') allowed = !!(await db.order.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } }));
    if (kind === 'chat') allowed = !!(await db.chatMember.findFirst({ where: { channelId: id, userId: user.id } }));
    if (allowed) await socket.join(room);
  }

  @SubscribeMessage('leave')
  async leave(@ConnectedSocket() socket: Socket, @MessageBody() room: string) {
    if (typeof room === 'string') await socket.leave(room);
  }

  emit(room: string, event: string, data: unknown) {
    this.server?.to(room).emit(event, data);
  }
}

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}
  toUser(userId: string, event: string, data: unknown = {}) {
    this.gateway.emit(`user:${userId}`, event, data);
  }
  toCompany(companyId: string, event: string, data: unknown = {}) {
    this.gateway.emit(`company:${companyId}`, event, data);
  }
  toRoom(room: string, event: string, data: unknown = {}) {
    this.gateway.emit(room, event, data);
  }
}

@Global()
@Module({ providers: [RealtimeGateway, RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
