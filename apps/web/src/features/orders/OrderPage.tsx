import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  CameraOutlined,
  CheckSquareOutlined,
  DownOutlined,
  EnvironmentOutlined,
  FireOutlined,
  HistoryOutlined,
  MessageOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { CLIENT_TYPE_LABELS, PERMISSIONS, PRIORITIES, PRIORITY_LABELS, VISIT_RESULT_LABELS, VISIT_STATUS_LABELS } from '@hydrocrm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Card, Col, DatePicker, Dropdown, Grid, Image, List, Result, Row, Select, Skeleton, Space, Tabs, Tag, Timeline, Typography } from 'antd';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { dayjs, fmtDate, fmtDateTime, fmtHours, fmtSmart } from '../../shared/format';
import { useAction, useUsers } from '../../shared/hooks';
import { UserSelect } from '../../shared/selects';
import type { OrderDetail, Stage, Task } from '../../shared/types';
import { Field, Money, OrderTypeTag, Phone, PriorityTag, UserAvatar } from '../../shared/ui';
import { uploadFile } from '../../shared/upload';
import { useCreate } from '../create/CreateProvider';
import { TaskList } from '../tasks/TaskList';
import { VisitFormModal } from '../visits/VisitFormModal';
import { OrderEstimate } from './OrderEstimate';
import { OrderFeed } from './OrderFeed';
import { HydraulicLine } from '../../shared/HydraulicLine';
import { useStageChange } from './stage';

/** Этапы заказа в виде гидролинии: пропущенные необязательные этапы не показываются. */
function StageBar({ order }: { order: OrderDetail }) {
  const entered = new Map(order.stageHistory.map((h) => [h.toStageId, h.changedAt]));
  const visible = order.stages.filter((s) => (s.kind === 'open' && (s.sort > order.stage.sort || entered.has(s.id))) || s.id === order.stage.id);
  const current = Math.max(0, visible.findIndex((s) => s.id === order.stage.id));
  return (
    <HydraulicLine
      animate
      lost={order.stage.kind === 'lost'}
      current={current}
      stages={visible.map((s) => ({ key: s.id, name: s.name, note: entered.has(s.id) ? dayjs(entered.get(s.id)).format('DD.MM') : undefined }))}
    />
  );
}

