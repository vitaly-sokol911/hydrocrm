import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, RoleCode } from '@hydrocrm/shared';

/** Текущий пользователь запроса. Хранится в AsyncLocalStorage, чтобы Prisma-расширение знало компанию. */
export interface AuthUser {
  id: string;
  companyId: string;
  fullName: string;
  email: string;
  roles: RoleCode[];
  permissions: Set<Permission>;
}

interface Store {
  user?: AuthUser;
  companyId?: string;
  ip?: string;
}

const als = new AsyncLocalStorage<Store>();

export const requestContext = {
  run<T>(store: Store, fn: () => T): T {
    return als.run(store, fn);
  },
  get(): Store | undefined {
    return als.getStore();
  },
  companyId(): string | undefined {
    const s = als.getStore();
    return s?.user?.companyId ?? s?.companyId;
  },
  user(): AuthUser | undefined {
    return als.getStore()?.user;
  },
};

/** companyId текущего запроса для create-запросов (типы Prisma требуют поле, tenant-расширение его проверит). */
export function currentCompanyId(): string {
  const id = requestContext.companyId();
  if (!id) throw new Error('Операция выполняется вне контекста компании');
  return id;
}
