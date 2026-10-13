// Перечисления и подписи для интерфейса. Значения совпадают с enum в schema.prisma.

const labels = <T extends string>(map: Record<T, string>) => map;

export const ROLE_CODES = ['admin', 'director', 'manager', 'master', 'accountant'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
export const ROLE_LABELS = labels<RoleCode>({
  admin: 'Администратор системы',
  director: 'Руководитель',
  manager: 'Менеджер',
  master: 'Мастер',
  accountant: 'Бухгалтер',
});

export const CLIENT_TYPES = ['person', 'ip', 'company', 'dealer'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];
export const CLIENT_TYPE_LABELS = labels<ClientType>({
  person: 'Физлицо',
  ip: 'ИП',
  company: 'Юрлицо',
  dealer: 'Дилер',
});

export const LEAD_STATUSES = ['new', 'in_progress', 'converted', 'rejected', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS = labels<LeadStatus>({
  new: 'Новая',
  in_progress: 'В работе',
  converted: 'Создан заказ',
  rejected: 'Отказ',
  spam: 'Спам',
});

export const LEAD_CHANNELS = ['phone', 'email', 'site', 'vk', 'avito', 'telegram', 'manual', 'other'] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];
export const LEAD_CHANNEL_LABELS = labels<LeadChannel>({
  phone: 'Телефон',
  email: 'Почта',
  site: 'Сайт',
  vk: 'ВКонтакте',
  avito: 'Авито',
  telegram: 'Telegram',
  manual: 'Вручную',
  other: 'Другое',
});

export const ORDER_TYPES = ['repair_workshop', 'repair_field', 'assembly_custom', 'assembly_standard'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_TYPE_LABELS = labels<OrderType>({
  repair_workshop: 'Ремонт в цеху',
  repair_field: 'Выездной ремонт',
  assembly_custom: 'Сборка под заказ',
  assembly_standard: 'Сборка типовой',
});

export const STAGE_KINDS = ['open', 'won', 'lost'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS = labels<Priority>({
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочно',
});

export const ORDER_ITEM_KINDS = ['work', 'part', 'service'] as const;
export type OrderItemKind = (typeof ORDER_ITEM_KINDS)[number];
export const ORDER_ITEM_KIND_LABELS = labels<OrderItemKind>({
  work: 'Работа',
  part: 'Запчасть',
  service: 'Услуга',
});

export const ORDER_ITEM_STATUSES = ['proposed', 'approved', 'declined'] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

export const APPROVAL_METHODS = ['phone', 'email', 'telegram', 'signed_doc', 'status_page'] as const;
export type ApprovalMethod = (typeof APPROVAL_METHODS)[number];
export const APPROVAL_METHOD_LABELS = labels<ApprovalMethod>({
  phone: 'По телефону',
  email: 'По почте',
  telegram: 'В Telegram',
  signed_doc: 'Подписанный документ',
  status_page: 'На странице статуса',
});

export const VISIT_STATUSES = ['planned', 'on_the_way', 'on_site', 'done', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const VISIT_STATUS_LABELS = labels<VisitStatus>({
  planned: 'Запланирован',
  on_the_way: 'В пути',
  on_site: 'На объекте',
  done: 'Завершён',
  cancelled: 'Отменён',
});

export const VISIT_RESULTS = ['fixed', 'need_workshop', 'need_revisit'] as const;
export type VisitResult = (typeof VISIT_RESULTS)[number];
export const VISIT_RESULT_LABELS = labels<VisitResult>({
  fixed: 'Отремонтировано на месте',
  need_workshop: 'Забираем в цех',
  need_revisit: 'Нужен повторный выезд',
});

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const COMMENT_KINDS = ['comment', 'system'] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

export const NOTIFICATION_TYPES = [
  'lead_new',
  'lead_overdue',
  'order_assigned',
  'stage_changed',
  'mention',
  'comment_new',
  'task_assigned',
  'task_done',
  'task_overdue',
  'visit_assigned',
  'order_stuck',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
