import { Prisma } from '@prisma/client';
import { requestContext } from '../common/request-context';

/**
 * Изоляция данных по компаниям (АРХ-1). Для моделей с companyId расширение само:
 *  - добавляет companyId текущего пользователя в where всех чтений, изменений и удалений;
 *  - проставляет companyId в create/createMany/upsert.
 * Вне контекста запроса (seed-скрипты, задачи по расписанию без компании) фильтр не применяется.
 * Создавать записи таких моделей нужно через скалярные поля (clientId: …), а не через connect.
 */
export const TENANT_MODELS = new Set<string>([
  'User',
  'Role',
  'AuditLog',
  'Counter',
  'LeadSource',
  'RejectReason',
  'Client',
  'Lead',
  'Pipeline',
  'Order',
  'Visit',
  'File',
  'Task',
  'Notification',
  'ChatChannel',
]);

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

type AnyArgs = { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const companyId = requestContext.companyId();
        if (!companyId || !TENANT_MODELS.has(model)) return query(args);
        const a = (args ?? {}) as AnyArgs;
        if (WHERE_OPS.has(operation)) {
          a.where = { ...(a.where ?? {}), companyId };
        } else if (operation === 'create') {
          // companyId всегда из контекста: создать запись в чужой компании нельзя.
          a.data = { ...(a.data as object), companyId };
        } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
          const data = a.data as object | object[];
          a.data = Array.isArray(data) ? data.map((d) => ({ ...d, companyId })) : { ...data, companyId };
        } else if (operation === 'upsert') {
          a.where = { ...(a.where ?? {}), companyId };
          a.create = { ...(a.create ?? {}), companyId };
        }
        return query(a as typeof args);
      },
    },
  },
});
