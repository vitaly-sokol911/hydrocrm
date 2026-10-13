import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/** Проверка тела запроса Zod-схемой из @hydrocrm/shared. Ошибка превращается в VALIDATION_ERROR фильтром. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value ?? {});
  }
}
