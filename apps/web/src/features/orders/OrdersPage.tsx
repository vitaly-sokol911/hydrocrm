import { AppstoreOutlined, ClockCircleOutlined, FireOutlined, MessageOutlined, PlusOutlined, SafetyCertificateOutlined, TableOutlined } from '@ant-design/icons';
import { ORDER_TYPE_LABELS, ORDER_TYPES, PERMISSIONS, type OrderType } from '@hydrocrm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, Checkbox, Input, Segmented, Select, Space, Table, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { dayjs, fmtDate, fmtHours } from '../../shared/format';
import { useDictionaries } from '../../shared/hooks';
import { UserSelect } from '../../shared/selects';
import type { OrderListItem, Paged, Stage } from '../../shared/types';
import { Avatars, Money, OrderTypeTag, PageHeader, PriorityTag, StageTag, UserAvatar } from '../../shared/ui';
import { useCreate } from '../create/CreateProvider';
import { useStageChange } from './stage';

function KanbanCard({ o, onDragStart, dragging }: { o: OrderListItem; onDragStart: () => void; dragging: boolean }) {
  const navigate = useNavigate();
  const hours = (Date.now() - new Date(o.stageChangedAt).getTime()) / 3_600_000;
  return (
    <div
      className={`kanban-card ${dragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', o.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onClick={() => navigate(`/orders/${o.id}`)}
    >
      <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
        <span className="num">{o.number}</span>
        <Space size={4}>
          {o.isWarrantyCase && (
            <Tooltip title="Гарантийный">
              <SafetyCertificateOutlined style={{ color: '#13a8a8' }} />
            </Tooltip>
          )}
          <PriorityTag priority={o.priority} />
        </Space>
      </Space>
      <div className="title">{o.title}</div>
      <div className="meta">{o.client.name}</div>
      {o.equipment && <div className="meta">{o.equipment.model ?? o.equipment.name}</div>}
      <div className="foot">
        <Space size={8} className="meta">
          {o.stuck ? (
            <Tooltip title="Дольше нормы на этапе">
              <span style={{ color: '#d9363e' }}>
                <FireOutlined /> {fmtHours(hours)}
              </span>
            </Tooltip>
          ) : (
            <span>{fmtHours(hours)}</span>
          )}
          {o.overdue && (
            <Tooltip title={`Срок был ${fmtDate(o.plannedFinishAt)}`}>
              <span style={{ color: '#e8890c' }}>
                <ClockCircleOutlined /> срок
              </span>
            </Tooltip>
          )}
          {o.unreadComments > 0 && (
            <Badge count={o.unreadComments} size="small" color="#1f5fbf">
              <MessageOutlined />
            </Badge>
          )}
        </Space>
        <Space size={6}>
          {o.totalKop !== null && o.totalKop > 0 && (
            <span className="meta">
              <Money kop={o.totalKop} />
            </span>
          )}
          <Avatars ids={o.assignees.map((a) => a.userId)} size={20} empty={null} />
        </Space>
      </div>
    </div>
  );
}

function Kanban({ type, filters }: { type: OrderType; filters: Record<string, unknown> }) {
  const dicts = useDictionaries();
  const stages = (dicts.pipeline(type)?.stages ?? []).filter((s) => s.kind === 'open');
  const finalStages = (dicts.pipeline(type)?.stages ?? []).filter((s) => s.kind !== 'open');
  const query = { view: 'kanban', type, ...filters };
  const list = useQuery({ queryKey: ['orders', query], queryFn: () => api.get<Paged<OrderListItem>>('/orders', query), placeholderData: keepPreviousData });
  const { change, modal } = useStageChange();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byStage = useMemo(() => {
    const m = new Map<string, OrderListItem[]>();
    for (const o of list.data?.items ?? []) m.set(o.stage.code, [...(m.get(o.stage.code) ?? []), o]);
    return m;
  }, [list.data]);

  const drop = (stage: Stage) => {
    const o = list.data?.items.find((x) => x.id === dragId);
    setDragId(null);
    setOver(null);
    if (!o || o.stage.code === stage.code) return;
    change({ id: o.id, number: o.number, stage: o.stage }, stage);
  };
  const col = (s: Stage, items: OrderListItem[], final = false) => (
    <div
      key={s.id}
      className={`kanban-col ${over === s.code ? 'drop-target' : ''}`}
      style={final ? { flexBasis: 200, opacity: 0.9 } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(s.code);
      }}
      onDragLeave={() => setOver((c) => (c === s.code ? null : c))}
      onDrop={(e) => {
        e.preventDefault();
        drop(s);
      }}
    >
      <div className="kanban-col-head">
        <span className="dot" style={{ background: s.color ?? '#999' }} />
        <span style={{ flex: 1 }}>{s.name}</span>
        {!final && <span className="muted">{items.length}</span>}
      </div>
      <div className="kanban-col-body">
        {final ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, padding: '8px 4px' }}>
            Перетащите сюда, чтобы {s.kind === 'won' ? 'закрыть заказ' : 'оформить отказ'}
          </Typography.Text>
        ) : (
          items.map((o) => <KanbanCard key={o.id} o={o} dragging={dragId === o.id} onDragStart={() => setDragId(o.id)} />)
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="kanban" onDragEnd={() => setDragId(null)}>
        {stages.map((s) => col(s, byStage.get(s.code) ?? []))}
        {dragId && finalStages.map((s) => col(s, [], true))}
      </div>
      {modal}
    </>
  );
}

function OrdersTable({ filters }: { filters: Record<string, unknown> }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const query = { view: 'table', page, pageSize: 30, ...filters };
  const list = useQuery({ queryKey: ['orders', query], queryFn: () => api.get<Paged<OrderListItem>>('/orders', query), placeholderData: keepPreviousData });
  const { can } = useAuth();
  return (
    <Table<OrderListItem>
      rowKey="id"
      size="middle"
      loading={list.isFetching}
      dataSource={list.data?.items}
      scroll={{ x: 1100 }}
      rowClassName={(r) => (r.overdue || r.stuck ? 'row-overdue clickable' : 'clickable')}
      onRow={(r) => ({ onClick: () => navigate(`/orders/${r.id}`) })}
      pagination={{ current: page, pageSize: 30, total: list.data?.total, onChange: setPage, showSizeChanger: false, showTotal: (t) => `Всего ${t}` }}
      columns={[
        { title: 'Номер', dataIndex: 'number', width: 150, render: (v, r) => <Space size={4} className="nowrap"><b>{v}</b>{r.unreadComments > 0 && <Badge count={r.unreadComments} size="small" color="#1f5fbf" />}</Space> },
        { title: 'Тип', dataIndex: 'type', width: 150, render: (v) => <OrderTypeTag type={v} /> },
        { title: 'Этап', width: 190, render: (_, r) => <Space size={4} wrap><StageTag stage={r.stage} />{r.stuck && <Tooltip title="Без движения"><FireOutlined style={{ color: '#d9363e' }} /></Tooltip>}</Space> },
        { title: 'Клиент', render: (_, r) => <div><div>{r.client.name}</div><div className="muted" style={{ fontSize: 12 }}>{r.title}</div></div> },
        { title: 'Оборудование', width: 180, render: (_, r) => r.equipment ? <div style={{ fontSize: 12.5 }}>{r.equipment.model ?? r.equipment.name}<div className="muted">{r.equipment.serialNumber}</div></div> : '—' },
        { title: 'Менеджер', dataIndex: 'managerId', width: 170, render: (v) => <UserAvatar userId={v} withName size={20} /> },
        { title: 'Мастера', width: 90, render: (_, r) => <Avatars ids={r.assignees.map((a) => a.userId)} size={20} /> },
        { title: 'Срок', dataIndex: 'plannedFinishAt', width: 110, render: (v, r) => <Typography.Text type={r.overdue ? 'danger' : undefined}>{fmtDate(v)}</Typography.Text>, sorter: (a, b) => dayjs(a.plannedFinishAt).valueOf() - dayjs(b.plannedFinishAt).valueOf() },
        ...(can(PERMISSIONS.ordersViewPrices) ? [{ title: 'Сумма', dataIndex: 'totalKop', width: 120, align: 'right' as const, render: (v: number) => <Money kop={v} /> }] : []),
      ]}
    />
  );
}

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const create = useCreate();
  const view = (params.get('view') as 'kanban' | 'table') ?? 'kanban';
  const type = (params.get('type') as OrderType) ?? 'repair_workshop';
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const filters = {
    q: params.get('q') ?? undefined,
    managerId: params.get('managerId') ?? undefined,
    masterId: params.get('masterId') ?? undefined,
    mine: params.get('mine') === 'true' || undefined,
    overdue: params.get('overdue') === 'true' || undefined,
    stuck: params.get('stuck') === 'true' || undefined,
    stageCode: params.get('stageCode') ?? undefined,
    open: view === 'table' && params.get('all') !== 'true' ? true : undefined,
    type: view === 'table' ? params.get('type') ?? undefined : undefined,
  };

  return (
    <>
      <PageHeader
        title="Заказы"
        extra={
          <>
            <Segmented
              value={view}
              onChange={(v) => set({ view: v === 'kanban' ? undefined : String(v) })}
              options={[
                { value: 'kanban', icon: <AppstoreOutlined />, label: 'Канбан' },
                { value: 'table', icon: <TableOutlined />, label: 'Таблица' },
              ]}
            />
            {can(PERMISSIONS.ordersCreate) && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => create.open('order', { order: { type } })}>
                Заказ
              </Button>
            )}
          </>
        }
      />
      <Space wrap style={{ marginBottom: 12 }}>
        {view === 'kanban' ? (
          <Segmented value={type} onChange={(v) => set({ type: String(v) })} options={ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))} />
        ) : (
          <Select
            allowClear
            placeholder="Все типы"
            style={{ width: 180 }}
            value={params.get('type') ?? undefined}
            onChange={(v) => set({ type: v })}
            options={ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))}
          />
        )}
        <Input.Search placeholder="Номер, клиент, серийный №" allowClear defaultValue={filters.q} onSearch={(v) => set({ q: v || undefined })} style={{ width: 240 }} />
        {can(PERMISSIONS.ordersViewAll) && (
          <>
            <UserSelect role="manager" placeholder="Менеджер" style={{ width: 170 }} value={filters.managerId} onChange={(v) => set({ managerId: v as string | undefined })} />
            <UserSelect role="master" placeholder="Мастер" style={{ width: 170 }} value={filters.masterId} onChange={(v) => set({ masterId: v as string | undefined })} />
          </>
        )}
        <Checkbox checked={!!filters.mine} onChange={(e) => set({ mine: e.target.checked ? 'true' : undefined })}>
          Мои
        </Checkbox>
        <Checkbox checked={!!filters.overdue} onChange={(e) => set({ overdue: e.target.checked ? 'true' : undefined })}>
          Просрочены
        </Checkbox>
        <Checkbox checked={!!filters.stuck} onChange={(e) => set({ stuck: e.target.checked ? 'true' : undefined })}>
          Без движения
        </Checkbox>
        {view === 'table' && (
          <Checkbox checked={params.get('all') === 'true'} onChange={(e) => set({ all: e.target.checked ? 'true' : undefined })}>
            С закрытыми
          </Checkbox>
        )}
      </Space>
      {view === 'kanban' ? <Kanban type={type} filters={{ ...filters, type: undefined, open: undefined }} /> : <OrdersTable filters={filters} />}
    </>
  );
}