function StageControl({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  const { change, modal, busy } = useStageChange();
  const full = can(PERMISSIONS.ordersChangeStage);
  const production = can(PERMISSIONS.ordersChangeProductionStage);
  if (!full && !production) return null;
  const openStages = order.stages.filter((s) => s.kind === 'open');
  const next = openStages.find((s) => s.sort > order.stage.sort) ?? (order.stage.kind === 'open' ? order.stages.find((s) => s.kind === 'won') : undefined);
  const go = (s: Stage) => change({ id: order.id, number: order.number, stage: order.stage }, s);
  const menu = order.stages.filter((s) => s.id !== order.stage.id).map((s) => ({ key: s.code, label: s.name, danger: s.kind === 'lost' }));
  return (
    <>
      <Space.Compact>
        {next && order.stage.kind === 'open' && (
          <Button type="primary" icon={<ArrowRightOutlined />} loading={busy} onClick={() => go(next)}>
            {next.name}
          </Button>
        )}
        <Dropdown
          trigger={['click']}
          menu={{ items: menu, onClick: ({ key }) => go(order.stages.find((s) => s.code === key)!) }}
        >
          <Button icon={<DownOutlined />}>{next && order.stage.kind === 'open' ? '' : 'Сменить этап'}</Button>
        </Dropdown>
      </Space.Compact>
      {modal}
    </>
  );
}

function SidePanel({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  const { message } = App.useApp();
  const inv = [['order', order.id], ['orders']];
  const patch = useAction((body: Record<string, unknown>) => api.patch(`/orders/${order.id}`, { version: order.version, ...body }), { invalidate: inv, success: 'Сохранено' });
  const assign = useAction((masterIds: string[]) => api.post(`/orders/${order.id}/assignees`, { masterIds }), { invalidate: inv, success: 'Исполнители обновлены' });
  const qc = useQueryClient();
  const photoInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const editable = can(PERMISSIONS.ordersEdit) && order.stage.kind === 'open';
  const photos = order.files.filter((f) => f.mimeType.startsWith('image/'));
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      await Promise.all([...files].map((f) => uploadFile(f, { orderId: order.id })));
      message.success('Фото загружены');
      await qc.invalidateQueries({ queryKey: ['order', order.id] });
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'Не удалось загрузить');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" title="Клиент">
        <Link to={can(PERMISSIONS.clientsViewAll) ? `/clients/${order.client.id}` : '#'} style={{ fontWeight: 600 }}>
          {order.client.name}
        </Link>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          {CLIENT_TYPE_LABELS[order.client.type]}
        </div>
        {order.contact && (
          <Field label="Контакт">
            {order.contact.fullName}
            {order.contact.position && <span className="muted"> · {order.contact.position}</span>}
            <div>
              <Phone value={order.contact.phone} />
            </div>
          </Field>
        )}
        {!order.contact && order.client.phone && (
          <Field label="Телефон">
            <Phone value={order.client.phone} />
          </Field>
        )}
        {order.client.address && <Field label="Адрес">{order.client.address}</Field>}
      </Card>

      {order.equipment && (
        <Card size="small" title="Оборудование" extra={<Link to={`/equipment/${order.equipment.id}`}>История</Link>}>
          <b>{order.equipment.name}</b>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {[order.equipment.manufacturer, order.equipment.model].filter(Boolean).join(' ')}
            {order.equipment.serialNumber && ` · № ${order.equipment.serialNumber}`}
          </div>
          <Space size={[12, 4]} wrap style={{ marginTop: 8, fontSize: 12.5 }}>
            {order.equipment.pressureBar && <span>{Number(order.equipment.pressureBar)} бар</span>}
            {order.equipment.flowLpm && <span>{Number(order.equipment.flowLpm)} л/мин</span>}
            {order.equipment.tankVolumeL && <span>бак {Number(order.equipment.tankVolumeL)} л</span>}
            {order.equipment.motorPowerKw && <span>{Number(order.equipment.motorPowerKw)} кВт</span>}
          </Space>
        </Card>
      )}

      <Card size="small" title="Команда и сроки">
        <Field label="Менеджер">
          {editable && can(PERMISSIONS.ordersAssign) ? (
            <UserSelect role="manager" value={order.managerId ?? undefined} onChange={(v) => patch.mutate({ managerId: v ?? null })} style={{ width: '100%' }} />
          ) : (
            <UserAvatar userId={order.managerId} withName />
          )}
        </Field>
        <Field label="Мастера">
          {editable && can(PERMISSIONS.ordersAssign) ? (
            <UserSelect role="master" mode="multiple" value={order.assignees.map((a) => a.userId)} onChange={(v) => assign.mutate(v as string[])} style={{ width: '100%' }} placeholder="Не назначены" />
          ) : (
            <Space direction="vertical" size={4}>
              {order.assignees.length ? order.assignees.map((a) => <UserAvatar key={a.userId} userId={a.userId} withName />) : '—'}
            </Space>
          )}
        </Field>
        <Row gutter={8}>
          <Col span={12}>
            <Field label="Приоритет">
              {editable ? (
                <Select size="small" value={order.priority} onChange={(v) => patch.mutate({ priority: v })} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} style={{ width: '100%' }} />
              ) : (
                PRIORITY_LABELS[order.priority]
              )}
            </Field>
          </Col>
          <Col span={12}>
            <Field label="Срок готовности">
              {editable ? (
                <DatePicker size="small" format="DD.MM.YYYY" value={order.plannedFinishAt ? dayjs(order.plannedFinishAt) : null} onChange={(d) => patch.mutate({ plannedFinishAt: d ? d.endOf('day').toISOString() : null })} style={{ width: '100%' }} allowClear={false} />
              ) : (
                fmtDate(order.plannedFinishAt)
              )}
            </Field>
          </Col>
        </Row>
        <Field label="Создан">{fmtDateTime(order.createdAt)}</Field>
        {order.finishedAt && <Field label="Закрыт">{fmtDateTime(order.finishedAt)}</Field>}
        {order.lead && <Field label="Из заявки"><Link to={`/leads/${order.lead.id}`}>{order.lead.number}</Link></Field>}
        {order.parentOrder && <Field label="Исходный заказ"><Link to={`/orders/${order.parentOrder.id}`}>{order.parentOrder.number}</Link></Field>}
        {!!order.childOrders.length && (
          <Field label="Связанные заказы">
            {order.childOrders.map((c) => (
              <Link key={c.id} to={`/orders/${c.id}`} style={{ marginRight: 8 }}>
                {c.number}
              </Link>
            ))}
          </Field>
        )}
      </Card>

      <Card
        size="small"
        title={`Фото (${photos.length})`}
        extra={
          <>
            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
            <Button size="small" icon={<CameraOutlined />} loading={uploading} onClick={() => photoInput.current?.click()}>
              Добавить
            </Button>
          </>
        }
      >
        {photos.length ? (
          <Image.PreviewGroup>
            <Space wrap size={6}>
              {photos.map((f) => (
                <Image key={f.id} src={f.url} width={72} height={56} style={{ objectFit: 'cover', borderRadius: 6 }} />
              ))}
            </Space>
          </Image.PreviewGroup>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Фото приёмки, дефектов и результата. Для этапа «Принят в цех» нужно хотя бы одно.
          </Typography.Text>
        )}
      </Card>
    </Space>
  );
}

