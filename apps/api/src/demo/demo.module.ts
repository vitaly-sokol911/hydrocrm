import { Controller, HttpCode, Injectable, Logger, Module, OnApplicationBootstrap, Post } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PERMISSIONS } from '@hydrocrm/shared';
import { AuthService } from '../auth/auth.service';
import { AppError } from '../common/app-error';
import { Perm } from '../common/decorators';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { seedDemo } from './demo-data';

/** Песочница: ночной сброс и сброс по кнопке (ДЕМ-4). Работает только при DEMO_MODE=true. */
@Injectable()
class DemoService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Demo');
  private resetting = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async onApplicationBootstrap() {
    if (config.demoMode && !(await this.prisma.db.company.count())) {
      this.logger.log('База пустая — заполняю демо-данными');
      await this.reset();
    }
  }

  @Cron('0 0 3 * * *')
  async nightly() {
    if (config.demoMode) await this.reset();
  }

  async reset() {
    if (!config.demoMode) throw new AppError('FORBIDDEN', 'Сброс доступен только в песочнице');
    if (this.resetting) throw new AppError('CONFLICT', 'Сброс уже выполняется');
    this.resetting = true;
    try {
      const stats = await seedDemo(this.prisma.db);
      this.auth.invalidate();
      this.logger.log(`Демо-данные пересозданы: ${JSON.stringify(stats)}`);
      return stats;
    } finally {
      this.resetting = false;
    }
  }
}

@Controller('demo')
class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post('reset')
  @HttpCode(200)
  @Perm(PERMISSIONS.settingsManage)
  reset() {
    return this.demo.reset();
  }
}

@Module({ controllers: [DemoController], providers: [DemoService] })
export class DemoModule {}
