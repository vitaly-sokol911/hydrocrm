import { ReloadOutlined } from '@ant-design/icons';
import { ORDER_TYPE_LABELS, PERMISSIONS, ROLE_CODES, ROLE_LABELS, userCreateSchema } from '@hydrocrm/shared';
import { App, Button, Card, Checkbox, Col, Form, Input, Modal, Popconfirm, Row, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtHours, fmtSmart } from '../../shared/format';
import { fieldErrors, useAction, useDictionaries, useUsers } from '../../shared/hooks';
import type { User } from '../../shared/types';
import { PageHeader, UserAvatar } from '../../shared/ui';

function UsersTab() {
  const { users } = useUsers();
  const { can, demoMode } = useAuth();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const manage = can(PERMISSIONS.usersManage) && !demoMode;
  const create = useAction((v: unknown) => api.post('/users', v), { invalidate: [['users']], success: 'Сотрудник добавлен', onSuccess: () => setOpen(false) });
  const toggle = useAction(({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/users/${id}`, { isActive }), { invalidate: [['users']] });
  return (
    <>
      {manage && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
          Добавить сотрудника
        </Button>
      )}
      {demoMode && <Typography.Paragraph type="secondary">В песочнице сотрудников добавлять нельзя.</Typography.Paragraph>}
      <Table<User>
        rowKey="id"
        size="middle"
        dataSource={users}
        pagination={false}
        scroll={{ x: 720 }}
        columns={[
          { title: 'Сотрудник', render: (_, u) => <div><UserAvatar userId={u.id} withName /><div className="muted" style={{ fontSize: 12, marginLeft: 30 }}>{u.position}</div></div> },
          { title: 'Email', dataIndex: 'email' },
          { title: 'Роли', render: (_, u) => u.roles.map((r) => <Tag key={r}>{ROLE_LABELS[r]}</Tag>) },
          { title: 'Был в системе', dataIndex: 'lastLoginAt', render: (v) => (v ? fmtSmart(v) : '—') },
          { title: 'Статус', render: (_, u) => (u.isActive ? <Tag color="green">активен</Tag> : <Tag>отключён</Tag>) },
          ...(manage
            ? [{
                title: '',
                render: (_: unknown, u: User) => (
                  <Popconfirm title={u.isActive ? 'Отключить доступ сотруднику?' : 'Вернуть доступ?'} onConfirm={() => toggle.mutate({ id: u.id, isActive: !u.isActive })}>
                    <Button size="small">{u.isActive ? 'Отключить' : 'Включить'}</Button>
                  </Popconfirm>
                ),
              }]
            : []),
        ]}
      />
      <Modal title="Новый сотрудник" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Добавить" confirmLoading={create.isPending} destroyOnClose>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => {
            const parsed = userCreateSchema.safeParse(v);
            if (!parsed.success) return form.setFields(parsed.error.issues.map((i) => ({ name: i.path as string[], errors: [i.message] })));
            create.mutate(parsed.data, { onError: (e) => form.setFields(fieldErrors(e)) });
          }}
        >
          <Form.Item name="fullName" label="Имя и фамилия" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="email" label="Email (логин)" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="position" label="Должность"><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="password" label="Временный пароль" extra="Сотрудник сменит его при первом входе" rules={[{ required: true, min: 8, message: 'Минимум 8 символов' }]}><Input.Password /></Form.Item>
          <Form.Item name="roles" label="Роли" rules={[{ required: true, message: 'Выберите роль' }]}>
            <Checkbox.Group options={ROLE_CODES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function PipelinesTab() {
  const dicts = useDictionaries();
  return (
    <Row gutter={[12, 12]}>
      {(dicts.pipelines ?? []).map((p) => (
        <Col xs={24} xl={12} key={p.id}>
          <Card size="small" title={ORDER_TYPE_LABELS[p.orderType]}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={p.stages}
              columns={[
                { title: 'Этап', render: (_, s) => <Space><span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color ?? '#999', display: 'inline-block' }} />{s.name}</Space> },
                { title: 'Для клиента', dataIndex: 'clientName', render: (v) => <span className="muted">{v}</span> },
                { title: 'Норма', dataIndex: 'normHours', width: 80, render: (v) => (v ? fmtHours(v) : '—') },
                { title: '', width: 120, render: (_, s) => <Space size={2}>{s.isProduction && <Tag color="purple">произв.</Tag>}{s.kind === 'won' && <Tag color="green">успех</Tag>}{s.kind === 'lost' && <Tag color="red">отказ</Tag>}</Space> },
              ]}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export default function SettingsPage() {
  const { demoMode } = useAuth();
  const { modal, message } = App.useApp();
  const reset = useAction(() => api.post('/demo/reset'), {
    onSuccess: () => {
      message.success('Песочница сброшена');
      setTimeout(() => window.location.assign(import.meta.env.BASE_URL), 600);
    },
  });
  return (
    <>
      <PageHeader
        title="Настройки"
        extra={
          demoMode && (
            <Button
              icon={<ReloadOutlined />}
              loading={reset.isPending}
              onClick={() => modal.confirm({ title: 'Сбросить песочницу?', content: 'Все изменения будут удалены, данные вернутся к исходным.', okText: 'Сбросить', onOk: () => reset.mutateAsync(undefined) })}
            >
              Сбросить песочницу
            </Button>
          )
        }
      />
      <Card>
        <Tabs
          items={[
            { key: 'users', label: 'Сотрудники', children: <UsersTab /> },
            { key: 'pipelines', label: 'Воронки и этапы', children: <PipelinesTab /> },
          ]}
        />
      </Card>
    </>
  );
}
