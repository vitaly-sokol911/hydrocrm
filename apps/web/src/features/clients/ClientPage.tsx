import { ArrowLeftOutlined, EditOutlined, PlusOutlined, StarFilled } from '@ant-design/icons';
import { CLIENT_TYPE_LABELS, contactSchema, equipmentSchema, LEAD_CHANNEL_LABELS, LEAD_STATUS_LABELS, PERMISSIONS } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Checkbox, Col, Descriptions, Form, Input, InputNumber, List, Modal, Popconfirm, Result, Row, Skeleton, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtDate } from '../../shared/format';
import { fieldErrors, useAction } from '../../shared/hooks';
import type { ClientDetail, Contact, Equipment, Task } from '../../shared/types';
import { Money, OrderTypeTag, Phone, StageTag, UserAvatar } from '../../shared/ui';
import { useCreate } from '../create/CreateProvider';
import { TaskList } from '../tasks/TaskList';
import { ClientFormModal } from './ClientFormModal';

export function EquipmentFormModal({ clientId, equipment, onClose }: { clientId: string; equipment?: Equipment; onClose: () => void }) {
  const [form] = Form.useForm();
  const save = useAction((v: unknown) => (equipment ? api.patch(`/equipment/${equipment.id}`, v) : api.post(`/clients/${clientId}/equipment`, v)), {
    invalidate: [['client', clientId], ['equipment']],
    success: 'Сохранено',
    onSuccess: onClose,
  });
  const num = (v: string | null | undefined) => (v === null || v === undefined ? undefined : Number(v));
  return (
    <Modal title={equipment ? 'Оборудование' : 'Новая станция'} open onCancel={onClose} onOk={() => form.submit()} okText="Сохранить" confirmLoading={save.isPending} width={640} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={equipment ? { ...equipment, pressureBar: num(equipment.pressureBar), flowLpm: num(equipment.flowLpm), tankVolumeL: num(equipment.tankVolumeL), motorPowerKw: num(equipment.motorPowerKw) } : { voltage: '380 В' }}
        onFinish={(v) => {
          const parsed = equipmentSchema.safeParse(v);
          if (!parsed.success) return form.setFields(parsed.error.issues.map((i) => ({ name: i.path as string[], errors: [i.message] })));
          save.mutate(parsed.data, { onError: (e) => form.setFields(fieldErrors(e)) });
        }}
      >
        <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
          <Input placeholder="Гидростанция пресса №2" />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={12} sm={8}><Form.Item name="manufacturer" label="Производитель"><Input /></Form.Item></Col>
          <Col xs={12} sm={8}><Form.Item name="model" label="Модель"><Input /></Form.Item></Col>
          <Col xs={12} sm={8}><Form.Item name="serialNumber" label="Серийный №"><Input /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="year" label="Год"><InputNumber min={1950} max={2100} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="pressureBar" label="Давление, бар"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="flowLpm" label="Расход, л/мин"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="tankVolumeL" label="Бак, л"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="motorPowerKw" label="Мощность, кВт"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} sm={6}><Form.Item name="voltage" label="Напряжение"><Input /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="location" label="Где установлена"><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="note" label="Заметка">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ContactModal({ clientId, contact, onClose }: { clientId: string; contact?: Contact; onClose: () => void }) {
  const [form] = Form.useForm();
  const save = useAction((v: unknown) => (contact ? api.patch(`/contacts/${contact.id}`, v) : api.post(`/clients/${clientId}/contacts`, v)), {
    invalidate: [['client', clientId]],
    success: 'Сохранено',
    onSuccess: onClose,
  });
  return (
    <Modal title={contact ? 'Контакт' : 'Новый контакт'} open onCancel={onClose} onOk={() => form.submit()} okText="Сохранить" confirmLoading={save.isPending} destroyOnClose>
      <Form form={form} layout="vertical" initialValues={contact ?? { isPrimary: false }} onFinish={(v) => save.mutate(contactSchema.parse(v))}>
        <Form.Item name="fullName" label="ФИО" rules={[{ required: true, message: 'Укажите имя' }]}><Input /></Form.Item>
        <Form.Item name="position" label="Должность"><Input placeholder="Главный механик" /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="phone" label="Телефон"><Input inputMode="tel" /></Form.Item></Col>
          <Col span={12}><Form.Item name="email" label="Email"><Input /></Form.Item></Col>
        </Row>
        <Form.Item name="isPrimary" valuePropName="checked"><Checkbox>Основной контакт</Checkbox></Form.Item>
      </Form>
    </Modal>
  );
}

export default function ClientPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const create = useCreate();
  const q = useQuery({ queryKey: ['client', id], queryFn: () => api.get<ClientDetail>(`/clients/${id}`) });
  const tasks = useQuery({ queryKey: ['tasks', { clientId: id }], queryFn: () => api.get<Task[]>('/tasks', { clientId: id }) });
  const [modal, setModal] = useState<null | { kind: 'edit' } | { kind: 'equipment'; eq?: Equipment } | { kind: 'contact'; c?: Contact }>(null);
  const removeContact = useAction((cid: string) => api.delete(`/contacts/${cid}`), { invalidate: [['client', id]] });
  const archive = useAction((archived: boolean) => api.post(`/clients/${id}/archive`, { archived }), { invalidate: [['client', id], ['clients']], success: 'Готово' });
  if (q.isError) return <Result status="404" title="Клиент не найден" extra={<Link to="/clients">К списку</Link>} />;
  const c = q.data;
  if (!c) return <Skeleton active paragraph={{ rows: 10 }} />;
  const edit = can(PERMISSIONS.clientsEdit);
  const finance = can(PERMISSIONS.clientsViewFinance);
  const legal = c.type !== 'person';
  const openOrders = c.orders.filter((o) => o.stage.kind === 'open');

  return (
    <>
      <Link to="/clients" className="muted">
        <ArrowLeftOutlined /> Клиенты
      </Link>
      <div className="page-header" style={{ marginTop: 8 }}>
        <div>
          <Space wrap>
            <Typography.Title level={3} style={{ margin: 0 }}>{c.name}</Typography.Title>
            <Tag>{CLIENT_TYPE_LABELS[c.type]}</Tag>
            {c.tags.map((t) => <Tag key={t} color={t === 'ключевой' ? 'gold' : 'purple'}>{t}</Tag>)}
            {c.archivedAt && <Tag color="default">в архиве</Tag>}
          </Space>
          <Space size={16} wrap style={{ marginTop: 4 }}>
            <Phone value={c.phone} />
            {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
            <span className="muted">Менеджер: <UserAvatar userId={c.managerId} withName size={18} /></span>
          </Space>
        </div>
        <div className="page-header-extra">
          {can(PERMISSIONS.ordersCreate) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => create.open('order', { order: { clientId: c.id, clientName: c.name } })}>
              Заказ
            </Button>
          )}
          <Button onClick={() => create.open('task', { task: { clientId: c.id, title: `Связаться с ${c.name}` } })}>Задача</Button>
          {edit && <Button icon={<EditOutlined />} onClick={() => setModal({ kind: 'edit' })}>Изменить</Button>}
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card size="small">
            <Tabs
              items={[
                {
                  key: 'orders',
                  label: `Заказы (${c.orders.length})`,
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={c.orders}
                      pagination={{ pageSize: 15, hideOnSinglePage: true }}
                      rowClassName="clickable"
                      onRow={(o) => ({ onClick: () => navigate(`/orders/${o.id}`) })}
                      scroll={{ x: 640 }}
                      columns={[
                        { title: 'Номер', dataIndex: 'number', width: 120, render: (v) => <b>{v}</b> },
                        { title: 'Тип', dataIndex: 'type', width: 150, render: (v) => <OrderTypeTag type={v} /> },
                        { title: 'Заказ', dataIndex: 'title' },
                        { title: 'Этап', width: 170, render: (_, o) => <StageTag stage={o.stage} /> },
                        { title: 'Создан', dataIndex: 'createdAt', width: 100, render: fmtDate },
                        ...(finance ? [{ title: 'Сумма', dataIndex: 'totalKop', width: 110, align: 'right' as const, render: (v: number) => <Money kop={v} /> }] : []),
                      ]}
                    />
                  ),
                },
                {
                  key: 'equipment',
                  label: `Оборудование (${c.equipment.length})`,
                  children: (
                    <>
                      {edit && <Button icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => setModal({ kind: 'equipment' })}>Станция</Button>}
                      <List
                        dataSource={c.equipment}
                        locale={{ emptyText: 'Станций пока нет' }}
                        renderItem={(e) => {
                          const repairs = c.orders.filter((o) => o.equipmentId === e.id).length;
                          return (
                            <List.Item className="clickable" onClick={() => navigate(`/equipment/${e.id}`)} extra={<Tag>{repairs} заказ(ов)</Tag>}>
                              <List.Item.Meta
                                title={e.name}
                                description={
                                  <>
                                    {[e.manufacturer, e.model].filter(Boolean).join(' ')}
                                    {e.serialNumber && ` · № ${e.serialNumber}`}
                                    <div style={{ fontSize: 12 }}>
                                      {[e.pressureBar && `${Number(e.pressureBar)} бар`, e.flowLpm && `${Number(e.flowLpm)} л/мин`, e.motorPowerKw && `${Number(e.motorPowerKw)} кВт`, e.location].filter(Boolean).join(' · ')}
                                    </div>
                                  </>
                                }
                              />
                            </List.Item>
                          );
                        }}
                      />
                    </>
                  ),
                },
                {
                  key: 'contacts',
                  label: `Контакты (${c.contacts.length})`,
                  children: (
                    <>
                      {edit && <Button icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => setModal({ kind: 'contact' })}>Контакт</Button>}
                      <List
                        dataSource={c.contacts}
                        locale={{ emptyText: 'Контактных лиц нет' }}
                        renderItem={(ct) => (
                          <List.Item
                            actions={edit ? [
                              <Button key="e" size="small" type="text" icon={<EditOutlined />} onClick={() => setModal({ kind: 'contact', c: ct })} />,
                              <Popconfirm key="d" title="Удалить контакт?" onConfirm={() => removeContact.mutate(ct.id)}><Button size="small" type="text" danger>Удалить</Button></Popconfirm>,
                            ] : []}
                          >
                            <List.Item.Meta
                              title={<Space>{ct.fullName}{ct.isPrimary && <StarFilled style={{ color: '#faad14' }} />}</Space>}
                              description={<Space size={12} wrap>{ct.position}<Phone value={ct.phone} />{ct.email}</Space>}
                            />
                          </List.Item>
                        )}
                      />
                    </>
                  ),
                },
                {
                  key: 'leads',
                  label: `Заявки (${c.leads.length})`,
                  children: (
                    <List
                      dataSource={c.leads}
                      locale={{ emptyText: 'Заявок не было' }}
                      renderItem={(l) => (
                        <List.Item className="clickable" onClick={() => navigate(`/leads/${l.id}`)} extra={<Tag>{LEAD_STATUS_LABELS[l.status]}</Tag>}>
                          <List.Item.Meta title={<>{l.number} · {LEAD_CHANNEL_LABELS[l.channel]} · {fmtDate(l.createdAt)}</>} description={l.description} />
                        </List.Item>
                      )}
                    />
                  ),
                },
                { key: 'tasks', label: `Задачи (${tasks.data?.length ?? 0})`, children: <TaskList tasks={tasks.data ?? []} loading={tasks.isLoading} /> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card size="small" title="Сводка">
              <Row gutter={8}>
                <Col span={12}><Typography.Text type="secondary">Заказов</Typography.Text><div style={{ fontSize: 20, fontWeight: 600 }}>{c.orders.length}</div></Col>
                <Col span={12}><Typography.Text type="secondary">В работе</Typography.Text><div style={{ fontSize: 20, fontWeight: 600 }}>{openOrders.length}</div></Col>
                {finance && (
                  <Col span={24} style={{ marginTop: 8 }}>
                    <Typography.Text type="secondary">Сумма выполненных</Typography.Text>
                    <div style={{ fontSize: 18 }}><Money kop={c.orders.filter((o) => o.stage.kind === 'won').reduce((s, o) => s + (o.totalKop ?? 0), 0)} strong /></div>
                  </Col>
                )}
              </Row>
            </Card>
            <Card size="small" title="Реквизиты и условия">
              <Descriptions column={1} size="small">
                {legal && finance && <Descriptions.Item label="Юр. название">{c.legalName ?? '—'}</Descriptions.Item>}
                {legal && finance && <Descriptions.Item label="ИНН / КПП">{c.inn ?? '—'}{c.kpp ? ` / ${c.kpp}` : ''}</Descriptions.Item>}
                {legal && finance && c.legalAddress && <Descriptions.Item label="Юр. адрес">{c.legalAddress}</Descriptions.Item>}
                <Descriptions.Item label="Адрес">{c.address ?? '—'}</Descriptions.Item>
                {finance && <Descriptions.Item label="Оплата">{c.paymentTermsDays ? `отсрочка ${c.paymentTermsDays} дн.` : 'предоплата'}</Descriptions.Item>}
                <Descriptions.Item label="Источник">{c.source?.name ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Клиент с">{fmtDate(c.createdAt)}</Descriptions.Item>
                {c.type === 'person' && <Descriptions.Item label="Согласие на ПД">{c.pdConsentAt ? fmtDate(c.pdConsentAt) : <Typography.Text type="warning">не отмечено</Typography.Text>}</Descriptions.Item>}
              </Descriptions>
              {c.note && <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{c.note}</Typography.Paragraph>}
              {edit && (
                <Button size="small" type="link" style={{ paddingLeft: 0 }} onClick={() => archive.mutate(!c.archivedAt)}>
                  {c.archivedAt ? 'Вернуть из архива' : 'В архив'}
                </Button>
              )}
            </Card>
          </Space>
        </Col>
      </Row>
      {modal?.kind === 'edit' && <ClientFormModal open client={c} onClose={() => setModal(null)} />}
      {modal?.kind === 'equipment' && <EquipmentFormModal clientId={c.id} equipment={modal.eq} onClose={() => setModal(null)} />}
      {modal?.kind === 'contact' && <ContactModal clientId={c.id} contact={modal.c} onClose={() => setModal(null)} />}
    </>
  );
}
