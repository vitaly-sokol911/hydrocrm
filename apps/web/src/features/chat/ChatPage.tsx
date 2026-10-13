import { ArrowLeftOutlined, PlusOutlined, SendOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { PERMISSIONS } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Dropdown, Empty, Form, Input, Mentions, Modal, Space, Typography } from 'antd';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { dayjs, fmtSmart, fmtTime } from '../../shared/format';
import { useAction, useUsers } from '../../shared/hooks';
import { UserSelect } from '../../shared/selects';
import type { ChatChannel, ChatMessage } from '../../shared/types';
import { UserAvatar } from '../../shared/ui';

/** ОБЩ-12: номер заказа в тексте становится ссылкой. */
function linkify(text: string) {
  const parts = text.split(/(З-\d{4}-\d{4})/g);
  return parts.map((p, i) =>
    /^З-\d{4}-\d{4}$/.test(p) ? (
      <Link key={i} to={`/orders?view=table&all=true&q=${encodeURIComponent(p)}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
        {p}
      </Link>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

function channelTitle(c: ChatChannel, meId: string, name: (id: string) => string) {
  if (c.type === 'direct') return name(c.memberIds.find((m) => m !== meId) ?? meId);
  return c.name ?? 'Канал';
}

function Room({ channel }: { channel: ChatChannel }) {
  const { me } = useAuth();
  const { users, name } = useUsers();
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['chat', 'messages', channel.id], queryFn: () => api.get<ChatMessage[]>(`/chat/channels/${channel.id}/messages`) });
  const send = useAction(() => api.post(`/chat/channels/${channel.id}/messages`, { text }), {
    invalidate: [['chat', 'messages', channel.id], ['chat', 'channels']],
    onSuccess: () => setText(''),
  });
  const read = useAction(() => api.post(`/chat/channels/${channel.id}/read`), { invalidate: [['chat', 'channels']], silentError: true });
  const count = q.data?.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
    if (count) read.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, channel.id]);

  let lastDay = '';
  return (
    <div className="chat-room">
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link to="/chat" className="muted">
          <ArrowLeftOutlined />
        </Link>
        <b>{channelTitle(channel, me!.user.id, name)}</b>
        <span className="muted" style={{ fontSize: 12 }}>
          · {channel.memberIds.length} участн.
        </span>
      </div>
      <div className="chat-messages">
        {!q.data?.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Сообщений пока нет" />}
        {q.data?.map((m) => {
          const mine = m.authorId === me?.user.id;
          const day = dayjs(m.createdAt).format('D MMMM');
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={m.id}>
              {showDay && (
                <div className="muted" style={{ textAlign: 'center', fontSize: 12, margin: '8px 0' }}>
                  {dayjs(m.createdAt).isSame(dayjs(), 'day') ? 'Сегодня' : day}
                </div>
              )}
              <div className={`chat-msg ${mine ? 'mine' : ''}`}>
                {!mine && (
                  <div className="muted" style={{ fontSize: 12, marginBottom: 2 }}>
                    {name(m.authorId)}
                  </div>
                )}
                <div className="bubble">{m.deletedAt ? <i>Сообщение удалено</i> : linkify(m.text)}</div>
                <div className="muted" style={{ fontSize: 11, textAlign: mine ? 'right' : 'left' }}>
                  {fmtTime(m.createdAt)}
                </div>
              </div>
            </Fragment>
          );
        })}
        <div ref={bottom} />
      </div>
      <div className="chat-input">
        <Mentions
          autoSize={{ minRows: 1, maxRows: 5 }}
          value={text}
          onChange={setText}
          placeholder="Сообщение… Enter — отправить, Shift+Enter — новая строка"
          options={users.filter((u) => u.isActive).map((u) => ({ value: u.fullName, label: u.fullName }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
              e.preventDefault();
              send.mutate(undefined);
            }
          }}
          style={{ flex: 1 }}
        />
        <Button type="primary" icon={<SendOutlined />} disabled={!text.trim()} loading={send.isPending} onClick={() => send.mutate(undefined)} />
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, can } = useAuth();
  const { name } = useUsers();
  const channels = useQuery({ queryKey: ['chat', 'channels'], queryFn: () => api.get<ChatChannel[]>('/chat/channels') });
  const [modal, setModal] = useState<'group' | 'direct' | null>(null);
  const [form] = Form.useForm();
  const direct = useAction((userId: string) => api.post<{ id: string }>('/chat/direct', { userId }), {
    invalidate: [['chat', 'channels']],
    onSuccess: (c) => {
      setModal(null);
      navigate(`/chat/${c.id}`);
    },
  });
  const group = useAction((v: { name: string; memberIds: string[] }) => api.post<{ id: string }>('/chat/channels', v), {
    invalidate: [['chat', 'channels']],
    onSuccess: (c) => {
      setModal(null);
      navigate(`/chat/${c.id}`);
    },
  });
  const list = useMemo(() => channels.data ?? [], [channels.data]);
  const current = useMemo(() => list.find((c) => c.id === id), [list, id]);

  useEffect(() => {
    // На ПК сразу открываем «Общий», на смартфоне показываем список.
    if (!id && list.length && window.innerWidth >= 768) navigate(`/chat/${list[0].id}`, { replace: true });
  }, [id, list, navigate]);

  return (
    <>
      <div className={`chat ${current ? 'has-room' : ''}`}>
        <div className="chat-list">
          <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
            <Typography.Text strong>Чат команды</Typography.Text>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'direct', icon: <UserOutlined />, label: 'Личное сообщение' },
                  ...(can(PERMISSIONS.settingsManage) ? [{ key: 'group', icon: <TeamOutlined />, label: 'Новый канал' }] : []),
                ],
                onClick: ({ key }) => setModal(key as 'group' | 'direct'),
              }}
            >
              <Button size="small" icon={<PlusOutlined />} />
            </Dropdown>
          </div>
          {list.map((c) => (
            <div key={c.id} className={`chat-list-item ${c.id === id ? 'active' : ''}`} onClick={() => navigate(`/chat/${c.id}`)}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space size={8}>
                  {c.type === 'direct' ? <UserAvatar userId={c.memberIds.find((m) => m !== me?.user.id)} size={24} /> : <TeamOutlined style={{ fontSize: 18, color: '#1f5fbf' }} />}
                  <b>{channelTitle(c, me!.user.id, name)}</b>
                </Space>
                <Badge count={c.unread} size="small" />
              </Space>
              {c.lastMessage && (
                <Typography.Paragraph type="secondary" ellipsis style={{ margin: '4px 0 0', fontSize: 12 }}>
                  {c.type !== 'direct' && `${name(c.lastMessage.authorId).split(' ')[0]}: `}
                  {c.lastMessage.text} · {fmtSmart(c.lastMessage.createdAt)}
                </Typography.Paragraph>
              )}
            </div>
          ))}
        </div>
        {current ? <Room channel={current} /> : <div className="chat-room" style={{ display: 'grid', placeItems: 'center' }}><Empty description="Выберите канал" /></div>}
      </div>
      <Modal title="Личное сообщение" open={modal === 'direct'} onCancel={() => setModal(null)} footer={null} destroyOnClose>
        <UserSelect placeholder="Кому написать" style={{ width: '100%' }} onChange={(v) => v && direct.mutate(v as string)} />
      </Modal>
      <Modal title="Новый канал" open={modal === 'group'} onCancel={() => setModal(null)} onOk={() => form.submit()} okText="Создать" confirmLoading={group.isPending} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={(v) => group.mutate(v)}>
          <Form.Item name="name" label="Название" rules={[{ required: true }]}>
            <Input placeholder="Например: Продажи" />
          </Form.Item>
          <Form.Item name="memberIds" label="Участники" rules={[{ required: true, message: 'Выберите участников' }]}>
            <UserSelect mode="multiple" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
