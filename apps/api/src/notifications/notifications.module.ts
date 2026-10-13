import { Body, Controller, Get, Global, HttpCode, Module, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from './notifications.service';

const markReadSchema = z.object({ ids: z.array(z.string().uuid()).optional() });

@Controller('notifications')
class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.service.list(user.id, unread === 'true');
  }

  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Body(new ZodPipe(markReadSchema)) body: z.infer<typeof markReadSchema>) {
    await this.service.markRead(user.id, body.ids);
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
