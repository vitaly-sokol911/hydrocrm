import { CheckCircleOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { APPROVAL_METHOD_LABELS, APPROVAL_METHODS, ORDER_ITEM_KIND_LABELS, ORDER_ITEM_KINDS, PERMISSIONS, rubToKop } from '@hydrocrm/shared';
import { Alert, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtDateTime } from '../../shared/format';
import { useAction, useUsers } from '../../shared/hooks';
import type { OrderDetail, OrderItem } from '../../shared/types';
import { Money } from '../../shared/ui';

const UNITS = ['шт', 'компл', 'ч', 'л', 'м', 'км'];

function ItemForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [form] = Form.useForm();
  const { can } = useAuth();
  const full = can(PERMISSIONS.ordersEditEstimate);
  const add = useAction(
    (v: { kind: string; name: string; quantity: number; unit: string; price?: number; cost?: number; discountPercent?: number }) =>
      api.post(`/orders/${order.id}/items`, {
        kind: v.kind,
        name: v.name,
        quantity: v.quantity,
        unit: v.unit,
        priceKop: rubToKop(v.price ?? 0),
        costKop: rubToKop(v.cost ?? 0),
        discountPercent: v.discountPercent ?? 0,
      }),
    {
      invalidate: [['order', order.id], ['comments', order.id]],
      success: full ? 'Позиция добавлена' : 'Предложение отправлено менеджеру',
      onSuccess: () => {
        form.resetFields(['name', 'quantity', 'price', 'cost', 'discountPercent']);
        onDone();
      },
    },
  );
  return (
    <Card size="small" style={{ marginBottom: 12, background: 'var(--kanban-col)' }}>
      <Form form={form} layout="vertical" initialValues={{ kind: 'part', quantity: 1, unit: 'шт' }} onFinish={(v) => add.mutate(v)}>
        <Row gutter={8}>
          <Col xs={12} md={4}>
            <Form.Item name="kind" label="Вид">
              <Select options={ORDER_ITEM_KINDS.map((k) => ({ value: k, label: ORDER_ITEM_KIND_LABELS[k] }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={full ? 8 : 12} style={{ order: -1 }} className="item-name">
            <Form.Item name="name" label="Наименование" rules={[{ required: true, message: 'Что за работа или запчасть' }]}>
              <Input placeholder="Например: ремкомплект насоса A10VSO28" autoFocus />
            </Form.Item>
          </Col>
          <Col xs={6} md={3}>
            <Form.Item name="quantity" label="Кол-во" rules={[{ required: true }]}>
              <InputNumber min={0.001} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={6} md={3}>
            <Form.Item name="unit" label="Ед.">
              <Select options={UNITS.map((u) => ({ value: u }))} />
            </Form.Item>
          </Col>
          {full && (
            <>
              <Col xs={12} md={3}>
                <Form.Item name="price" label="Цена, ₽">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={3}>
                <Form.Item name="cost" label="Себест., ₽">
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </>
          )}
        </Row>
        <Space>
          <Button type="primary" htmlType="submit" loading={add.isPending} icon={<PlusOutlined />}>
            {full ? 'Добавить' : 'Предложить'}
          </Button>
          <Button onClick={onDone}>Отмена</Button>
          {!full && <Typography.Text type="secondary">Цену проставит менеджер</Typography.Text>}
        </Space>
      </Form>
    </Card>
  );
}

function ApproveModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const [form] = Form.useForm();
  const approve = useAction((v: unknown) => api.post(`/orders/${order.id}/approve-estimate`, v), {
    invalidate: [['order', order.id], ['comments', order.id], ['orders']],
    success: 'Согласование зафиксировано',
    onSuccess: onClose,
  });
  return (
    <Modal title="Клиент согласовал смету" open onCancel={onClose} okText="Зафиксировать" onOk={() => form.submit()} confirmLoading={approve.isPending}>
      <Typography.Paragraph>
        Сумма: <Money kop={order.totals?.totalKop} strong />. После согласования изменения сметы будут помечены как доп. работы.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ method: 'phone', approvedByName: order.contact?.fullName ?? order.client.name }} onFinish={(v) => approve.mutate(v)}>
        <Form.Item name="method" label="Как согласовали">
          <Select options={APPROVAL_METHODS.filter((m) => m !== 'status_page').map((m) => ({ value: m, label: APPROVAL_METHOD_LABELS[m] }))} />
        </Form.Item>
        <Form.Item name="approvedByName" label="Кто согласовал" rules={[{ required: true, message: 'Укажите, кто согласовал' }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function OrderEstimate({ order }: { order: OrderDetail }) {
  const { can } = useAuth();
  const { name } = useUsers();
  const [adding, setAdding] = useState(false);
  const [approving, setApproving] = useState(false);
  const [discount, setDiscount] = useState<number | null>(null);
  const full = can(PERMISSIONS.ordersEditEstimate);
  const canPropose = can(PERMISSIONS.ordersProposeItems);
  const open = order.stage.kind === 'open';
  const inv = [['order', order.id], ['orders']];
  const update = useAction(({ id, ...body }: { id: string } & Partial<{ status: string; priceKop: number; costKop: number; quantity: number; discountPercent: number }>) => api.patch(`/order-items/${id}`, body), { invalidate: inv });
  const remove = useAction((id: string) => api.delete(`/order-items/${id}`), { invalidate: inv });
  const saveDiscount = useAction((v: number) => api.patch(`/orders/${order.id}`, { version: order.version, discountPercent: v }), {
    invalidate: inv,
    success: 'Скидка сохранена',
    onSuccess: () => setDiscount(null),
  });
  const vis = order.visibility;
  const proposed = order.items.filter((i) => i.status === 'proposed');
  const extras = order.items.filter((i) => i.isExtra && i.status === 'approved');
  const lastApproval = order.approvals[0];

  const price = (i: OrderItem) =>
    full && open ? (
      <InputNumber
        size="small"
        min={0}
        defaultValue={i.priceKop !== null ? i.priceKop / 100 : undefined}
        style={{ width: 110 }}
        onBlur={(e) => {
          const v = rubToKop(Number(e.target.value.replace(/\s/g, '').replace(',', '.')) || 0);
          if (v !== i.priceKop) update.mutate({ id: i.id, priceKop: v });
        }}
      />
    ) : (
      <Money kop={i.priceKop} />
    );

  return (
    <div>
      {!!proposed.length && full && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Мастер предложил ${proposed.length} поз. — проставьте цены и утвердите или отклоните`}
        />
      )}
      {!!extras.length && lastApproval && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Смета изменилась после согласования: доп. работы нужно согласовать с клиентом ещё раз" />
      )}
      {open && (full || canPropose) && !adding && (
        <Button icon={<PlusOutlined />} onClick={() => setAdding(true)} style={{ marginBottom: 12 }}>
          {full ? 'Добавить позицию' : 'Предложить работу или запчасть'}
        </Button>
      )}
      {adding && <ItemForm order={order} onDone={() => setAdding(false)} />}

      <Table<OrderItem>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={order.items}
        scroll={{ x: 'max-content' }}
        rowClassName={(r) => (r.status === 'declined' ? 'muted' : '')}
        columns={[
          {
            title: 'Наименование',
            render: (_, i) => (
              <div>
                <span style={{ textDecoration: i.status === 'declined' ? 'line-through' : undefined }}>{i.name}</span>
                <div style={{ fontSize: 12 }}>
                  <Tag bordered={false}>{ORDER_ITEM_KIND_LABELS[i.kind]}</Tag>
                  {i.status === 'proposed' && <Tag color="blue">предложил {name(i.proposedById)}</Tag>}
                  {i.status === 'declined' && <Tag>отказ клиента</Tag>}
                  {i.isExtra && i.status === 'approved' && <Tag color="orange">доп. работы</Tag>}
                </div>
              </div>
            ),
          },
          { title: 'Кол-во', width: 90, render: (_, i) => `${i.quantity} ${i.unit}` },
          ...(vis.prices
            ? [
                { title: 'Цена', width: 130, render: (_: unknown, i: OrderItem) => price(i) },
                { title: 'Сумма', width: 120, align: 'right' as const, render: (_: unknown, i: OrderItem) => <Money kop={i.sumKop} /> },
              ]
            : []),
          ...(vis.margin ? [{ title: 'Себест.', width: 110, align: 'right' as const, render: (_: unknown, i: OrderItem) => <span className="muted"><Money kop={i.costKop !== null ? i.costKop * i.quantity : null} /></span> }] : []),
          ...(full && open
            ? [
                {
                  title: '',
                  width: 110,
                  render: (_: unknown, i: OrderItem) => (
                    <Space size={0}>
                      {i.status !== 'approved' && (
                        <Button size="small" type="text" icon={<CheckOutlined />} title="В смету" onClick={() => update.mutate({ id: i.id, status: 'approved' })} />
                      )}
                      {i.status !== 'declined' && (
                        <Button size="small" type="text" icon={<CloseOutlined />} title="Клиент отказался" onClick={() => update.mutate({ id: i.id, status: 'declined' })} />
                      )}
                      <Popconfirm title="Удалить позицию?" onConfirm={() => remove.mutate(i.id)} okText="Удалить" cancelText="Отмена">
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      {order.totals && (
        <Row gutter={16} style={{ marginTop: 16 }} justify="end">
          <Col xs={24} md={12} lg={10}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Работы">
                <Money kop={order.totals.worksKop} />
              </Descriptions.Item>
              <Descriptions.Item label="Запчасти">
                <Money kop={order.totals.partsKop} />
              </Descriptions.Item>
              {order.totals.servicesKop > 0 && (
                <Descriptions.Item label="Услуги">
                  <Money kop={order.totals.servicesKop} />
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Скидка на заказ">
                {full && open ? (
                  <Space.Compact size="small">
                    <InputNumber
                      size="small"
                      min={0}
                      max={100}
                      value={discount ?? order.discountPercent}
                      onChange={(v) => setDiscount(v ?? 0)}
                      addonAfter="%"
                      style={{ width: 100 }}
                    />
                    {discount !== null && discount !== order.discountPercent && (
                      <Button size="small" type="primary" onClick={() => saveDiscount.mutate(discount)} loading={saveDiscount.isPending}>
                        ОК
                      </Button>
                    )}
                  </Space.Compact>
                ) : (
                  `${order.discountPercent}%`
                )}
                {order.totals.orderDiscountKop > 0 && (
                  <span className="muted" style={{ marginLeft: 8 }}>
                    −<Money kop={order.totals.orderDiscountKop} />
                  </span>
                )}
              </Descriptions.Item>
              <Descriptions.Item label={<b>Итого</b>}>
                <Money kop={order.totals.totalKop} strong />
              </Descriptions.Item>
              {vis.margin && order.totals.marginKop !== null && (
                <Descriptions.Item label="Маржа">
                  <Typography.Text type={order.totals.marginKop < 0 ? 'danger' : 'success'}>
                    <Money kop={order.totals.marginKop} /> · {order.totals.marginPercent}%
                  </Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>
            {order.discountPercent > order.settings.discountLimitPercent && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Скидка выше {order.settings.discountLimitPercent}% требует подтверждения руководителя
              </Typography.Text>
            )}
          </Col>
        </Row>
      )}

      <div style={{ marginTop: 16 }}>
        {lastApproval ? (
          <Space wrap>
            <Tag icon={<CheckCircleOutlined />} color={order.estimateApproved ? 'success' : 'warning'}>
              {order.estimateApproved ? 'Смета согласована' : 'Согласована предыдущая версия'}
            </Tag>
            <Typography.Text type="secondary">
              v{lastApproval.version}: {lastApproval.approvedByName}, {APPROVAL_METHOD_LABELS[lastApproval.method].toLowerCase()}, {fmtDateTime(lastApproval.approvedAt)}
              {lastApproval.totalKop !== null && <> · <Money kop={lastApproval.totalKop} /></>}
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">Смета ещё не согласована с клиентом</Typography.Text>
        )}
        {full && open && !order.estimateApproved && order.items.some((i) => i.status === 'approved') && (
          <Button type="primary" icon={<CheckCircleOutlined />} style={{ marginLeft: 12 }} onClick={() => setApproving(true)} disabled={!!proposed.length}>
            Клиент согласовал
          </Button>
        )}
      </div>
      {approving && <ApproveModal order={order} onClose={() => setApproving(false)} />}
    </div>
  );
}
