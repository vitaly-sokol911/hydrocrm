import { z } from 'zod';
import {
  APPROVAL_METHODS,
  CLIENT_TYPES,
  LEAD_CHANNELS,
  ORDER_ITEM_KINDS,
  ORDER_ITEM_STATUSES,
  ORDER_TYPES,
  PRIORITIES,
  ROLE_CODES,
  VISIT_RESULTS,
  VISIT_STATUSES,
} from './enums';
import { isValidInn } from './format';

// Схемы входных данных API. Одни и те же схемы проверяют формы в интерфейсе и запросы на сервере (API-4).

const str = (max = 500) => z.string().trim().max(max);
const optStr = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const uuid = z.string().uuid();
const optUuid = uuid.optional().nullable();
const isoDate = z.string().datetime({ offset: true });
const optIsoDate = isoDate.optional().nullable();
const money = z.number().int().min(0).max(100_000_000_000);
const percent = z.number().min(0).max(100);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Введите корректный email'),
  password: z.string().min(1, 'Введите пароль').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const demoLoginSchema = z.object({ role: z.enum(ROLE_CODES) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Минимум 8 символов').max(200),
});

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: str(200).min(2),
  phone: optStr(30),
  position: optStr(100),
  password: z.string().min(8).max(200),
  roles: z.array(z.enum(ROLE_CODES)).min(1, 'Выберите хотя бы одну роль'),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = userCreateSchema.omit({ password: true, email: true }).partial().extend({
  isActive: z.boolean().optional(),
});

// ---------- Клиенты ----------
export const clientSchema = z
  .object({
    type: z.enum(CLIENT_TYPES),
    name: str(300).min(1, 'Укажите название или ФИО'),
    legalName: optStr(300),
    inn: optStr(12),
    kpp: optStr(9),
    ogrn: optStr(15),
    legalAddress: optStr(500),
    phone: optStr(30),
    email: z
      .string()
      .trim()
      .email('Некорректный email')
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    address: optStr(500),
    sourceId: optUuid,
    managerId: optUuid,
    paymentTermsDays: z.number().int().min(0).max(365).default(0),
    pdConsent: z.boolean().optional(),
    tags: z.array(str(50)).max(20).default([]),
    note: optStr(5000),
  })
  .superRefine((v, ctx) => {
    if (!v.phone && !v.email) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Нужен телефон или email' });
    if (v.inn && !isValidInn(v.inn)) ctx.addIssue({ code: 'custom', path: ['inn'], message: 'ИНН не прошёл проверку' });
  });
export type ClientInput = z.infer<typeof clientSchema>;

export const contactSchema = z.object({
  fullName: str(200).min(1),
  position: optStr(100),
  phone: optStr(30),
  email: optStr(200),
  isPrimary: z.boolean().default(false),
  note: optStr(1000),
});

const optNum = z.number().min(0).max(1_000_000).optional().nullable();
export const equipmentSchema = z.object({
  name: str(200).min(1, 'Укажите название'),
  manufacturer: optStr(100),
  model: optStr(100),
  serialNumber: optStr(100),
  year: z.number().int().min(1950).max(2100).optional().nullable(),
  pressureBar: optNum,
  flowLpm: optNum,
  tankVolumeL: optNum,
  motorPowerKw: optNum,
  voltage: optStr(50),
  location: optStr(200),
  note: optStr(2000),
});
export type EquipmentInput = z.infer<typeof equipmentSchema>;

// ---------- Заявки ----------
export const leadCreateSchema = z
  .object({
    channel: z.enum(LEAD_CHANNELS).default('manual'),
    sourceId: optUuid,
    clientId: optUuid,
    contactName: optStr(200),
    phone: optStr(30),
    email: optStr(200),
    description: str(5000).min(1, 'Опишите запрос'),
    assigneeId: optUuid,
    isStatusQuestion: z.boolean().default(false),
  })
  .refine((v) => v.clientId || v.phone || v.email, { message: 'Нужен клиент, телефон или email', path: ['phone'] });
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z.object({
  assigneeId: optUuid,
  sourceId: optUuid,
  description: str(5000).optional(),
  contactName: optStr(200),
  phone: optStr(30),
  email: optStr(200),
  clientId: optUuid,
});

export const leadRejectSchema = z
  .object({
    reasonId: optUuid,
    comment: optStr(2000),
    spam: z.boolean().default(false),
  })
  .refine((v) => v.spam || v.reasonId, { message: 'Выберите причину отказа', path: ['reasonId'] });

