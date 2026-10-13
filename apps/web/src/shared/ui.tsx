import { formatMoney, formatPhone, ORDER_TYPE_LABELS, PRIORITY_LABELS, type OrderType, type Priority } from '@hydrocrm/shared';
import { Avatar, Empty, Space, Tag, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import { avatarColor, initials } from './format';
import { useUsers } from './hooks';

export function Money({ kop, strong }: { kop: number | null | undefined; strong?: boolean }) {
  if (kop === null || kop === undefined) return <Typography.Text type="secondary">—</Typography.Text>;
  const text = formatMoney(kop);
  return strong ? <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{text}</Typography.Text> : <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;
}

export function Phone({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return (
    <a href={`tel:${value}`} style={{ whiteSpace: 'nowrap' }}>
      {formatPhone(value)}
    </a>
  );
}

export function StageTag({ stage }: { stage: { name: string; color: string | null } }) {
  return (
    <Tag color={stage.color ?? undefined} style={{ marginInlineEnd: 0, whiteSpace: 'nowrap' }}>
      {stage.name}
    </Tag>
  );
}

export function OrderTypeTag({ type }: { type: OrderType }) {
  const colors: Record<OrderType, string> = { repair_workshop: 'blue', repair_field: 'cyan', assembly_custom: 'purple', assembly_standard: 'geekblue' };
  return (
    <Tag color={colors[type]} bordered={false} style={{ marginInlineEnd: 0 }}>
      {ORDER_TYPE_LABELS[type]}
    </Tag>
  );
}

export function PriorityTag({ priority }: { priority: Priority }) {
  if (priority === 'normal' || priority === 'low') return null;
  return (
    <Tag color={priority === 'urgent' ? 'red' : 'orange'} style={{ marginInlineEnd: 0 }}>
      {PRIORITY_LABELS[priority]}
    </Tag>
  );
}

export function UserAvatar({ userId, size = 24, withName }: { userId: string | null | undefined; size?: number; withName?: boolean }) {
  const { byId } = useUsers();
  if (!userId) return withName ? <Typography.Text type="secondary">не назначен</Typography.Text> : null;
  const name = byId.get(userId)?.fullName ?? '…';
  const avatar = (
    <Avatar size={size} style={{ background: avatarColor(userId), fontSize: size * 0.42, flex: 'none' }}>
      {initials(name)}
    </Avatar>
  );
  if (!withName) return <Tooltip title={name}>{avatar}</Tooltip>;
  return (
    <Space size={6}>
      {avatar}
      <span>{name}</span>
    </Space>
  );
}

export function Avatars({ ids, size = 22, empty = '—' }: { ids: string[]; size?: number; empty?: ReactNode }) {
  if (!ids.length) return empty ? <Typography.Text type="secondary">{empty}</Typography.Text> : null;
  return (
    <Avatar.Group max={{ count: 3 }} size={size}>
      {ids.map((id) => (
        <UserAvatar key={id} userId={id} size={size} />
      ))}
    </Avatar.Group>
  );
}

export function PageHeader({ title, extra, subtitle }: { title: ReactNode; extra?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="page-header">
      <div style={{ minWidth: 0 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
      </div>
      {extra && <div className="page-header-extra">{extra}</div>}
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text}>
      {action}
    </Empty>
  );
}


export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-value">{children ?? <Typography.Text type="secondary">—</Typography.Text>}</div>
    </div>
  );
}
