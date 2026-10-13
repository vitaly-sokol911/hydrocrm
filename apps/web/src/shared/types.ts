import type {
  ApprovalMethod,
  ClientType,
  LeadChannel,
  LeadStatus,
  OrderItemKind,
  OrderItemStatus,
  OrderType,
  Permission,
  Priority,
  RoleCode,
  TaskStatus,
  VisitResult,
  VisitStatus,
} from '@hydrocrm/shared';

// Ответы API в том виде, в котором их отдаёт сервер (даты — ISO-строки, деньги — копейки).

export interface Me {
  user: {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    position: string | null;
    mustChangePassword: boolean;
    roles: RoleCode[];
    permissions: Permission[];
  };
  company: { id: string; name: string; timezone: string; settings: Record<string, unknown> };
  demoMode: boolean;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  position: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: RoleCode[];
}

export interface Stage {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  sort: number;
  kind: 'open' | 'won' | 'lost';
  isProduction: boolean;
  normHours: number | null;
  clientNotify: boolean;
  color: string | null;
}

export interface Pipeline {
  id: string;
  orderType: OrderType;
  name: string;
  stages: Stage[];
}

export interface Dictionaries {
  leadSources: { id: string; name: string; channel: LeadChannel | null }[];
  rejectReasons: { id: string; name: string }[];
  pipelines: Pipeline[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Equipment {
  id: string;
  clientId: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  year: number | null;
  pressureBar: string | null;
  flowLpm: string | null;
  tankVolumeL: string | null;
  motorPowerKw: string | null;
  voltage: string | null;
  location: string | null;
  note: string | null;
}

export interface Contact {
  id: string;
  fullName: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  note: string | null;
}

export interface ClientListItem {
  id: string;
  type: ClientType;
  name: string;
  phone: string | null;
  email: string | null;
  inn?: string | null;
  managerId: string | null;
  tags: string[];
  ordersCount: number;
  openOrders: number;
  ordersSumKop: number | null;
  lastOrderAt: string | null;
  equipmentCount: number;
  archivedAt: string | null;
}

export interface ClientDetail extends ClientListItem {
  legalName?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  address: string | null;
  paymentTermsDays?: number;
  pdConsentAt: string | null;
  note: string | null;
  sourceId: string | null;
  source: { id: string; name: string } | null;
  version: number;
  createdAt: string;
  contacts: Contact[];
  equipment: Equipment[];
  orders: {
    id: string;
    number: string;
    type: OrderType;
    title: string;
    totalKop: number | null;
    createdAt: string;
    finishedAt: string | null;
    equipmentId: string | null;
    stage: { name: string; kind: string; color: string | null };
  }[];
  leads: { id: string; number: string; status: LeadStatus; channel: LeadChannel; description: string; createdAt: string }[];
}

export interface Lead {
  id: string;
  number: string;
  status: LeadStatus;
  channel: LeadChannel;
  sourceId: string | null;
  source: { id: string; name: string } | null;
  clientId: string | null;
  client: { id: string; name: string; type?: ClientType; phone?: string | null } | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  description: string;
  assigneeId: string | null;
  responseDueAt: string;
  firstResponseAt: string | null;
  orderId: string | null;
  order: { id: string; number: string } | null;
  rejectReasonId: string | null;
  rejectReason?: { id: string; name: string } | null;
  rejectComment: string | null;
  isStatusQuestion: boolean;
  createdAt: string;
  overdue?: boolean;
}

export interface OrderListItem {
  id: string;
  number: string;
  type: OrderType;
  title: string;
  priority: Priority;
  stage: { id: string; code: string; name: string; kind: string; color: string | null; sort: number };
  stageChangedAt: string;
  client: { id: string; name: string; type: ClientType };
  equipment: { id: string; name: string; model: string | null; serialNumber: string | null } | null;
  managerId: string | null;
  assignees: { userId: string; isLead: boolean }[];
  plannedFinishAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  isWarrantyCase: boolean;
  totalKop: number | null;
  overdue: boolean;
  stuck: boolean;
  unreadComments: number;
  commentsCount: number;
}

export interface OrderItem {
  id: string;
  kind: OrderItemKind;
  name: string;
  quantity: number;
  unit: string;
  priceKop: number | null;
  costKop: number | null;
  discountPercent: number | null;
  sumKop: number | null;
  status: OrderItemStatus;
  isExtra: boolean;
  proposedById: string | null;
}

export interface FileDto {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string;
}

export interface Visit {
  id: string;
  orderId: string;
  status: VisitStatus;
  plannedStartAt: string;
  plannedEndAt: string;
  address: string;
  contactName: string | null;
  contactPhone: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  finishedAt: string | null;
  travelKm: string | null;
  result: VisitResult | null;
  report: string | null;
  assignees: { userId: string }[];
  files?: FileDto[];
  order?: {
    id: string;
    number: string;
    title: string;
    type: OrderType;
    complaint: string | null;
    managerId: string | null;
    client: { id: string; name: string; phone: string | null };
    equipment: { id: string; name: string; model: string | null; serialNumber: string | null } | null;
    stage: { code: string; name: string; color: string | null };
  };
}

export interface OrderDetail {
  id: string;
  number: string;
  type: OrderType;
  title: string;
  complaint: string | null;
  priority: Priority;
  stage: Stage;
  stageChangedAt: string;
  client: { id: string; name: string; type: ClientType; phone: string | null; email: string | null; address: string | null };
  contact: Contact | null;
  equipment: Equipment | null;
  managerId: string | null;
  assignees: { userId: string; isLead: boolean }[];
  plannedFinishAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  isWarrantyCase: boolean;
  discountPercent: number;
  version: number;
  statusToken: string;
  items: OrderItem[];
  approvals: { id: string; version: number; totalKop: number | null; approvedAt: string; method: ApprovalMethod; approvedByName: string }[];
  stageHistory: { id: string; fromStageId: string | null; toStageId: string; changedById: string | null; changedAt: string; comment: string | null; durationHours: number | null; overridden: boolean }[];
  visits: Visit[];
  files: FileDto[];
  lead: { id: string; number: string; channel: LeadChannel } | null;
  parentOrder: { id: string; number: string; type: OrderType } | null;
  childOrders: { id: string; number: string; type: OrderType }[];
  totals: {
    worksKop: number;
    partsKop: number;
    servicesKop: number;
    subtotalKop: number;
    orderDiscountKop: number;
    totalKop: number;
    costKop: number | null;
    marginKop: number | null;
    marginPercent: number | null;
  } | null;
  estimateApproved: boolean;
  photoCount: number;
  openTasks: number;
  stages: Stage[];
  visibility: { prices: boolean; margin: boolean };
  settings: { discountLimitPercent: number };
}

export interface Comment {
  id: string;
  orderId: string;
  authorId: string | null;
  kind: 'comment' | 'system';
  text: string;
  mentions: string[];
  payload: Record<string, unknown> | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  files: FileDto[];
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string;
  authorId: string | null;
  dueAt: string | null;
  status: TaskStatus;
  completedAt: string | null;
  resultComment: string | null;
  priority: Priority;
  orderId: string | null;
  clientId: string | null;
  isAuto: boolean;
  createdAt: string;
  order: { id: string; number: string; title: string } | null;
  client: { id: string; name: string } | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ChatChannel {
  id: string;
  type: 'general' | 'group' | 'direct';
  name: string | null;
  memberIds: string[];
  lastMessage: ChatMessage | null;
  unread: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}
