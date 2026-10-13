import type { ErrorCode } from '@hydrocrm/shared';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STAGE_TRANSITION_BLOCKED: 422,
  DISCOUNT_APPROVAL_REQUIRED: 422,
  ACCOUNT_LOCKED: 423,
  DEMO_RESTRICTED: 403,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** Ошибка бизнес-логики с кодом из shared/errors. Текст показывается пользователю как есть. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { field?: string; reason: string }[],
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Запись') => new AppError('NOT_FOUND', `${what} не найдена`);
export const forbidden = (message = 'Недостаточно прав для этого действия') => new AppError('FORBIDDEN', message);
