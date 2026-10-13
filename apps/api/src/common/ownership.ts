import { AppError } from './app-error';
import type { Db, Tx } from '../prisma/prisma.service';

/**
 * Проверки «запись принадлежит этой компании» для идентификаторов из запроса.
 * Без них можно было бы, например, указать контакт чужой компании в своём заказе
 * и увидеть его данные в карточке. Корневые модели фильтруются tenant-расширением,
 * дочерние (контакты, оборудование) — через родителя.
 */
type Client = Db | Tx;

const invalid = (field: string, message: string) => new AppError('VALIDATION_ERROR', message, [{ field, reason: 'invalid' }]);

/** Все пользователи существуют в компании текущего запроса и активны. */
export async function assertCompanyUsers(db: Client, ids: (string | null | undefined)[], field = 'userId') {
  const list = [...new Set(ids.filter((id): id is string => !!id))];
  if (!list.length) return;
  const found = await db.user.count({ where: { id: { in: list }, isActive: true } });
  if (found !== list.length) throw invalid(field, 'Сотрудник не найден');
}

export async function assertClient(db: Client, clientId: string | null | undefined, field = 'clientId') {
  if (!clientId) return;
  if (!(await db.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true } }))) throw invalid(field, 'Клиент не найден');
}

/** Контакт и оборудование должны принадлежать именно этому клиенту. */
export async function assertClientChildren(db: Client, clientId: string, ids: { contactId?: string | null; equipmentId?: string | null }) {
  if (ids.contactId && !(await db.contact.findFirst({ where: { id: ids.contactId, clientId }, select: { id: true } }))) {
    throw invalid('contactId', 'Контакт принадлежит другому клиенту');
  }
  if (ids.equipmentId && !(await db.equipment.findFirst({ where: { id: ids.equipmentId, clientId }, select: { id: true } }))) {
    throw invalid('equipmentId', 'Оборудование принадлежит другому клиенту');
  }
}

export async function assertOrder(db: Client, orderId: string | null | undefined, field = 'orderId') {
  if (!orderId) return;
  if (!(await db.order.findFirst({ where: { id: orderId }, select: { id: true } }))) throw invalid(field, 'Заказ не найден');
}

export async function assertLead(db: Client, leadId: string | null | undefined, field = 'leadId') {
  if (!leadId) return;
  if (!(await db.lead.findFirst({ where: { id: leadId }, select: { id: true } }))) throw invalid(field, 'Заявка не найдена');
}

export async function assertVisit(db: Client, visitId: string | null | undefined, field = 'visitId') {
  if (!visitId) return;
  if (!(await db.visit.findFirst({ where: { id: visitId }, select: { id: true } }))) throw invalid(field, 'Выезд не найден');
}

export async function assertLeadSource(db: Client, sourceId: string | null | undefined) {
  if (!sourceId) return;
  if (!(await db.leadSource.findFirst({ where: { id: sourceId }, select: { id: true } }))) throw invalid('sourceId', 'Источник не найден');
}
