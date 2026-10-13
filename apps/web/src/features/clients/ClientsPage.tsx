import { PlusOutlined } from '@ant-design/icons';
import { CLIENT_TYPE_LABELS, CLIENT_TYPES, formatPhone, PERMISSIONS } from '@hydrocrm/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Input, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtDate } from '../../shared/format';
import { UserSelect } from '../../shared/selects';
import type { ClientListItem, Paged } from '../../shared/types';
import { Money, PageHeader, UserAvatar } from '../../shared/ui';
import { useCreate } from '../create/CreateProvider';

export default function ClientsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const create = useCreate();
  const [query, setQuery] = useState<{ q?: string; type?: string; managerId?: string; withOpenOrders?: boolean; archived?: boolean; page: number }>({ page: 1 });
  const list = useQuery({ queryKey: ['clients', query], queryFn: () => api.get<Paged<ClientListItem>>('/clients', { ...query, pageSize: 30 }), placeholderData: keepPreviousData });
  const set = (p: Partial<typeof query>) => setQuery((q) => ({ ...q, ...p, page: p.page ?? 1 }));
  return (
    <>
      <PageHeader
        title="Клиенты"
        subtitle={list.data ? `${list.data.total} в базе` : undefined}
        extra={
          can(PERMISSIONS.clientsEdit) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => create.open('client')}>
              Клиент
            </Button>
          )
        }
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Название, телефон, ИНН, серийный № станции" allowClear onSearch={(v) => set({ q: v || undefined })} style={{ width: 320 }} />
        <Select allowClear placeholder="Тип" style={{ width: 140 }} onChange={(v) => set({ type: v })} options={CLIENT_TYPES.map((t) => ({ value: t, label: CLIENT_TYPE_LABELS[t] }))} />
        <UserSelect role="manager" placeholder="Менеджер" style={{ width: 180 }} onChange={(v) => set({ managerId: v as string | undefined })} />
        <Checkbox onChange={(e) => set({ withOpenOrders: e.target.checked || undefined })}>С открытыми заказами</Checkbox>
        <Checkbox onChange={(e) => set({ archived: e.target.checked || undefined })}>Архив</Checkbox>
      </Space>
      <Table<ClientListItem>
        rowKey="id"
        size="middle"
        loading={list.isFetching}
        dataSource={list.data?.items}
        scroll={{ x: 900 }}
        rowClassName="clickable"
        onRow={(r) => ({ onClick: () => navigate(`/clients/${r.id}`) })}
        pagination={{ current: query.page, pageSize: 30, total: list.data?.total, onChange: (page) => setQuery((q) => ({ ...q, page })), showSizeChanger: false }}
        columns={[
          {
            title: 'Клиент',
            render: (_, c) => (
              <div>
                <b>{c.name}</b>
                <div>
                  <Tag bordered={false}>{CLIENT_TYPE_LABELS[c.type]}</Tag>
                  {c.tags.map((t) => (
                    <Tag key={t} color={t === 'ключевой' ? 'gold' : t === 'дилер' ? 'purple' : undefined}>
                      {t}
                    </Tag>
                  ))}
                </div>
              </div>
            ),
          },
          { title: 'Телефон', dataIndex: 'phone', width: 160, render: (v) => (v ? formatPhone(v) : '—') },
          { title: 'Менеджер', dataIndex: 'managerId', width: 180, render: (v) => <UserAvatar userId={v} withName size={20} /> },
          { title: 'Станций', dataIndex: 'equipmentCount', width: 90, align: 'center' },
          { title: 'Заказов', width: 100, align: 'center', render: (_, c) => <>{c.ordersCount}{c.openOrders > 0 && <Tag color="blue" style={{ marginLeft: 6 }}>{c.openOrders} в работе</Tag>}</> },
          ...(can(PERMISSIONS.clientsViewFinance) ? [{ title: 'Сумма заказов', dataIndex: 'ordersSumKop', width: 140, align: 'right' as const, render: (v: number) => <Money kop={v} /> }] : []),
          { title: 'Последний заказ', dataIndex: 'lastOrderAt', width: 140, render: (v) => fmtDate(v) },
        ]}
      />
    </>
  );
}