function VisitsTab({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      {can(PERMISSIONS.visitsPlan) && order.stage.kind === 'open' && (
        <Button icon={<PlusOutlined />} onClick={() => setOpen(true)} style={{ marginBottom: 12 }}>
          Запланировать выезд
        </Button>
      )}
      <List
        dataSource={order.visits}
        locale={{ emptyText: 'Выездов не было' }}
        renderItem={(v) => (
          <List.Item className="clickable" onClick={() => navigate(`/visits/${v.id}`)} extra={<Tag color={v.status === 'done' ? 'green' : v.status === 'on_site' ? 'purple' : 'blue'}>{VISIT_STATUS_LABELS[v.status]}</Tag>}>
            <List.Item.Meta
              avatar={<EnvironmentOutlined style={{ fontSize: 18, marginTop: 4 }} />}
              title={`${fmtDateTime(v.plannedStartAt)} — ${dayjs(v.plannedEndAt).format('HH:mm')}`}
              description={
                <>
                  <div>{v.address}</div>
                  <Space size={6}>
                    {v.assignees.map((a) => <UserAvatar key={a.userId} userId={a.userId} withName size={18} />)}
                    {v.result && <Tag>{VISIT_RESULT_LABELS[v.result]}</Tag>}
                  </Space>
                  {v.report && <div style={{ marginTop: 4 }}>{v.report}</div>}
                </>
              }
            />
          </List.Item>
        )}
      />
      {open && <VisitFormModal order={order} onClose={() => setOpen(false)} />}
    </>
  );
}

function TasksTab({ order }: { order: OrderDetail }) {
  const create = useCreate();
  const q = useQuery({ queryKey: ['tasks', { orderId: order.id }], queryFn: () => api.get<Task[]>('/tasks', { orderId: order.id }) });
  const done = useQuery({ queryKey: ['tasks', { orderId: order.id, status: 'done' }], queryFn: () => api.get<Task[]>('/tasks', { orderId: order.id, status: 'done' }) });
  return (
    <>
      <Button icon={<PlusOutlined />} onClick={() => create.open('task', { task: { orderId: order.id, orderNumber: order.number, clientId: order.client.id } })} style={{ marginBottom: 8 }}>
        Поставить задачу
      </Button>
      <TaskList tasks={q.data ?? []} loading={q.isLoading} showOrder={false} />
      {!!done.data?.length && (
        <>
          <Typography.Text type="secondary">Выполненные</Typography.Text>
          <TaskList tasks={done.data} showOrder={false} />
        </>
      )}
    </>
  );
}

