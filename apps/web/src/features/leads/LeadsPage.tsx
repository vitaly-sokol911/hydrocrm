import { CheckOutlined, CloseOutlined, PlusOutlined, RocketOutlined, StopOutlined } from '@ant-design/icons';
import {
  CLIENT_TYPE_LABELS,
  CLIENT_TYPES,
  formatPhone,
  LEAD_CHANNEL_LABELS,
  LEAD_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  ORDER_TYPES,
  PERMISSIONS,
  type LeadStatus,
} from '@hydrocrm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Descriptions, Drawer, Form, Input, Modal, Radio, Segmented, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtDateTime, fmtSmart, fromNow } from '../../shared/format';
import { useAction, useDictionaries } from '../../shared/hooks';
import { ClientSelect, UserSelect } from '../../shared/selects';
import type { Lead, Paged } from '../../shared/types';
import { PageHeader, Phone, UserAvatar } from '../../shared/ui';
import { useCreate } from '../create/CreateProvider';

const STATUS_COLORS: Record<LeadStatus, string> = { new: 'blue', in_progress: 'gold', converted: 'green', rejected: 'default', spam: 'default' };

function LeadStatusBadge({ lead }: { lead: Lead }) {
  if (lead.overdue) return <Tag color="red">Просрочена</Tag>;
  return <Tag color={STATUS_COLORS[lead.status]}>{LEAD_STATUS_LABELS[lead.status]}</Tag>;
}

function ConvertModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'existing' | 'new'>(lead.clientId ? 'existing' : 'new');
  const convert = useAction((v: unknown) => api.post<{ id: string; number: string }>(`/leads/${lead.id}/convert`, v), {
    invalidate: [['leads'], ['orders'], ['dashboard']],
    success: (o) => `Создан заказ ${o.number}`,
    onSuccess: (o) => navigate(`/orders/${o.id}`),
  });
  return (
    <Modal title={`Заказ из заявки ${lead.number}`} open onCancel={onClose} okText="Создать заказ" onOk={() => form.submit()} confirmLoading={convert.isPending}>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'repair_workshop', clientId: lead.clientId, title: lead.description.slice(0, 120), newClient: { type: 'company', name: lead.contactName ?? '' } }}
        onFinish={(v) =>
          convert.mutate({ type: v.type, title: v.title, clientId: mode === 'existing' ? v.clientId : undefined, newClient: mode === 'new' ? v.newClient : undefined })
        }
      >
        <Form.Item name="type" label="Тип заказа">
          <Select options={ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))} />
        </Form.Item>
        <Form.Item label="Клиент">
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} optionType="button" options={[{ value: 'existing', label: 'Из базы' }, { value: 'new', label: 'Новый клиент' }]} />
        </Form.Item>
        {mode === 'existing' ? (
          <Form.Item name="clientId" rules={[{ required: true, message: 'Выберите клиента' }]}>
            <ClientSelect initialLabel={lead.client?.name} />
          </Form.Item>
        ) : (
          <Space.Compact style={{ width: '100%', marginBottom: 24 }}>
            <Form.Item name={['newClient', 'type']} noStyle>
              <Select style={{ width: 130 }} options={CLIENT_TYPES.map((t) => ({ value: t, label: CLIENT_TYPE_LABELS[t] }))} />
            </Form.Item>
            <Form.Item name={['newClient', 'name']} noStyle rules={[{ required: true, message: 'Название или ФИО' }]}>
              <Input placeholder="Название или ФИО" />
            </Form.Item>
          </Space.Compact>
        )}
        <Form.Item name="title" label="Кратко о заказе">
          <Input />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Телефон и email из заявки перенесутся в карточку нового клиента.
        </Typography.Text>
      </Form>
    </Modal>
  );
}

function RejectModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [form] = Form.useForm();
  const dicts = useDictionaries();
  const reject = useAction((v: unknown) => api.post(`/leads/${lead.id}/reject`, v), { invalidate: [['leads'], ['lead', lead.id], ['dashboard']], success: 'Заявка закрыта', onSuccess: onClose });
  return (
    <Modal title="Отказ по заявке" open onCancel={onClose} okText="Закрыть заявку" okButtonProps={{ danger: true }} onOk={() => form.submit()} confirmLoading={reject.isPending}>
      <Form form={form} layout="vertical" onFinish={(v) => reject.mutate(v)}>
        <Form.Item name="reasonId" label="Причина" rules={[{ required: true, message: 'Выберите причину' }]}>
          <Select options={(dicts.rejectReasons ?? []).map((r) => ({ value: r.id, label: r.name }))} />
        </Form.Item>
        <Form.Item name="comment" label="Комментарий">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function LeadDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['lead', id], queryFn: () => api.get<Lead>(`/leads/${id}`) });
  const [modal, setModal] = useState<'convert' | 'reject' | null>(null);
  const inv = [['leads'], ['lead', id], ['dashboard']];
  const take = useAction(() => api.post(`/leads/${id}/take`), { invalidate: inv, success: 'Заявка в работе' });
  const reopen = useAction(() => api.post(`/leads/${id}/reopen`), { invalidate: inv });
  const assign = useAction((assigneeId: string) => api.patch(`/leads/${id}`, { assigneeId }), { invalidate: inv, success: 'Ответственный изменён' });
  const spam = useAction(() => api.post(`/leads/${id}/reject`, { spam: true }), { invalidate: inv, success: 'Помечено как спам', onSuccess: onClose });
  const l = q.data;
  const open = l && ['new', 'in_progress'].includes(l.status);
  const edit = can(PERMISSIONS.leadsEdit);
  const overdue = l && !l.firstResponseAt && new Date(l.responseDueAt) < new Date();

  return (
    <Drawer open onClose={onClose} width={520} title={l ? `Заявка ${l.number}` : 'Заявка'} loading={q.isLoading}>
      {l && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space wrap>
            <LeadStatusBadge lead={{ ...l, overdue: !!overdue && l.status === 'new' }} />
            <Tag bordered={false}>{LEAD_CHANNEL_LABELS[l.channel]}</Tag>
            {l.isStatusQuestion && <Tag color="purple">Вопрос по статусу</Tag>}
          </Space>
          <Typography.Paragraph style={{ fontSize: 15, whiteSpace: 'pre-wrap', margin: 0 }}>{l.description}</Typography.Paragraph>
          {edit && open && (
            <Space wrap>
              {l.status === 'new' && (
                <Button type="primary" icon={<CheckOutlined />} onClick={() => take.mutate(undefined)} loading={take.isPending}>
                  Взять в работу
                </Button>
              )}
              {can(PERMISSIONS.ordersCreate) && (
                <Button type={l.status === 'new' ? 'default' : 'primary'} icon={<RocketOutlined />} onClick={() => setModal('convert')}>
                  Создать заказ
                </Button>
              )}
              <Button icon={<CloseOutlined />} onClick={() => setModal('reject')}>
                Отказ
              </Button>
              <Button type="text" icon={<StopOutlined />} danger onClick={() => spam.mutate(undefined)}>
                Спам
              </Button>
            </Space>
          )}
          {l.status === 'rejected' && edit && <Button onClick={() => reopen.mutate(undefined)}>Вернуть в работу</Button>}
          {l.order && (
            <Typography.Text>
              Создан заказ <Link to={`/orders/${l.order.id}`}>{l.order.number}</Link>
            </Typography.Text>
          )}
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Клиент">{l.client ? <Link to={`/clients/${l.client.id}`}>{l.client.name}</Link> : <span className="muted">новый</span>}</Descriptions.Item>
            <Descriptions.Item label="Контакт">{l.contactName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Телефон">{l.phone ? <Phone value={l.phone} /> : '—'}</Descriptions.Item>
            <Descriptions.Item label="Email">{l.email ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Источник">{l.source?.name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Ответственный">
              {edit && open ? <UserSelect role="manager" value={l.assigneeId ?? undefined} onChange={(v) => v && assign.mutate(v as string)} style={{ width: '100%' }} placeholder="Не назначен" /> : <UserAvatar userId={l.assigneeId} withName />}
            </Descriptions.Item>
            <Descriptions.Item label="Поступила">{fmtDateTime(l.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="Срок реакции">
              <Typography.Text type={overdue ? 'danger' : undefined}>{fmtDateTime(l.responseDueAt)}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Первая реакция">{l.firstResponseAt ? `${fmtDateTime(l.firstResponseAt)}` : '—'}</Descriptions.Item>
            {l.rejectReason && <Descriptions.Item label="Причина отказа">{l.rejectReason.name}{l.rejectComment ? `. ${l.rejectComment}` : ''}</Descriptions.Item>}
          </Descriptions>
        </Space>
      )}
      {l && modal === 'convert' && <ConvertModal lead={l} onClose={() => setModal(null)} />}
      {l && modal === 'reject' && <RejectModal lead={l} onClose={() => setModal(null)} />}
    </Drawer>
  );
}

export default function LeadsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const create = useCreate();
  const filter = params.get('overdue') === 'true' ? 'overdue' : params.get('f') ?? 'open';
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const query = {
    page,
    pageSize: 30,
    q,
    status: filter === 'open' ? 'open' : filter === 'new' ? 'new' : filter === 'closed' ? 'rejected' : filter === 'converted' ? 'converted' : undefined,
    mine: filter === 'mine' || undefined,
    overdue: filter === 'overdue' || undefined,
  };
  const list = useQuery({ queryKey: ['leads', query], queryFn: () => api.get<Paged<Lead> & { counters: { new: number; overdue: number; mine: number } }>('/leads', query), placeholderData: keepPreviousData });
  const c = list.data?.counters;

  return (
    <>
      <PageHeader
        title="Заявки"
        subtitle="Все обращения из всех каналов в одном списке"
        extra={
          can(PERMISSIONS.leadsEdit) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => create.open('lead')}>
              Заявка
            </Button>
          )
        }
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={filter}
          onChange={(v) => {
            setPage(1);
            setParams(v === 'open' ? {} : { f: String(v) });
          }}
          options={[
            { value: 'open', label: 'Открытые' },
            { value: 'new', label: `Новые${c ? ` (${c.new})` : ''}` },
            { value: 'overdue', label: <span style={{ color: c?.overdue ? '#d9363e' : undefined }}>Просрочены{c ? ` (${c.overdue})` : ''}</span> },
            { value: 'mine', label: `Мои${c ? ` (${c.mine})` : ''}` },
            { value: 'converted', label: 'В заказе' },
            { value: 'closed', label: 'Отказ' },
          ]}
        />
        <Input.Search placeholder="Номер, имя, телефон, текст" allowClear onSearch={(v) => { setPage(1); setQ(v); }} style={{ width: 260 }} />
      </Space>
      <Table<Lead>
        rowKey="id"
        size="middle"
        loading={list.isFetching}
        dataSource={list.data?.items}
        scroll={{ x: 900 }}
        rowClassName={(r) => (r.overdue ? 'row-overdue clickable' : 'clickable')}
        onRow={(r) => ({ onClick: () => navigate(`/leads/${r.id}${params.toString() ? `?${params}` : ''}`) })}
        pagination={{ current: page, pageSize: 30, total: list.data?.total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: 'Номер', dataIndex: 'number', width: 130, render: (v) => <b>{v}</b> },
          { title: 'Статус', width: 130, render: (_, r) => <LeadStatusBadge lead={r} /> },
          { title: 'Канал', dataIndex: 'channel', width: 110, render: (v) => LEAD_CHANNEL_LABELS[v as keyof typeof LEAD_CHANNEL_LABELS] },
          {
            title: 'Клиент / контакт',
            width: 220,
            render: (_, r) => (
              <div>
                <div>{r.client?.name ?? r.contactName ?? '—'}</div>
                {r.phone && <div className="muted" style={{ fontSize: 12 }}>{formatPhone(r.phone)}</div>}
              </div>
            ),
          },
          { title: 'Запрос', dataIndex: 'description', render: (v) => <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ margin: 0 }}>{v}</Typography.Paragraph> },
          { title: 'Ответственный', dataIndex: 'assigneeId', width: 170, render: (v) => <UserAvatar userId={v} withName /> },
          { title: 'Поступила', dataIndex: 'createdAt', width: 140, render: (v) => <span title={fmtDateTime(v)}>{fmtSmart(v)}<div className="muted" style={{ fontSize: 11 }}>{fromNow(v)}</div></span> },
        ]}
      />
      {id && <LeadDrawer id={id} onClose={() => navigate(`/leads${params.toString() ? `?${params}` : ''}`)} />}
    </>
  );
}
