import { CheckOutlined, CompassOutlined, UndoOutlined } from '@ant-design/icons';
import { ROLE_LABELS, type RoleCode } from '@hydrocrm/shared';
import { App, Button, Drawer, Typography } from 'antd';
import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { AuthorLink } from '../../shared/author';
import { useCreate } from '../create/CreateProvider';

interface Step {
  id: string;
  title: string;
  text: string;
  /** Роль, под которую переключаемся, если у текущей роли нет доступа. */
  role: RoleCode;
  /** Роли, которым сценарий доступен без переключения. */
  allowed: RoleCode[];
  /** Текст кнопки, если переключаться не нужно. */
  ctaSame?: string;
  /** Куда перейти или что открыть. */
  go: string | 'create-lead';
  cta: string;
}

/** Сценарии знакомства с демо (аудит, п. 1): самые сильные стороны системы за пару минут. */
const STEPS: Step[] = [
  {
    id: 'kanban',
    title: 'Передвиньте заказ по этапам',
    text: 'Перетащите карточку в канбане на следующую колонку. Коллеги увидят это сразу, без перезагрузки.',
    role: 'manager',
    allowed: ['manager', 'director', 'admin'],
    go: '/orders',
    cta: 'Открыть канбан',
  },
  {
    id: 'rules',
    title: 'Попробуйте начать ремонт без сметы',
    text: 'Откройте заказ на этапе «Смета на согласовании» и нажмите «Ремонт». Система не пропустит и объяснит почему.',
    role: 'manager',
    allowed: ['manager', 'director', 'admin'],
    go: '/orders?view=table&stageCode=estimate',
    cta: 'Заказы на согласовании',
  },
  {
    id: 'lead',
    title: 'Превратите заявку в заказ',
    text: 'Создайте заявку, как будто клиент позвонил, и нажмите «Создать заказ» — клиент и описание перенесутся сами.',
    role: 'manager',
    allowed: ['manager', 'director', 'admin'],
    go: 'create-lead',
    cta: 'Новая заявка',
  },
  {
    id: 'master',
    title: 'Посмотрите глазами мастера',
    text: 'Мастер видит только свои заказы, без цен и маржи. На смартфоне — экран выезда с большими кнопками.',
    role: 'master',
    allowed: ['master'],
    go: '/',
    cta: 'Войти как мастер',
    ctaSame: 'Открыть главную',
  },
  {
    id: 'feed',
    title: 'Обсудите заказ в его ленте',
    text: 'Напишите комментарий с @упоминанием коллеги — ему придёт уведомление, а история останется в заказе.',
    role: 'master',
    allowed: ['master', 'manager', 'director', 'admin'],
    go: '/orders',
    cta: 'Мои заказы',
  },
  {
    id: 'director',
    title: 'Найдите застрявшие заказы',
    text: 'Руководитель сразу видит заказы, которые стоят на этапе дольше нормы, выручку и маржу за месяц.',
    role: 'director',
    allowed: ['director'],
    go: '/',
    cta: 'Войти как руководитель',
    ctaSame: 'Открыть дашборд',
  },
];

const KEY = 'hcrm-demo-steps';
const readDone = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
};

export function DemoGuide() {
  const { demoMode, me, demoLogin } = useAuth();
  const navigate = useNavigate();
  const create = useCreate();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string[]>(readDone);
  const [busy, setBusy] = useState<string | null>(null);
  if (!demoMode || !me) return null;

  const mark = (id: string) => {
    const next = [...new Set([...done, id])];
    setDone(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* хранилище недоступно — прогресс просто не запомнится */
    }
  };

  const run = async (s: Step) => {
    setBusy(s.id);
    try {
      if (!s.allowed.some((r) => me.user.roles.includes(r))) {
        await demoLogin(s.role);
        message.info(`Вы вошли как ${ROLE_LABELS[s.role].toLowerCase()}`);
      }
      mark(s.id);
      setOpen(false);
      if (s.go === 'create-lead') create.open('lead');
      else navigate(s.go);
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy('reset');
    try {
      await api.post('/demo/reset');
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* хранилище недоступно */
      }
      window.location.assign(import.meta.env.BASE_URL);
    } catch (e) {
      setBusy(null);
      message.error(e instanceof ApiError ? e.message : 'Не удалось вернуть исходные данные');
    }
  };

  const progress = done.filter((d) => STEPS.some((s) => s.id === d)).length;
  return (
    <>
      <button className="demo-fab" onClick={() => setOpen(true)} aria-label="Что попробовать">
        <span className="gauge" style={{ '--p': progress / STEPS.length } as CSSProperties}>
          <span>{progress}</span>
        </span>
        Что попробовать
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width={420}
        title={
          <span>
            <CompassOutlined /> Что попробовать · {progress} из {STEPS.length}
          </span>
        }
      >
        <Typography.Paragraph type="secondary">
          Шесть коротких сценариев — за пару минут увидите главное. Роль переключится сама, если нужно.
        </Typography.Paragraph>
        {STEPS.map((s, i) => {
          const isDone = done.includes(s.id);
          const needsRole = !s.allowed.some((r) => me.user.roles.includes(r));
          const label = !needsRole ? s.ctaSame ?? s.cta : s.cta.startsWith('Войти') ? s.cta : `${s.cta} (как ${ROLE_LABELS[s.role].toLowerCase()})`;
          return (
            <div key={s.id} className={`demo-step ${isDone ? 'done' : ''}`}>
              <span className="n">{isDone ? <CheckOutlined /> : i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div className="t">{s.title}</div>
                <div className="d">{s.text}</div>
                <Button size="small" type={isDone ? 'default' : 'primary'} loading={busy === s.id} onClick={() => run(s)}>
                  {label}
                </Button>
              </div>
            </div>
          );
        })}
        <Button block style={{ marginTop: 16 }} icon={<UndoOutlined />} loading={busy === 'reset'} onClick={reset}>
          Вернуть исходные данные
        </Button>
        <AuthorLink style={{ marginTop: 12 }} />
      </Drawer>
    </>
  );
}
