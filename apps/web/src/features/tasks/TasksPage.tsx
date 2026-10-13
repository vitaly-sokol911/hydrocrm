import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Col, Row, Segmented, Space, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { dayjs } from '../../shared/format';
import type { Task } from '../../shared/types';
import { PageHeader } from '../../shared/ui';
import { useCreate } from '../create/CreateProvider';
import { TaskList } from './TaskList';

/** ЗАД-3: «Мои задачи» по группам сроков. */
export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const create = useCreate();
  const scope = (params.get('scope') as 'mine' | 'created' | 'all') ?? 'mine';
  const status = params.get('status') ?? 'open';
  const q = useQuery({ queryKey: ['tasks', { scope, status }], queryFn: () => api.get<Task[]>('/tasks', { scope, status }) });
  const tasks = q.data ?? [];
  const now = dayjs();
  const groups =
    status === 'open'
      ? [
          { title: 'Просрочены', items: tasks.filter((t) => t.dueAt && dayjs(t.dueAt).isBefore(now)), danger: true },
          { title: 'Сегодня', items: tasks.filter((t) => t.dueAt && !dayjs(t.dueAt).isBefore(now) && dayjs(t.dueAt).isSame(now, 'day')) },
          { title: 'Завтра', items: tasks.filter((t) => t.dueAt && dayjs(t.dueAt).isSame(now.add(1, 'day'), 'day')) },
          { title: 'Позже', items: tasks.filter((t) => t.dueAt && dayjs(t.dueAt).isAfter(now.add(1, 'day').endOf('day'))) },
          { title: 'Без срока', items: tasks.filter((t) => !t.dueAt) },
        ].filter((g) => g.items.length)
      : [{ title: status === 'done' ? 'Выполненные' : 'Отменённые', items: tasks }];

  return (
    <>
      <PageHeader
        title="Задачи"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => create.open('task')}>
            Задача
          </Button>
        }
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={scope}
          onChange={(v) => setParams({ scope: String(v), status })}
          options={[
            { value: 'mine', label: 'Мне' },
            { value: 'created', label: 'Поставлены мной' },
            { value: 'all', label: 'Все' },
          ]}
        />
        <Segmented
          value={status}
          onChange={(v) => setParams({ scope, status: String(v) })}
          options={[
            { value: 'open', label: 'Открытые' },
            { value: 'done', label: 'Выполненные' },
          ]}
        />
      </Space>
      <Row gutter={[12, 12]}>
        {(groups.length ? groups : [{ title: 'Задачи', items: [] as Task[] }]).map((g) => (
          <Col xs={24} key={g.title}>
            <Card size="small" title={<Typography.Text type={'danger' in g && g.danger ? 'danger' : undefined}>{g.title} · {g.items.length}</Typography.Text>}>
              <TaskList tasks={g.items} loading={q.isLoading} />
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