function HistoryTab({ order }: { order: OrderDetail }) {
  const { name } = useUsers();
  const stage = new Map(order.stages.map((s) => [s.id, s]));
  return (
    <Timeline
      items={order.stageHistory.map((h) => {
        const to = stage.get(h.toStageId);
        return {
          color: h.overridden ? 'red' : to?.kind === 'won' ? 'green' : to?.kind === 'lost' ? 'red' : 'blue',
          children: (
            <div>
              <b>{to?.name}</b> <span className="muted">· {fmtDateTime(h.changedAt)} · {name(h.changedById)}</span>
              {h.durationHours !== null && h.fromStageId && <div className="muted" style={{ fontSize: 12 }}>на «{stage.get(h.fromStageId)?.name}» — {fmtHours(h.durationHours)}</div>}
              {h.overridden && <Tag color="red">проверки пропущены</Tag>}
              {h.comment && <div>{h.comment}</div>}
            </div>
          ),
        };
      })}
    />
  );
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const screens = Grid.useBreakpoint();
  const create = useCreate();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });
  const tab = params.get('tab') ?? 'feed';

  if (q.isError) {
    return <Result status="404" title="Заказ не найден" subTitle={(q.error as Error).message} extra={<Link to="/orders">К заказам</Link>} />;
  }
  const order = q.data;
  if (!order) return <Skeleton active paragraph={{ rows: 12 }} />;
  const hoursOnStage = (Date.now() - new Date(order.stageChangedAt).getTime()) / 3_600_000;
  const stuck = order.stage.kind === 'open' && order.stage.normHours && hoursOnStage > order.stage.normHours;
  const overdue = order.stage.kind === 'open' && order.plannedFinishAt && new Date(order.plannedFinishAt) < new Date();

  const tabs = [
    { key: 'feed', label: <span><MessageOutlined /> Лента</span>, children: <OrderFeed orderId={order.id} /> },
    { key: 'estimate', label: <span><UnorderedListOutlined /> Смета{order.items.some((i) => i.status === 'proposed') && <Badge dot offset={[4, -6]} />}</span>, children: <OrderEstimate order={order} /> },
    ...(order.type === 'repair_field' || order.visits.length ? [{ key: 'visits', label: <span><CalendarOutlined /> Выезды ({order.visits.length})</span>, children: <VisitsTab order={order} /> }] : []),
    { key: 'tasks', label: <span><CheckSquareOutlined /> Задачи{order.openTasks ? ` (${order.openTasks})` : ''}</span>, children: <TasksTab order={order} /> },
    { key: 'history', label: <span><HistoryOutlined /> История</span>, children: <HistoryTab order={order} /> },
  ];

  return (
    <>
      <Space style={{ marginBottom: 8 }}>
        <Link to="/orders" className="muted">
          <ArrowLeftOutlined /> Заказы
        </Link>
      </Space>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <div style={{ minWidth: 0 }}>
          <Space size={8} wrap align="center">
            <Typography.Title level={3} className="mono" style={{ margin: 0, fontWeight: 500 }}>
              {order.number}
            </Typography.Title>
            <OrderTypeTag type={order.type} />
            <PriorityTag priority={order.priority} />
            {order.isWarrantyCase && <Tag icon={<SafetyCertificateOutlined />} color="cyan">Гарантия</Tag>}
            {stuck && <Tag icon={<FireOutlined />} color="red">без движения {fmtHours(hoursOnStage)}</Tag>}
            {overdue && <Tag color="orange">срок был {fmtDate(order.plannedFinishAt)}</Tag>}
          </Space>
          <div style={{ marginTop: 4, fontSize: 15 }}>{order.title}</div>
          {order.complaint && order.complaint !== order.title && (
            <Typography.Paragraph type="secondary" ellipsis={{ rows: 2, expandable: true, symbol: 'ещё' }} style={{ margin: '4px 0 0', maxWidth: 820 }}>
              {order.complaint}
            </Typography.Paragraph>
          )}
        </div>
        <div className="page-header-extra">
          {order.totals && <span style={{ fontSize: 18 }}><Money kop={order.totals.totalKop} strong /></span>}
          <Button icon={<CheckSquareOutlined />} onClick={() => create.open('task', { task: { orderId: order.id, orderNumber: order.number, clientId: order.client.id } })}>
            {screens.md ? 'Задача' : ''}
          </Button>
          <StageControl order={order} />
        </div>
      </div>
      <StageBar order={order} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        На этапе «{order.stage.name}» с {fmtSmart(order.stageChangedAt)}
        {order.stage.normHours ? ` · норма ${fmtHours(order.stage.normHours)}` : ''}
      </Typography.Text>

      <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={16} xxl={17}>
          <Card size="small">
            <Tabs activeKey={tab} onChange={(k) => setParams(k === 'feed' ? {} : { tab: k }, { replace: true })} items={tabs} />
          </Card>
        </Col>
        <Col xs={24} lg={8} xxl={7}>
          <SidePanel order={order} />
        </Col>
      </Row>
    </>
  );
}
