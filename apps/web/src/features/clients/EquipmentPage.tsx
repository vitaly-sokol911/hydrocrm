import { ArrowLeftOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { PERMISSIONS, type OrderType } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Descriptions, Result, Row, Skeleton, Space, Tag, Timeline, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtDate } from '../../shared/format';
import type { Equipment } from '../../shared/types';
import { Money, OrderTypeTag, StageTag } from '../../shared/ui';
import { useCreate } from '../create/CreateProvider';
import { EquipmentFormModal } from './ClientPage';

interface EquipmentDetail extends Equipment {
  client: { id: string; name: string };
  orders: {
    id: string;
    number: string;
    type: OrderType;
    title: string;
    createdAt: string;
    finishedAt: string | null;
    isWarrantyCase: boolean;
    totalKop: number | null;
    stage: { name: string; kind: string; color: string | null };
    items: { name: string; quantity: string }[];
  }[];
}

/** КЛН-41: карточка станции с историей всех ремонтов и заменённых запчастей. */
export default function EquipmentPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const create = useCreate();
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['equipment', id], queryFn: () => api.get<EquipmentDetail>(`/equipment/${id}`) });
  if (q.isError) return <Result status="404" title="Оборудование не найдено" />;
  const e = q.data;
  if (!e) return <Skeleton active />;
  const n = (v: string | null) => (v ? Number(v) : null);
  return (
    <>
      <Link to={`/clients/${e.client.id}`} className="muted">
        <ArrowLeftOutlined /> {e.client.name}
      </Link>
      <div className="page-header" style={{ marginTop: 8 }}>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>{e.name}</Typography.Title>
          <Typography.Text type="secondary">
            {[e.manufacturer, e.model].filter(Boolean).join(' ')}
            {e.serialNumber && ` · серийный № ${e.serialNumber}`}
          </Typography.Text>
        </div>
        <div className="page-header-extra">
          {can(PERMISSIONS.ordersCreate) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => create.open('order', { order: { clientId: e.client.id, clientName: e.client.name, equipmentId: e.id } })}>
              Заказ на ремонт
            </Button>
          )}
          {can(PERMISSIONS.clientsEdit) && <Button icon={<EditOutlined />} onClick={() => setEdit(true)}>Изменить</Button>}
        </div>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card size="small" title="Параметры">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Год выпуска">{e.year ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Рабочее давление">{n(e.pressureBar) ? `${n(e.pressureBar)} бар` : '—'}</Descriptions.Item>
              <Descriptions.Item label="Расход">{n(e.flowLpm) ? `${n(e.flowLpm)} л/мин` : '—'}</Descriptions.Item>
              <Descriptions.Item label="Объём бака">{n(e.tankVolumeL) ? `${n(e.tankVolumeL)} л` : '—'}</Descriptions.Item>
              <Descriptions.Item label="Мощность двигателя">{n(e.motorPowerKw) ? `${n(e.motorPowerKw)} кВт` : '—'}</Descriptions.Item>
              <Descriptions.Item label="Напряжение">{e.voltage ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Где установлена">{e.location ?? '—'}</Descriptions.Item>
            </Descriptions>
            {e.note && <Typography.Paragraph type="secondary">{e.note}</Typography.Paragraph>}
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card size="small" title={`История заказов (${e.orders.length})`}>
            {e.orders.length ? (
              <Timeline
                items={e.orders.map((o) => ({
                  color: o.stage.kind === 'won' ? 'green' : o.stage.kind === 'lost' ? 'gray' : 'blue',
                  children: (
                    <div>
                      <Space wrap>
                        <Link to={`/orders/${o.id}`}><b>{o.number}</b></Link>
                        <span className="muted">{fmtDate(o.createdAt)}</span>
                        <OrderTypeTag type={o.type} />
                        <StageTag stage={o.stage} />
                        {o.isWarrantyCase && <Tag icon={<SafetyCertificateOutlined />} color="cyan">гарантия</Tag>}
                        {o.totalKop !== null && <Money kop={o.totalKop} />}
                      </Space>
                      <div>{o.title}</div>
                      {!!o.items.length && <div className="muted" style={{ fontSize: 12.5 }}>Запчасти: {o.items.map((i) => `${i.name}${Number(i.quantity) > 1 ? ` × ${Number(i.quantity)}` : ''}`).join(', ')}</div>}
                    </div>
                  ),
                }))}
              />
            ) : (
              <Typography.Text type="secondary">Заказов по этой станции ещё не было</Typography.Text>
            )}
          </Card>
        </Col>
      </Row>
      {edit && <EquipmentFormModal clientId={e.client.id} equipment={e} onClose={() => setEdit(false)} />}
    </>
  );
}