export const leadConvertSchema = z.object({
  type: z.enum(ORDER_TYPES),
  title: str(300).optional(),
  clientId: optUuid,
  /** Если клиента нет — создаётся новый с этим типом и названием. */
  newClient: z.object({ type: z.enum(CLIENT_TYPES), name: str(300).min(1) }).optional(),
});

// ---------- Заказы ----------
export const orderCreateSchema = z.object({
  type: z.enum(ORDER_TYPES),
  clientId: uuid,
  contactId: optUuid,
  equipmentId: optUuid,
  newEquipment: equipmentSchema.optional(),
  title: str(300).min(1, 'Кратко опишите заказ'),
  complaint: optStr(5000),
  managerId: optUuid,
  masterIds: z.array(uuid).default([]),
  priority: z.enum(PRIORITIES).default('normal'),
  plannedFinishAt: optIsoDate,
  isWarrantyCase: z.boolean().default(false),
  parentOrderId: optUuid,
  leadId: optUuid,
});
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderUpdateSchema = z.object({
  version: z.number().int(),
  title: str(300).min(1).optional(),
  complaint: optStr(5000),
  contactId: optUuid,
  equipmentId: optUuid,
  managerId: optUuid,
  priority: z.enum(PRIORITIES).optional(),
  plannedFinishAt: optIsoDate,
  discountPercent: percent.optional(),
});

export const orderAssigneesSchema = z.object({
  masterIds: z.array(uuid),
  leadMasterId: optUuid,
});

export const stageChangeSchema = z.object({
  stageCode: z.string().min(1),
  comment: optStr(2000),
  /** Обход проверок руководителем (ЗАК-4), требует комментарий. */
  override: z.boolean().default(false),
  lostReasonId: optUuid,
});
export type StageChangeInput = z.infer<typeof stageChangeSchema>;

export const orderItemSchema = z.object({
  kind: z.enum(ORDER_ITEM_KINDS),
  name: str(300).min(1, 'Укажите наименование'),
  quantity: z.number().positive().max(100000),
  unit: str(20).default('шт'),
  priceKop: money.default(0),
  costKop: money.default(0),
  discountPercent: percent.default(0),
  status: z.enum(ORDER_ITEM_STATUSES).optional(),
});
export type OrderItemInput = z.infer<typeof orderItemSchema>;

export const orderItemUpdateSchema = orderItemSchema.partial();

export const approveEstimateSchema = z.object({
  method: z.enum(APPROVAL_METHODS),
  approvedByName: str(200).min(1, 'Кто согласовал'),
});

// ---------- Лента, задачи, выезды ----------
export const commentSchema = z.object({
  text: str(10000).default(''),
  fileIds: z.array(uuid).max(10).default([]),
  markResponded: z.boolean().optional(),
});

export const taskCreateSchema = z.object({
  title: str(300).min(1, 'Что нужно сделать'),
  description: optStr(5000),
  assigneeId: uuid,
  dueAt: optIsoDate,
  priority: z.enum(PRIORITIES).default('normal'),
  orderId: optUuid,
  clientId: optUuid,
  leadId: optUuid,
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.enum(['open', 'done', 'cancelled']).optional(),
  resultComment: optStr(2000),
});

export const visitCreateSchema = z.object({
  orderId: uuid,
  plannedStartAt: isoDate,
  plannedEndAt: isoDate,
  address: str(500).min(1, 'Укажите адрес'),
  contactName: optStr(200),
  contactPhone: optStr(30),
  masterIds: z.array(uuid).min(1, 'Назначьте мастера'),
});
export type VisitCreateInput = z.infer<typeof visitCreateSchema>;

export const visitUpdateSchema = visitCreateSchema.omit({ orderId: true }).partial();

export const visitStatusSchema = z.object({
  status: z.enum(VISIT_STATUSES),
  result: z.enum(VISIT_RESULTS).optional(),
  report: optStr(10000),
  travelKm: z.number().min(0).max(5000).optional().nullable(),
  /** Время с устройства мастера: при офлайн-работе событие отправляется позже (ВЫЕ-40). */
  at: optIsoDate,
});

export const chatMessageSchema = z.object({ text: str(10000).min(1) });
export const chatChannelSchema = z.object({
  name: str(100).min(1),
  memberIds: z.array(uuid).min(1),
});
export const directChannelSchema = z.object({ userId: uuid });

