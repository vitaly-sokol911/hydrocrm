import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Справочники и воронки (раздел 14 модели данных, §1 модуля Заказы). Редактирование — в настройках, следующим шагом. */
@Controller()
class DictionariesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('dictionaries')
  async all() {
    const db = this.prisma.db;
    const [leadSources, rejectReasons, pipelines] = await Promise.all([
      db.leadSource.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      db.rejectReason.findMany({ orderBy: { name: 'asc' } }),
      db.pipeline.findMany({ include: { stages: { orderBy: { sort: 'asc' } } }, orderBy: { orderType: 'asc' } }),
    ]);
    return { leadSources, rejectReasons, pipelines };
  }
}

@Module({ controllers: [DictionariesController] })
export class DictionariesModule {}
