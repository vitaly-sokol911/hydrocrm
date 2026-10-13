import { Controller, Get, Module, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { AppError } from '../common/app-error';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { FilesService, INLINE_TYPES } from './files.service';

@Controller('files')
class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.maxUploadBytes } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Query('orderId') orderId?: string,
    @Query('visitId') visitId?: string,
  ) {
    return this.files.save(user, file, { orderId, visitId });
  }

  /** Скачивание по подписанной ссылке (без заголовка авторизации — подходит для <img>). */
  @Public()
  @Get(':id')
  async download(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    if (!this.files.verify(id, exp, sig)) throw new AppError('FORBIDDEN', 'Ссылка на файл устарела. Обновите страницу');
    const f = await this.prisma.db.file.findUnique({ where: { id } });
    if (!f) throw new AppError('NOT_FOUND', 'Файл не найден');
    const path = this.files.absolutePath(f.storageKey);
    if (!existsSync(path)) throw new AppError('NOT_FOUND', 'Файл не найден в хранилище');
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const disposition = INLINE_TYPES.has(f.mimeType) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(f.originalName)}`);
    res.sendFile(path);
  }
}

@Module({ controllers: [FilesController] })
export class FilesHttpModule {}
