import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody, ErrorCode } from '@hydrocrm/shared';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error';

/** Единый формат ошибок API (API-30…32). */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = randomUUID();
    let status = 500;
    let body: ApiErrorBody['error'] = { code: 'INTERNAL', message: 'Внутренняя ошибка сервера', requestId };

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details, requestId };
    } else if (exception instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: exception.issues[0]?.message ?? 'Проверьте заполнение полей',
        details: exception.issues.map((i) => ({ field: i.path.join('.'), reason: i.message })),
        requestId,
      };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        status = 404;
        body = { code: 'NOT_FOUND', message: 'Запись не найдена', requestId };
      } else if (exception.code === 'P2002') {
        status = 409;
        body = { code: 'CONFLICT', message: 'Такая запись уже существует', requestId };
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const map: Record<number, ErrorCode> = { 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 429: 'RATE_LIMITED' };
      const message =
        status === 404 ? 'Не найдено' : status === 429 ? 'Слишком много запросов, попробуйте позже' : exception.message;
      body = { code: map[status] ?? (status < 500 ? 'VALIDATION_ERROR' : 'INTERNAL'), message, requestId };
    }

    if (status >= 500) this.logger.error(`${req.method} ${req.url} [${requestId}]`, (exception as Error)?.stack);
    res.status(status).json({ error: body });
  }
}
