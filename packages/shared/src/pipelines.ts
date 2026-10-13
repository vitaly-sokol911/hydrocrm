import type { OrderType, StageKind } from './enums';

/** Воронки по умолчанию (docs/04-модули/03-заказы.md §1). Создаются seed-скриптом, дальше настраиваются в БД. */
export interface StageDef {
  code: string;
  name: string;
  clientName?: string;
  kind?: StageKind;
  isProduction?: boolean;
  normHours?: number;
  clientNotify?: boolean;
  hiddenFromClient?: boolean;
  color: string;
}

const day = 24;

export const DEFAULT_PIPELINES: Record<OrderType, { name: string; stages: StageDef[] }> = {
  repair_workshop: {
    name: 'Ремонт в цеху',
    stages: [
      { code: 'new', name: 'Новый', clientName: 'Заявка принята', normHours: day, color: '#8c8c8c' },
      { code: 'awaiting_unit', name: 'Ожидаем агрегат', clientName: 'Ожидаем оборудование', normHours: 5 * day, color: '#bfbfbf' },
      { code: 'accepted', name: 'Принят в цех', clientName: 'Принят в ремонт', normHours: day, clientNotify: true, color: '#1677ff' },
      { code: 'diagnostics', name: 'Диагностика', clientName: 'Диагностика', isProduction: true, normHours: 2 * day, color: '#2f54eb' },
      { code: 'estimate', name: 'Смета на согласовании', clientName: 'Смета готова', normHours: 3 * day, clientNotify: true, color: '#faad14' },
      { code: 'awaiting_parts', name: 'Ожидание запчастей', clientName: 'В ремонте', normHours: 7 * day, color: '#fa8c16' },
      { code: 'repair', name: 'Ремонт', clientName: 'В ремонте', isProduction: true, normHours: 5 * day, clientNotify: true, color: '#722ed1' },
      { code: 'testing', name: 'Испытания на стенде', clientName: 'Испытания', isProduction: true, normHours: day, color: '#13c2c2' },
      { code: 'ready', name: 'Готов к выдаче', clientName: 'Готов к выдаче', normHours: 3 * day, clientNotify: true, color: '#52c41a' },
      { code: 'done', name: 'Выдан и оплачен', clientName: 'Выдан', kind: 'won', clientNotify: true, color: '#389e0d' },
      { code: 'cancelled', name: 'Отказ', clientName: 'Отменён', kind: 'lost', color: '#ff4d4f' },
    ],
  },
  repair_field: {
    name: 'Выездной ремонт',
    stages: [
      { code: 'new', name: 'Новый', clientName: 'Заявка принята', normHours: day, color: '#8c8c8c' },
      { code: 'visit_planned', name: 'Выезд запланирован', clientName: 'Выезд назначен', normHours: 3 * day, clientNotify: true, color: '#1677ff' },
      { code: 'on_site', name: 'Работы на объекте', clientName: 'Мастер на объекте', isProduction: true, normHours: day, color: '#722ed1' },
      { code: 'estimate', name: 'Согласование доп. работ', clientName: 'Согласование работ', normHours: 2 * day, clientNotify: true, color: '#faad14' },
      { code: 'visit_done', name: 'Работы выполнены', clientName: 'Работы выполнены', isProduction: true, normHours: day, clientNotify: true, color: '#13c2c2' },
      { code: 'awaiting_payment', name: 'Ожидание оплаты', clientName: 'Ожидаем оплату', normHours: 5 * day, color: '#fa8c16' },
      { code: 'done', name: 'Закрыт', clientName: 'Выполнен', kind: 'won', color: '#389e0d' },
      { code: 'moved_to_workshop', name: 'Переведён в цех', clientName: 'Ремонт в цеху', kind: 'won', clientNotify: true, color: '#2f54eb' },
      { code: 'cancelled', name: 'Отказ', clientName: 'Отменён', kind: 'lost', color: '#ff4d4f' },
    ],
  },
  assembly_custom: {
    name: 'Сборка под заказ',
    stages: [
      { code: 'new', name: 'Получено ТЗ', clientName: 'Запрос получен', normHours: day, color: '#8c8c8c' },
      { code: 'calculation', name: 'Расчёт и КП', clientName: 'Готовим предложение', normHours: 3 * day, color: '#1677ff' },
      { code: 'quote_sent', name: 'КП отправлено', clientName: 'Предложение отправлено', normHours: 5 * day, clientNotify: true, color: '#faad14' },
      { code: 'contract', name: 'Договор', clientName: 'Договор', normHours: 5 * day, color: '#fa8c16' },
      { code: 'awaiting_prepayment', name: 'Ожидание предоплаты', clientName: 'Ожидаем предоплату', normHours: 5 * day, color: '#fa541c' },
      { code: 'procurement', name: 'Закупка комплектующих', clientName: 'Изготовление', normHours: 10 * day, clientNotify: true, color: '#eb2f96' },
      { code: 'assembly', name: 'Сборка', clientName: 'Изготовление', isProduction: true, normHours: 10 * day, color: '#722ed1' },
      { code: 'testing', name: 'Испытания', clientName: 'Испытания', isProduction: true, normHours: 2 * day, color: '#13c2c2' },
      { code: 'ready', name: 'Готов к отгрузке', clientName: 'Готов к отгрузке', normHours: 3 * day, clientNotify: true, color: '#52c41a' },
      { code: 'done', name: 'Отгружен и оплачен', clientName: 'Отгружен', kind: 'won', clientNotify: true, color: '#389e0d' },
      { code: 'cancelled', name: 'Отказ', clientName: 'Отменён', kind: 'lost', color: '#ff4d4f' },
    ],
  },
  assembly_standard: {
    name: 'Сборка типовой',
    stages: [
      { code: 'new', name: 'Новый', clientName: 'Заказ принят', normHours: day, color: '#8c8c8c' },
      { code: 'invoice', name: 'Счёт выставлен', clientName: 'Счёт выставлен', normHours: 2 * day, color: '#1677ff' },
      { code: 'awaiting_payment', name: 'Ожидание оплаты', clientName: 'Ожидаем оплату', normHours: 5 * day, color: '#fa8c16' },
      { code: 'assembly', name: 'Сборка', clientName: 'Изготовление', isProduction: true, normHours: 5 * day, clientNotify: true, color: '#722ed1' },
      { code: 'testing', name: 'Испытания', clientName: 'Испытания', isProduction: true, normHours: day, color: '#13c2c2' },
      { code: 'ready', name: 'Готов к отгрузке', clientName: 'Готов к отгрузке', normHours: 3 * day, clientNotify: true, color: '#52c41a' },
      { code: 'done', name: 'Отгружен и оплачен', clientName: 'Отгружен', kind: 'won', clientNotify: true, color: '#389e0d' },
      { code: 'cancelled', name: 'Отказ', clientName: 'Отменён', kind: 'lost', color: '#ff4d4f' },
    ],
  },
};
