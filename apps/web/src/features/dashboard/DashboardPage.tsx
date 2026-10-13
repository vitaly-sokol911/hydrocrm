import { ClockCircleOutlined, EnvironmentOutlined, FireOutlined, InboxOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { LEAD_CHANNEL_LABELS, ORDER_TYPE_LABELS, PERMISSIONS, type LeadChannel, type OrderType } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Col, List, Progress, Row, Skeleton, Space, Tag, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtHours, fmtSmart, fmtTime } from '../../shared/format';
import { useUsers } from '../../shared/hooks';
import { Avatars, EmptyState, Money, PageHeader, UserAvatar } from '../../shared/ui';
import { useCreate } from '../create/CreateProvider';

interface Dashboard {
  leads: null | {
    today: number;
    week: number;
    overdue: number;
    latest: { id: string; number: string; status: string; channel: LeadChannel; contactName: string | null; description: string; responseDueAt: string; firstResponseAt: string | null; createdAt: string; client: { name: string } | null }[];
  };
  orders: {
    open: number;
    overdue: number;
    stuck: { id: string; number: string; title: string; type: OrderType; managerId: string | null; hoursOnStage: number; client: { name: string }; stage: { name: string; color: string | null } }[];
    stuckCount: number;
    byStage: { type: OrderType; code: string; name: string; color: string | null; count: number }[];
    mine: { id: string; number: string; title: string; type: OrderType; client: { name: string }; stage: { name: string; color: string | null }; plannedFinishAt: string | null }[];
    ready: number;
    estimate: number;
  };
  visitsToday: { id: string; status: string; plannedStartAt: string; address: string; assignees: { userId: string }[]; order: { id: string; number: string; client: { name: string } } }[];
  tasks: { id: string; title: string; dueAt: string | null; priority: string; order: { id: string; number: string } | null }[];
  overdueTasksByUser: { userId: string; count: number }[];
  money: null | { inWorkKop: number; doneMonthKop: number; doneMonthCount: number; marginMonthKop: number | null };
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

export default function DashboardPage() {
  const { me, can, hasRole } = useAuth();
  const { name } = useUsers();
  const navigate = useNavigate();
  const create = useCreate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard'), refetchInterval: 60_000 });
  const d = q.data;
  const firstName = me?.user.fullName.split(' ')[0];
  const isDirector = hasRole('director');

  if (!d) return <Skeleton active paragraph={{ rows: 10 }} />;

  const tile = (label: string, value: number, opts: { to?: string; tone?: 'danger' | 'warn' | 'ok'; icon?: React.ReactNode; hint?: string } = {}) => (
    <div
      className={`tile ${opts.to ? 'clickable' : ''} ${value && opts.tone ? opts.tone : ''}`}
      onClick={opts.to ? () => navigate(opts.to!) : undefined}
      role={opts.to ? 'link' : undefined}
      tabIndex={opts.to ? 0 : undefined}
      onKeyDown={(e) => opts.to && e.key === 'Enter' && navigate(opts.to)}
    >
      <span className="label">
        {opts.icon}
        {label}
      </span>
      <span className="value">{value}</span>
      {opts.hint && <span className="hint">{opts.hint}</span>}
    </div>
  );

  const types = [...new Set(d.orders.byStage.map((s) => s.type))];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        subtitle={isDirector ? 'Состояние сервиса на сейчас' : 'Ваши дела на сегодня'}
        extra={
          can(PERMISSIONS.leadsEdit) && (
            <Button icon={<PlusOutlined />} onClick={() => create.open('lead')}>
              Заявка
            </Button>
          )
        }
      />

      <div className="bento">
        {d.money ? (
          <div className="tile hero">
            <span className="label">Выручка за месяц · {d.money.doneMonthCount} {plural(d.money.doneMonthCount, 'заказ', 'заказа', 'заказов')}</span>
            <span className="value">
              <Money kop={d.money.doneMonthKop} />
            </span>
            {d.money.marginMonthKop !== null && d.money.doneMonthKop > 0 && (
              <>
                <div className="bar">
                  <span style={{ width: `${Math.max(0, Math.min(100, (d.money.marginMonthKop / d.money.doneMonthKop) * 100))}%` }} />
                </div>
                <span className="hint">
                  Маржа <Money kop={d.money.marginMonthKop} /> · {Math.round((d.money.marginMonthKop / d.money.doneMonthKop) * 100)}%
                </span>
              </>
            )}
            <span className="hint">
              В работе заказов на <Money kop={d.money.inWorkKop} />
            </span>
          </div>
        ) : (
          <div className="tile hero clickable" onClick={() => navigate('/orders?mine=true&view=table')}>
            <span className="label">Мои заказы в работе</span>
            <span className="value">{d.orders.mine.length}</span>
            <span className="hint">
              Готовы к выдаче: {d.orders.ready} · на согласовании: {d.orders.estimate}
            </span>
          </div>
        )}
        {d.leads && tile('Новые заявки сегодня', d.leads.today, { to: '/leads', icon: <InboxOutlined />, hint: `за неделю ${d.leads.week}` })}
        {d.leads && tile('Заявки без ответа', d.leads.overdue, { to: '/leads?overdue=true', tone: 'danger', icon: <WarningOutlined />, hint: 'срок реакции истёк' })}
        {tile('Заказов в работе', d.orders.open, { to: '/orders' })}
        {tile('Сметы на согласовании', d.orders.estimate, { to: '/orders?view=table&stageCode=estimate', tone: 'warn' })}
        {tile('Просрочен срок', d.orders.overdue, { to: '/orders?view=table&overdue=true', tone: 'warn', icon: <ClockCircleOutlined /> })}
        {tile('Без движения', d.orders.stuckCount, { to: '/orders?view=table&stuck=true', tone: 'danger', icon: <FireOutlined />, hint: 'дольше нормы на этапе' })}
        {tile('Готовы к выдаче', d.orders.ready, { to: '/orders?view=table&stageCode=ready', tone: 'ok' })}
        {d.leads && tile('Выезды сегодня', d.visitsToday.length, { to: '/visits' })}
      </div>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} xl={isDirector ? 14 : 12}>
          {isDirector ? (
            <Card title={<Space><FireOutlined style={{ color: '#d9363e' }} />Застрявшие заказы</Space>} size="small" extra={<Link to="/orders?view=table&stuck=true">Все {d.orders.stuckCount}</Link>}>
              <List
                dataSource={d.orders.stuck}
                locale={{ emptyText: <EmptyState text="Все заказы двигаются по плану" /> }}
                renderItem={(o) => (
                  <List.Item className="clickable" onClick={() => navigate(`/orders/${o.id}`)} extra={<Tag color="red">{fmtHours(o.hoursOnStage)}</Tag>}>
                    <List.Item.Meta
                      title={
                        <Space size={6} wrap>
                          <b>{o.number}</b>
                          <Tag color={o.stage.color ?? undefined} style={{ marginInlineEnd: 0 }}>
                            {o.stage.name}
                          </Tag>
                        </Space>
                      }
                      description={`${o.client.name} · ${o.title} · ${name(o.managerId)}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
          ) : (
            <Card title="Мои заказы" size="small" extra={<Link to="/orders?mine=true&view=table">Все</Link>}>
              <List
                dataSource={d.orders.mine}
                locale={{ emptyText: <EmptyState text="Открытых заказов нет" /> }}
                renderItem={(o) => (
                  <List.Item className="clickable" onClick={() => navigate(`/orders/${o.id}`)} extra={<Tag color={o.stage.color ?? undefined}>{o.stage.name}</Tag>}>
                    <List.Item.Meta title={<><b>{o.number}</b> · {o.client.name}</>} description={o.title} />
                  </List.Item>
                )}
              />
            </Card>
          )}
        </Col>

        <Col xs={24} xl={isDirector ? 10 : 12}>
          <Card title="Мои задачи на сегодня" size="small" extra={<Link to="/tasks">Все задачи</Link>}>
            <List
              dataSource={d.tasks}
              locale={{ emptyText: <EmptyState text="На сегодня задач нет" /> }}
              renderItem={(t) => {
                const overdue = t.dueAt && new Date(t.dueAt) < new Date();
                return (
                  <List.Item className="clickable" onClick={() => navigate(t.order ? `/orders/${t.order.id}?tab=tasks` : '/tasks')}>
                    <List.Item.Meta
                      title={<span style={{ fontWeight: 400 }}>{t.title}</span>}
                      description={
                        <Space size={6}>
                          {t.dueAt && <Typography.Text type={overdue ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>{overdue ? 'просрочено · ' : ''}{fmtSmart(t.dueAt)}</Typography.Text>}
                          {t.order && <Tag bordered={false}>{t.order.number}</Tag>}
                        </Space>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>

        {d.leads && (
          <Col xs={24} xl={12}>
            <Card title="Свежие заявки" size="small" extra={<Link to="/leads">Все заявки</Link>}>
              <List
                dataSource={d.leads.latest}
                locale={{ emptyText: <EmptyState text="Новых заявок нет" /> }}
                renderItem={(l) => {
                  const overdue = !l.firstResponseAt && new Date(l.responseDueAt) < new Date();
                  return (
                    <List.Item className="clickable" onClick={() => navigate(`/leads/${l.id}`)} extra={<Badge status={overdue ? 'error' : l.status === 'new' ? 'processing' : 'default'} text={overdue ? 'просрочена' : l.status === 'new' ? 'новая' : 'в работе'} />}>
                      <List.Item.Meta
                        title={
                          <Space size={6}>
                            <b>{l.number}</b>
                            <Tag bordered={false}>{LEAD_CHANNEL_LABELS[l.channel]}</Tag>
                            <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{fmtSmart(l.createdAt)}</span>
                          </Space>
                        }
                        description={<Typography.Paragraph ellipsis={{ rows: 1 }} style={{ margin: 0 }}>{l.client?.name ?? l.contactName}: {l.description}</Typography.Paragraph>}
                      />
                    </List.Item>
                  );
                }}
              />
            </Card>
          </Col>
        )}

        <Col xs={24} xl={d.leads ? 12 : 24}>
          <Card title={<Space><EnvironmentOutlined />Выезды сегодня</Space>} size="small" extra={<Link to="/visits">Календарь</Link>}>
            <List
              dataSource={d.visitsToday}
              locale={{ emptyText: <EmptyState text="Сегодня выездов нет" /> }}
              renderItem={(v) => (
                <List.Item className="clickable" onClick={() => navigate(`/visits/${v.id}`)} extra={<Avatars ids={v.assignees.map((a) => a.userId)} />}>
                  <List.Item.Meta
                    title={<><b>{fmtTime(v.plannedStartAt)}</b> · {v.order.number} · {v.order.client.name}</>}
                    description={
                      <Space size={6}>
                        <Tag color={v.status === 'on_site' ? 'purple' : v.status === 'done' ? 'green' : 'blue'}>{v.status === 'on_site' ? 'на объекте' : v.status === 'done' ? 'завершён' : v.status === 'on_the_way' ? 'в пути' : 'запланирован'}</Tag>
                        {v.address}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} xl={isDirector ? 14 : 24}>
          <Card title="Заказы в работе по этапам" size="small">
            <Row gutter={[24, 12]}>
              {types.map((t) => {
                const rows = d.orders.byStage.filter((s) => s.type === t);
                const max = Math.max(...rows.map((r) => r.count));
                return (
                  <Col xs={24} md={12} key={t}>
                    <Typography.Text strong>{ORDER_TYPE_LABELS[t]}</Typography.Text>
                    {rows.map((r) => (
                      <div key={r.code} className="clickable" onClick={() => navigate(`/orders?type=${t}`)} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 28px', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                        <Progress percent={(r.count / max) * 100} showInfo={false} strokeColor={r.color ?? undefined} size="small" />
                        <b style={{ textAlign: 'right' }}>{r.count}</b>
                      </div>
                    ))}
                  </Col>
                );
              })}
            </Row>
          </Card>
        </Col>

        {isDirector && (
          <Col xs={24} xl={10}>
            <Card title="Просроченные задачи по сотрудникам" size="small">
              <List
                dataSource={[...d.overdueTasksByUser].sort((a, b) => b.count - a.count)}
                locale={{ emptyText: <EmptyState text="Просроченных задач нет" /> }}
                renderItem={(r) => (
                  <List.Item extra={<Tag color="red">{r.count}</Tag>}>
                    <UserAvatar userId={r.userId} withName />
                  </List.Item>
                )}
              />
              {d.money && (
                <div style={{ marginTop: 12 }}>
                  <Typography.Text type="secondary">Сумма заказов в работе: </Typography.Text>
                  <Money kop={d.money.inWorkKop} strong />
                </div>
              )}
            </Card>
          </Col>
        )}
      </Row>
    </>
  );
}
