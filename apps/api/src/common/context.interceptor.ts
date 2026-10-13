import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { requestContext, type AuthUser } from './request-context';

/** Выполняет обработчик внутри контекста запроса, чтобы сервисы и Prisma знали пользователя и компанию. */
@Injectable()
export class ContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const store = { user: req.user, ip: req.ip };
    return new Observable((subscriber) =>
      requestContext.run(store, () => {
        const sub = next.handle().subscribe(subscriber);
        return () => sub.unsubscribe();
      }),
    );
  }
}
