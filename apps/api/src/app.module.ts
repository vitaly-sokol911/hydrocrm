import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuditModule } from './audit/audit.service';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { ClientsModule } from './clients/clients.module';
import { ContextInterceptor } from './common/context.interceptor';
import { Public } from './common/decorators';
import { ErrorFilter } from './common/error.filter';
import { SettingsModule } from './common/settings.service';
import { config } from './config';
import { DashboardModule } from './dashboard/dashboard.module';
import { DemoModule } from './demo/demo.module';
import { DictionariesModule } from './dictionaries/dictionaries.module';
import { FilesHttpModule } from './files/files.controller';
import { FilesModule } from './files/files.service';
import { JobsModule } from './jobs/jobs.service';
import { LeadsModule } from './leads/leads.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { RealtimeModule } from './realtime/realtime.gateway';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';
import { VisitsModule } from './visits/visits.module';

@Controller()
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** АРХ-71: проверка доступности для внешнего мониторинга. */
  @Public()
  @Get('health')
  async health() {
    await this.prisma.db.$queryRaw`SELECT 1`;
    return { status: 'ok', demo: config.demoMode, time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    // АРХ-17: не больше 120 запросов в минуту с одного IP; для входа — отдельный строгий лимит.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    // На сервере API сам раздаёт собранный интерфейс — один процесс, один порт.
    ...(config.webDistDir
      ? [ServeStaticModule.forRoot({ rootPath: config.webDistDir, exclude: ['/api/{*any}', '/ws/{*any}'] })]
      : []),
    PrismaModule,
    SettingsModule,
    AuditModule,
    RealtimeModule,
    NotificationsModule,
    FilesModule,
    AuthModule,
    UsersModule,
    DictionariesModule,
    ClientsModule,
    OrdersModule,
    LeadsModule,
    VisitsModule,
    TasksModule,
    ChatModule,
    FilesHttpModule,
    DashboardModule,
    JobsModule,
    DemoModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: APP_INTERCEPTOR, useClass: ContextInterceptor },
  ],
})
export class AppModule {}
