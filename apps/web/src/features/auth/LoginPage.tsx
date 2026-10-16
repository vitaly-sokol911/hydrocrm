import { DashboardOutlined, LockOutlined, MailOutlined, TeamOutlined, ToolOutlined, WalletOutlined } from '@ant-design/icons';
import { loginSchema, type RoleCode } from '@hydrocrm/shared';
import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { ApiError } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { AuthorLink } from '../../shared/author';
import { HydraulicLine } from '../../shared/HydraulicLine';

const ROLES: { role: RoleCode; title: string; who: string; text: string; icon: React.ReactNode }[] = [
  { role: 'director', title: 'Руководитель', who: 'Андрей Соколов', text: 'Застрявшие заказы, выручка и маржа, загрузка команды', icon: <DashboardOutlined /> },
  { role: 'manager', title: 'Менеджер', who: 'Елена Ковалёва', text: 'Заявки из всех каналов, канбан заказов, сметы', icon: <TeamOutlined /> },
  { role: 'master', title: 'Мастер', who: 'Сергей Петров', text: 'Только свои заказы и без цен. Удобно со смартфона', icon: <ToolOutlined /> },
  { role: 'accountant', title: 'Бухгалтер', who: 'Ольга Лебедева', text: 'Суммы и маржа по заказам, задачи по счетам', icon: <WalletOutlined /> },
];

const HERO_STAGES = ['Заявка', 'Приёмка', 'Диагностика', 'Смета', 'Ремонт', 'Испытания', 'Выдача'].map((name) => ({ key: name, name }));

const FACTS = [
  { value: '4', label: 'воронки', text: 'ремонт в цеху, выезд, сборка под заказ и типовых станций' },
  { value: '5', label: 'ролей', text: 'у мастера, менеджера, бухгалтера и руководителя свои экраны и права' },
  { value: '0', label: 'перезагрузок', text: 'изменения коллег появляются на экране сразу' },
];

export function LoginPage() {
  const { login, demoLogin, demoMode } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось войти');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="login-wrap">
      <section className="login-hero">
        <div className="login-glow" aria-hidden />
        <div className="brand" style={{ padding: 0 }}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <div>
            ГидроCRM
            <small>сервис гидравлического оборудования</small>
          </div>
        </div>

        <div className="login-enter">
          <div className="eyebrow" style={{ color: 'rgba(255,255,255,0.6)' }}>CRM для ремонта и сборки гидростанций</div>
          <h1>
            Заказ проходит путь от звонка до выдачи — <em>и ничего не теряется</em>
          </h1>
          <p>
            Заявки из телефона, почты и мессенджеров, заказы по этапам, сметы, выезды мастеров и обсуждения команды — в одной системе вместо
            разрозненных чатов и таблиц.
          </p>
          <div className="login-line">
            <HydraulicLine stages={HERO_STAGES} current={4} animate />
            <div className="login-order">
              <span className="mono">З-2026-0042</span>
              <span>Ремонт насоса A10VSO28 · смета согласована</span>
            </div>
          </div>
          <dl className="login-facts">
            {FACTS.map((f) => (
              <div key={f.label}>
                <dt>
                  <span className="mono">{f.value}</span> {f.label}
                </dt>
                <dd>{f.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="login-stack">NestJS · React · PostgreSQL · WebSocket · PWA</div>
      </section>

      <section className="login-form">
        <div className="login-panel login-enter">
          {demoMode ? (
            <>
              <div className="eyebrow">Вход</div>
              <Typography.Title level={3} style={{ margin: '6px 0 8px' }}>
                Выберите роль
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 18 }}>
                Данные вымышленные — нажимайте что угодно, изменения видны только вам.
              </Typography.Paragraph>
              <div className="role-list">
                {ROLES.map((r) => (
                  <Button key={r.role} block className="role-btn" loading={busy === r.role} onClick={() => run(r.role, () => demoLogin(r.role))}>
                    <span className="role-icon">{r.icon}</span>
                    <span>
                      <span className="t">
                        {r.title} <span className="muted">· {r.who}</span>
                      </span>
                      <span className="d">{r.text}</span>
                    </span>
                  </Button>
                ))}
              </div>
              {error && <Alert type="error" message={error} style={{ marginTop: 16 }} showIcon />}
              <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: '18px 0 0' }}>
                Совет: откройте два окна под разными ролями — изменения видны сразу, без перезагрузки.
              </Typography.Paragraph>
            </>
          ) : (
            <>
              <Typography.Title level={3} style={{ margin: '0 0 16px' }}>
                Вход
              </Typography.Title>
              <Form
                layout="vertical"
                requiredMark={false}
                onFinish={(v: { email: string; password: string }) => {
                  const parsed = loginSchema.safeParse(v);
                  if (!parsed.success) return setError(parsed.error.issues[0].message);
                  run('login', () => login(parsed.data.email, parsed.data.password));
                }}
              >
                <Form.Item name="email" label="Email" rules={[{ required: true, message: 'Введите email' }]}>
                  <Input prefix={<MailOutlined />} size="large" autoComplete="username" autoFocus />
                </Form.Item>
                <Form.Item name="password" label="Пароль" rules={[{ required: true, message: 'Введите пароль' }]}>
                  <Input.Password prefix={<LockOutlined />} size="large" autoComplete="current-password" />
                </Form.Item>
                {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
                <Button type="primary" htmlType="submit" size="large" block loading={busy === 'login'}>
                  Войти
                </Button>
              </Form>
            </>
          )}
          <AuthorLink style={{ marginTop: 20 }} />
        </div>
      </section>
    </div>
  );
}
