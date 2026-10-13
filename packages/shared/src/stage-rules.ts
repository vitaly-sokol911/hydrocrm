import { PERMISSIONS, type Permission } from './permissions';

/**
 * Правила перехода между этапами (ЗАК-1…4). Чистая функция без БД — легко тестировать.
 * Возвращает права на переход и список блокирующих причин, понятных пользователю.
 */
export interface StageInfo {
  code: string;
  name: string;
  sort: number;
  kind: 'open' | 'won' | 'lost';
  isProduction: boolean;
}

export interface OrderFacts {
  type: string;
  hasEquipment: boolean;
  photoCount: number;
  approvedItemsCount: number;
  proposedItemsCount: number;
  assigneesCount: number;
  /** Есть ли согласование сметы и совпадает ли его сумма с текущей. */
  hasApproval: boolean;
  approvalMatchesTotal: boolean;
  isAssignee: boolean;
  lostReasonId?: string | null;
}

export interface TransitionInput {
  from: StageInfo;
  to: StageInfo;
  facts: OrderFacts;
  permissions: Set<Permission>;
  comment?: string | null;
  override?: boolean;
}

export interface TransitionResult {
  /** Причины, по которым у пользователя нет права на такой переход — их обойти нельзя. */
  denied: string[];
  /** Проверки готовности (ЗАК-3) — руководитель может обойти с комментарием. */
  blockers: string[];
  overridden: boolean;
}

const REQUIRES_APPROVAL = new Set(['awaiting_parts', 'repair']);
const REQUIRES_MASTER = new Set(['repair', 'assembly', 'on_site']);

export function checkTransition({ from, to, facts, permissions, comment, override }: TransitionInput): TransitionResult {
  const denied: string[] = [];
  const blockers: string[] = [];
  const hasComment = !!comment?.trim();

  if (from.code === to.code) denied.push('Заказ уже на этом этапе');

  // ЗАК-2: мастер переводит только свои заказы и только между производственными этапами.
  const full = permissions.has(PERMISSIONS.ordersChangeStage);
  if (!full) {
    const production = permissions.has(PERMISSIONS.ordersChangeProductionStage);
    const next = to.sort === from.sort + 1;
    const allowed =
      production &&
      facts.isAssignee &&
      to.kind !== 'lost' &&
      ((from.isProduction && (to.isProduction || next)) || (to.isProduction && next));
    if (!allowed) denied.push('Мастер может менять только производственные этапы своих заказов');
  }

  // ЗАК-1: возврат назад — только с комментарием.
  if (to.sort < from.sort && to.kind === 'open' && !hasComment) {
    denied.push('Чтобы вернуть заказ на предыдущий этап, напишите комментарий');
  }

  if (to.kind === 'lost' && !facts.lostReasonId) denied.push('Укажите причину отказа');

  // ЗАК-3: проверки готовности при входе в этап.
  if (to.kind !== 'lost' && to.sort > from.sort) {
    if (to.code === 'accepted') {
      if (!facts.hasEquipment) blockers.push('Укажите оборудование клиента');
      if (facts.photoCount === 0) blockers.push('Загрузите хотя бы одно фото агрегата при приёмке');
    }
    if (to.code === 'estimate' && facts.approvedItemsCount === 0) {
      blockers.push('Добавьте в смету хотя бы одну позицию');
    }
    if (REQUIRES_APPROVAL.has(to.code) && !facts.hasApproval) {
      blockers.push('Смета не согласована с клиентом');
    }
    if (REQUIRES_MASTER.has(to.code) && facts.assigneesCount === 0) {
      blockers.push('Назначьте мастера');
    }
    if (to.code === 'ready' || to.code === 'visit_done' || to.kind === 'won') {
      if (facts.proposedItemsCount > 0) blockers.push('В смете есть предложенные мастером позиции — утвердите или отклоните их');
      if (facts.hasApproval && !facts.approvalMatchesTotal) {
        blockers.push('Смета изменилась после согласования — согласуйте доп. работы с клиентом');
      }
    }
  }

  // ЗАК-4: обход проверок руководителем с обязательным комментарием.
  let overridden = false;
  if (blockers.length && override) {
    if (!permissions.has(PERMISSIONS.ordersOverrideChecks)) denied.push('Пропустить проверки может только руководитель');
    else if (!hasComment) denied.push('Чтобы пропустить проверки, напишите комментарий');
    else overridden = true;
  }

  return { denied, blockers: overridden ? [] : blockers, overridden };
}
