// Коды ошибок API (docs/06-api.md, раздел 4).
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  STAGE_TRANSITION_BLOCKED: 'STAGE_TRANSITION_BLOCKED',
  DISCOUNT_APPROVAL_REQUIRED: 'DISCOUNT_APPROVAL_REQUIRED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  DEMO_RESTRICTED: 'DEMO_RESTRICTED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: { field?: string; reason: string }[];
    requestId?: string;
  };
}
