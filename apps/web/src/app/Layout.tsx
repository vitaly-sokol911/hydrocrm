import {
  BellOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  InboxOutlined,
  LogoutOutlined,
  MenuOutlined,
  MessageOutlined,
  MoonOutlined,
  PlusOutlined,
  ProfileOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { PERMISSIONS, ROLE_LABELS, type RoleCode } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { AutoComplete, Badge, Button, Drawer, Dropdown, Grid, Input, Layout, List, Menu, Popover, Segmented, Space, Typography } from 'antd';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../shared/api';
import { useAuth } from '../shared/auth';
import { fmtSmart } from '../shared/format';
import { useAction } from '../shared/hooks';
import type { ChatChannel, ClientListItem, Notification, OrderListItem, Paged } from '../shared/types';
import { UserAvatar } from '../shared/ui';
import { CreateProvider, useCreate } from '../features/create/CreateProvider';
import { DemoGuide } from '../features/demo/DemoGuide';
import { AuthorLink } from '../shared/author';
import { useThemeMode } from './theme-mode';

const { Sider, Header, Content } = Layout;

function useMenu() {
  const { can } = useAuth();
  return useMemo(
    () =>
      [
        { key: '/', icon: <DashboardOutlined />, label: 'Главная', show: true },
        { key: '/leads', icon: <InboxOutlined />, label: 'Заявки', show: can(PERMISSIONS.leadsView) },
        { key: '/orders', icon: <ProfileOutlined />, label: 'Заказы', show: can(PERMISSIONS.ordersView) },
        { key: '/visits', icon: <CalendarOutlined />, label: 'Выезды', show: can(PERMISSIONS.visitsView) },
        { key: '/clients', icon: <TeamOutlined />, label: 'Клиенты', show: can(PERMISSIONS.clientsViewAll) },
        { key: '/tasks', icon: <CheckSquareOutlined />, label: 'Задачи', show: true },
        { key: '/chat', icon: <MessageOutlined />, label: 'Чат', show: true },
        { key: '/settings', icon: <SettingOutlined />, label: 'Настройки', show: can(PERMISSIONS.settingsManage) },
      ].filter((i) => i.show),
    [can],
  );
}

function GlobalSearch({ onDone }: { onDone?: () => void }) {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { can } = useAuth();
  const enabled = q.trim().length >= 2;
  const orders = useQuery({
    queryKey: ['search', 'orders', q],
    queryFn: () => api.get<Paged<OrderListItem>>('/orders', { q, pageSize: 6 }),
    enabled,
  });
  const clients = useQuery({
    queryKey: ['search', 'clients', q],
    queryFn: () => api.get<Paged<ClientListItem>>('/clients', { q, pageSize: 6 }),
    enabled: enabled && can(PERMISSIONS.clientsViewAll),
  });
  const options = [
    ...(orders.data?.items.length
      ? [
          {
            label: 'Заказы',
            options: orders.data.items.map((o) => ({
              value: `/orders/${o.id}`,
              label: (
                <div>
                  <b>{o.number}</b> · {o.client.name}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {o.title}
                  </div>
                </div>
              ),
            })),
          },
        ]
      : []),
    ...(clients.data?.items.length
      ? [{ label: 'Клиенты', options: clients.data.items.map((c) => ({ value: `/clients/${c.id}`, label: c.name })) }]
      : []),
  ];
  return (
    <AutoComplete
      value={q}
      options={options}
      onSearch={setQ}
      onSelect={(v: string) => {
        navigate(v);
        setQ('');
        onDone?.();
      }}
      style={{ width: '100%', maxWidth: 420 }}
      notFoundContent={enabled && !orders.isFetching ? 'Ничего не найдено' : null}
    >
      <Input prefix={<SearchOutlined />} placeholder="Поиск: заказ, клиент, телефон, серийный номер" allowClear />
    </AutoComplete>
  );
}

function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'), refetchInterval: 60_000 });
  const read = useAction((ids?: string[]) => api.post('/notifications/read', { ids }), { invalidate: [['notifications']] });
  const content = (
    <div style={{ width: 360, maxWidth: '86vw' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <Typography.Text strong>Уведомления</Typography.Text>
        {!!q.data?.unread && (
          <Button type="link" size="small" onClick={() => read.mutate(undefined)}>
            Прочитать все
          </Button>
        )}
      </div>
      <List
        size="small"
        dataSource={q.data?.items ?? []}
        locale={{ emptyText: 'Пока ничего нет' }}
        style={{ maxHeight: 420, overflowY: 'auto' }}
        renderItem={(n) => (
          <List.Item
            className="clickable"
            style={{ opacity: n.readAt ? 0.6 : 1, paddingInline: 4 }}
            onClick={() => {
              if (!n.readAt) read.mutate([n.id]);
              if (n.link) navigate(n.link);
              setOpen(false);
            }}
          >
            <List.Item.Meta
              avatar={<Badge dot={!n.readAt} offset={[-2, 4]}><BellOutlined style={{ fontSize: 16, marginTop: 4 }} /></Badge>}
              title={<span style={{ fontSize: 13 }}>{n.title}</span>}
              description={
                <>
                  {n.body && <div style={{ fontSize: 12 }}>{n.body}</div>}
                  <div style={{ fontSize: 11 }}>{fmtSmart(n.createdAt)}</div>
                </>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomRight">
      <Badge count={q.data?.unread ?? 0} size="small">
        <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} aria-label="Уведомления" />
      </Badge>
    </Popover>
  );
}

function ChatBadge() {
  const q = useQuery({ queryKey: ['chat', 'channels'], queryFn: () => api.get<ChatChannel[]>('/chat/channels') });
  const unread = (q.data ?? []).reduce((s, c) => s + c.unread, 0);
  return (
    <Link to="/chat">
      <Badge count={unread} size="small">
        <Button type="text" icon={<MessageOutlined style={{ fontSize: 18 }} />} aria-label="Чат" />
      </Badge>
    </Link>
  );
}

function CreateButton() {
  const { can } = useAuth();
  const create = useCreate();
  const items = [
    can(PERMISSIONS.leadsEdit) && { key: 'lead', label: 'Заявка' },
    can(PERMISSIONS.ordersCreate) && { key: 'order', label: 'Заказ' },
    can(PERMISSIONS.clientsEdit) && { key: 'client', label: 'Клиент' },
    { key: 'task', label: 'Задача' },
  ].filter(Boolean) as { key: 'lead' | 'order' | 'client' | 'task'; label: string }[];
  return (
    <Dropdown menu={{ items, onClick: ({ key }) => create.open(key as 'lead') }} trigger={['click']}>
      <Button type="primary" icon={<PlusOutlined />}>
        <span className="hide-mobile">Создать</span>
      </Button>
    </Dropdown>
  );
}

const DEMO_ROLES: RoleCode[] = ['director', 'manager', 'master', 'accountant'];

function UserMenu() {
  const { me, logout, demoMode, demoLogin } = useAuth();
  const { mode, setMode } = useThemeMode();
  const navigate = useNavigate();
  if (!me) return null;
  const switchRole = async (r: RoleCode) => {
    await demoLogin(r);
    navigate('/');
  };
  return (
    <Dropdown
      trigger={['click']}
      dropdownRender={() => (
        <div className="ant-dropdown-menu" style={{ padding: 12, width: 260 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Typography.Text strong>{me.user.fullName}</Typography.Text>
              <div className="muted" style={{ fontSize: 12 }}>
                {me.user.roles.map((r) => ROLE_LABELS[r]).join(', ')} · {me.company.name}
              </div>
            </div>
            <Segmented
              block
              size="small"
              value={mode}
              onChange={(v) => setMode(v as typeof mode)}
              options={[
                { value: 'light', icon: <SunOutlined />, label: 'Светлая' },
                { value: 'dark', icon: <MoonOutlined />, label: 'Тёмная' },
                { value: 'system', label: 'Авто' },
              ]}
            />
            {demoMode && (
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Сменить роль</div>
                <Space wrap size={6}>
                  {DEMO_ROLES.filter((r) => !me.user.roles.includes(r)).map((r) => (
                    <Button key={r} size="small" onClick={() => switchRole(r)}>
                      {ROLE_LABELS[r]}
                    </Button>
                  ))}
                </Space>
              </div>
            )}
            <Button block icon={<LogoutOutlined />} onClick={logout}>
              Выйти
            </Button>
          </Space>
        </div>
      )}
    >
      <Button type="text" style={{ paddingInline: 4, height: 40 }}>
        <UserAvatar userId={me.user.id} size={30} />
      </Button>
    </Dropdown>
  );
}

function MobileNav() {
  const { can } = useAuth();
  const items = [
    { to: '/', icon: <DashboardOutlined />, label: 'Главная' },
    { to: '/orders', icon: <ProfileOutlined />, label: 'Заказы' },
    can(PERMISSIONS.visitsView) && { to: '/visits', icon: <CalendarOutlined />, label: 'Выезды' },
    can(PERMISSIONS.leadsView) && { to: '/leads', icon: <InboxOutlined />, label: 'Заявки' },
    { to: '/chat', icon: <MessageOutlined />, label: 'Чат' },
  ].filter(Boolean) as { to: string; icon: ReactNode; label: string }[];
  return (
    <nav className="mobile-nav">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/'}>
          {i.icon}
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const menu = useMenu();
  const location = useLocation();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const selected = menu.find((m) => m.key !== '/' && location.pathname.startsWith(m.key))?.key ?? (location.pathname === '/' ? '/' : '');

  const menuEl = (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selected]}
      items={menu.map(({ key, icon, label }) => ({ key, icon, label }))}
      onClick={({ key }) => {
        navigate(key);
        setDrawer(false);
      }}
      style={{ borderInlineEnd: 0, padding: '4px 8px' }}
    />
  );
  const brand = (
    <div className="brand">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
      {(!collapsed || mobile) && (
        <div>
          ГидроCRM
          <small>{me?.company.name}</small>
        </div>
      )}
    </div>
  );

  return (
    <CreateProvider>
      <Layout style={{ minHeight: '100vh' }}>
        {!mobile && (
          <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={228} style={{ position: 'sticky', top: 0, height: '100vh' }}>
            {brand}
            {menuEl}
            {!collapsed && <AuthorLink compact style={{ position: 'absolute', bottom: 56, left: 8, right: 8 }} />}
          </Sider>
        )}
        <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" width={260} styles={{ body: { padding: 0, background: '#10233f' }, header: { display: 'none' } }}>
          {brand}
          {menuEl}
        </Drawer>
        <Layout>
          <Header style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 50, borderBottom: '1px solid var(--line)' }}>
            {mobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawer(true)} aria-label="Меню" />}
            <div style={{ flex: 1, minWidth: 0 }}>{mobile ? null : <GlobalSearch />}</div>
            <Space size={4}>
              {mobile && (
                <Popover trigger="click" content={<div style={{ width: '80vw' }}><GlobalSearch /></div>} placement="bottomRight">
                  <Button type="text" icon={<SearchOutlined style={{ fontSize: 18 }} />} />
                </Popover>
              )}
              <CreateButton />
              <ChatBadge />
              <NotificationsBell />
              <UserMenu />
            </Space>
          </Header>
          <Content className="app-content">{children}</Content>
        </Layout>
        {mobile && <MobileNav />}
        <DemoGuide />
      </Layout>
    </CreateProvider>
  );
}
