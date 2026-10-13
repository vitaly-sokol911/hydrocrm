import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { PERMISSIONS, VISIT_STATUS_LABELS } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Grid, List, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { dayjs, fmtTime } from '../../shared/format';
import { useUsers } from '../../shared/hooks';
import type { Visit } from '../../shared/types';
import { Avatars, PageHeader, UserAvatar } from '../../shared/ui';

/** ВЫЕ-2: календарь выездов — неделя, мастера по строкам, перетаскивание меняет день или мастера. */
export default function VisitsPage() {
  const navigate = useNavigate();
  const { can, me } = useAuth();
  const { withRole } = useUsers();
  const { message } = App.useApp();
  const screens = Grid.useBreakpoint();
  const [weekStart, setWeekStart] = useState(() => dayjs().startOf('week'));
  const from = weekStart.toISOString();
  const to = weekStart.add(7, 'day').toISOString();
  const q = useQuery({ queryKey: ['visits', { from, to }], queryFn: () => api.get<Visit[]>('/visits', { from, to }) });
  const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));
  const planner = can(PERMISSIONS.visitsPlan);
  const masters = planner ? withRole('master') : withRole('master').filter((m) => m.id === me?.user.id);
  const visits = useMemo(() => q.data ?? [], [q.data]);

  const conflicts = useMemo(() => {
    const ids = new Set<string>();
    for (const a of visits) for (const b of visits) {
      if (a.id >= b.id || a.status === 'cancelled' || b.status === 'cancelled') continue;
      const overlap = new Date(a.plannedStartAt) < new Date(b.plannedEndAt) && new Date(b.plannedStartAt) < new Date(a.plannedEndAt);
      if (overlap && a.assignees.some((x) => b.assignees.some((y) => y.userId === x.userId))) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
    return ids;
  }, [visits]);

  const move = async (visitId: string, day: dayjs.Dayjs, masterId: string) => {
    const v = visits.find((x) => x.id === visitId);
    if (!v) return;
    const start = dayjs(v.plannedStartAt);
    const dur = dayjs(v.plannedEndAt).diff(start);
    const nextStart = day.hour(start.hour()).minute(start.minute());
    const masterIds = v.assignees.some((a) => a.userId === masterId) ? v.assignees.map((a) => a.userId) : [masterId];
    try {
      const r = await api.patch<{ warnings: unknown[] }>(`/visits/${visitId}`, { plannedStartAt: nextStart.toISOString(), plannedEndAt: nextStart.add(dur, 'ms').toISOString(), masterIds });
      message[r.warnings.length ? 'warning' : 'success'](r.warnings.length ? 'Перенесено, но у мастера пересечение' : 'Выезд перенесён');
      q.refetch();
    } catch (e) {
      message.error(e instanceof ApiError ? e.message : 'Не удалось перенести');
    }
  };

  const slot = (v: Visit) => (
    <Tooltip key={v.id} title={`${v.order?.client.name} · ${v.address}`}>
      <div
        className={`slot ${v.status} ${conflicts.has(v.id) ? 'conflict' : ''}`}
        draggable={planner}
        onDragStart={(e) => e.dataTransfer.setData('text/plain', v.id)}
        onClick={() => navigate(`/visits/${v.id}`)}
      >
        <b>{fmtTime(v.plannedStartAt)}</b> {v.order?.number}
        <div className="muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {v.order?.client.name}
        </div>
      </div>
    </Tooltip>
  );

  const header = (
    <Space>
      <Button icon={<LeftOutlined />} onClick={() => setWeekStart((w) => w.subtract(7, 'day'))} />
      <Button onClick={() => setWeekStart(dayjs().startOf('week'))}>Сегодня</Button>
      <Button icon={<RightOutlined />} onClick={() => setWeekStart((w) => w.add(7, 'day'))} />
      <Typography.Text strong>
        {weekStart.format('D MMM')} — {weekStart.add(6, 'day').format('D MMM YYYY')}
      </Typography.Text>
    </Space>
  );

  // На смартфоне — список по дням вместо сетки.
  if (!screens.md) {
    return (
      <>
        <PageHeader title="Выезды" extra={header} />
        {days.map((d) => {
          const dayVisits = visits.filter((v) => dayjs(v.plannedStartAt).isSame(d, 'day'));
          if (!dayVisits.length) return null;
          return (
            <div key={d.toString()} style={{ marginBottom: 12 }}>
              <Typography.Text strong style={{ color: d.isSame(dayjs(), 'day') ? '#1f5fbf' : undefined }}>
                {d.format('dddd, D MMMM')}
              </Typography.Text>
              <List
                size="small"
                dataSource={dayVisits}
                renderItem={(v) => (
                  <List.Item className="clickable" onClick={() => navigate(`/visits/${v.id}`)} extra={<Tag>{VISIT_STATUS_LABELS[v.status]}</Tag>}>
                    <List.Item.Meta title={`${fmtTime(v.plannedStartAt)} · ${v.order?.number} · ${v.order?.client.name}`} description={<>{v.address}<div><Avatars ids={v.assignees.map((a) => a.userId)} size={18} /></div></>} />
                  </List.Item>
                )}
              />
            </div>
          );
        })}
        {!visits.length && <Typography.Text type="secondary">На этой неделе выездов нет</Typography.Text>}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Выезды" subtitle={planner ? 'Перетащите выезд, чтобы перенести на другой день или другому мастеру' : 'Ваши выезды'} extra={header} />
      <div className="week">
        <div className="head">Мастер</div>
        {days.map((d) => (
          <div key={d.toString()} className={`head ${d.isSame(dayjs(), 'day') ? 'today' : ''}`}>
            {d.format('dd, D MMM')}
          </div>
        ))}
        {masters.map((m) => (
          <Row key={m.id} masterId={m.id} days={days} visits={visits} slot={slot} onDrop={move} planner={planner} />
        ))}
      </div>
    </>
  );
}

function Row({ masterId, days, visits, slot, onDrop, planner }: { masterId: string; days: dayjs.Dayjs[]; visits: Visit[]; slot: (v: Visit) => React.ReactNode; onDrop: (id: string, d: dayjs.Dayjs, masterId: string) => void; planner: boolean }) {
  return (
    <>
      <div className="who">
        <UserAvatar userId={masterId} withName size={22} />
      </div>
      {days.map((d) => (
        <div
          key={d.toString()}
          onDragOver={(e) => planner && e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onDrop(e.dataTransfer.getData('text/plain'), d, masterId);
          }}
        >
          {visits.filter((v) => v.assignees.some((a) => a.userId === masterId) && dayjs(v.plannedStartAt).isSame(d, 'day')).map(slot)}
        </div>
      ))}
    </>
  );
}
