import { CheckOutlined, UndoOutlined } from '@ant-design/icons';
import { Button, Checkbox, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtSmart } from '../../shared/format';
import { useAction } from '../../shared/hooks';
import type { Task } from '../../shared/types';
import { EmptyState, PriorityTag, UserAvatar } from '../../shared/ui';

/** Список задач с отметкой выполнения и результатом (ЗАД-4). */
export function TaskList({ tasks, showOrder = true, loading }: { tasks: Task[]; showOrder?: boolean; loading?: boolean }) {
  const { me } = useAuth();
  const [done, setDone] = useState<Task | null>(null);
  const [result, setResult] = useState('');
  const update = useAction(({ id, ...body }: { id: string; status: string; resultComment?: string }) => api.patch(`/tasks/${id}`, body), {
    invalidate: [['tasks'], ['dashboard'], ['order']],
    onSuccess: () => {
      setDone(null);
      setResult('');
    },
  });
  return (
    <>
      <List
        loading={loading}
        dataSource={tasks}
        locale={{ emptyText: <EmptyState text="Задач нет" /> }}
        renderItem={(t) => {
          const overdue = t.status === 'open' && t.dueAt && new Date(t.dueAt) < new Date();
          const canEdit = t.assigneeId === me?.user.id || t.authorId === me?.user.id;
          return (
            <List.Item
              actions={[
                t.status === 'open' ? (
                  <Button key="d" size="small" icon={<CheckOutlined />} disabled={!canEdit} onClick={() => setDone(t)}>
                    Выполнено
                  </Button>
                ) : (
                  <Button key="r" size="small" type="text" icon={<UndoOutlined />} disabled={!canEdit} onClick={() => update.mutate({ id: t.id, status: 'open' })}>
                    Вернуть
                  </Button>
                ),
              ]}
            >
              <List.Item.Meta
                avatar={<Checkbox checked={t.status === 'done'} disabled={!canEdit} onChange={(e) => (e.target.checked ? setDone(t) : update.mutate({ id: t.id, status: 'open' }))} />}
                title={
                  <Space size={6} wrap>
                    <span style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined, fontWeight: 400 }}>{t.title}</span>
                    <PriorityTag priority={t.priority} />
                    {t.isAuto && <Tag bordered={false}>авто</Tag>}
                  </Space>
                }
                description={
                  <Space size={10} wrap style={{ fontSize: 12 }}>
                    {t.dueAt && <Typography.Text type={overdue ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>{overdue ? 'просрочено · ' : 'срок '}{fmtSmart(t.dueAt)}</Typography.Text>}
                    <UserAvatar userId={t.assigneeId} withName size={18} />
                    {t.authorId && t.authorId !== t.assigneeId && <span className="muted">от <UserAvatar userId={t.authorId} withName size={16} /></span>}
                    {showOrder && t.order && <Link to={`/orders/${t.order.id}?tab=tasks`}>{t.order.number}</Link>}
                    {showOrder && !t.order && t.client && <Link to={`/clients/${t.client.id}`}>{t.client.name}</Link>}
                    {t.resultComment && <span className="muted">Результат: {t.resultComment}</span>}
                  </Space>
                }
              />
            </List.Item>
          );
        }}
      />
      <Modal title="Задача выполнена" open={!!done} onCancel={() => setDone(null)} okText="Готово" confirmLoading={update.isPending} onOk={() => done && update.mutate({ id: done.id, status: 'done', resultComment: result || undefined })}>
        <Typography.Paragraph>{done?.title}</Typography.Paragraph>
        <Input.TextArea rows={2} placeholder="Результат (необязательно)" value={result} onChange={(e) => setResult(e.target.value)} />
      </Modal>
    </>
  );
}
