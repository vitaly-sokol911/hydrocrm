import { Global, Injectable, Module } from '@nestjs/common';
import type { File as FileRow } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { AppError } from '../common/app-error';
import { assertOrder, assertVisit } from '../common/ownership';
import { currentCompanyId, type AuthUser } from '../common/request-context';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-excel)|audio\/[\w.+-]+)$/;
const LINK_TTL_SEC = 60 * 60;

/**
 * Проверка «магических байтов»: тип, заявленный браузером, легко подделать.
 * Для типов без надёжной сигнатуры (текст, офисные документы, аудио) проверка не выполняется —
 * они отдаются только как вложение (Content-Disposition: attachment), а не открываются в браузере.
 */
const SIGNATURES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
};
function matchesSignature(buf: Buffer, mime: string): boolean {
  const sigs = SIGNATURES[mime];
  if (!sigs) return true;
  return sigs.some((sig) => sig.every((b, i) => buf[i] === b));
}

/** Какие типы можно показывать прямо в браузере (картинки и PDF), остальное — только скачивание. */
export const INLINE_TYPES = new Set(Object.keys(SIGNATURES));

/**
 * Файлы (АРХ-15, 16). В разработке — на диске (UPLOADS_DIR), на сервере это же API будет писать в S3.
 * Ссылки на скачивание подписаны HMAC и живут час, поэтому их можно вставлять в <img>.
 */
@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {}

  private sign(id: string, exp: number) {
    return createHmac('sha256', config.jwtSecret).update(`${id}.${exp}`).digest('base64url');
  }

  url(id: string) {
    const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SEC;
    return `/api/v1/files/${id}?exp=${exp}&sig=${this.sign(id, exp)}`;
  }

  verify(id: string, exp: string, sig: string): boolean {
    const e = Number(exp);
    if (!e || e < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(id, e));
    const given = Buffer.from(sig ?? '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  toDto(f: FileRow) {
    return { id: f.id, name: f.originalName, mimeType: f.mimeType, size: f.sizeBytes, createdAt: f.createdAt, url: this.url(f.id) };
  }

  absolutePath(storageKey: string) {
    return join(config.uploadsDir, storageKey);
  }

  async save(user: AuthUser, file: Express.Multer.File, link: { orderId?: string; visitId?: string }) {
    if (!file) throw new AppError('VALIDATION_ERROR', 'Файл не передан');
    if (file.size > config.maxUploadBytes) throw new AppError('VALIDATION_ERROR', 'Файл больше 20 МБ');
    if (!ALLOWED.test(file.mimetype)) throw new AppError('VALIDATION_ERROR', 'Такой тип файла загрузить нельзя');
    if (!matchesSignature(file.buffer, file.mimetype)) throw new AppError('VALIDATION_ERROR', 'Содержимое файла не соответствует его типу');
    const companyId = currentCompanyId();
    await assertOrder(this.prisma.db, link.orderId);
    await assertVisit(this.prisma.db, link.visitId);
    const now = new Date();
    const key = join(companyId, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    await mkdir(join(config.uploadsDir, key, '..'), { recursive: true });
    await writeFile(this.absolutePath(key), file.buffer);
    // multer отдаёт имя в latin1 — возвращаем кириллицу
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const row = await this.prisma.db.file.create({
      data: {
        companyId,
        storageKey: key,
        originalName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: user.id,
        orderId: link.orderId,
        visitId: link.visitId,
      },
    });
    return this.toDto(row);
  }
}

@Global()
@Module({ providers: [FilesService], exports: [FilesService] })
export class FilesModule {}
