import { CameraOutlined, DeleteOutlined, EditOutlined, PaperClipOutlined, SendOutlined, SwapRightOutlined, ToolOutlined } from '@ant-design/icons';
import { PERMISSIONS } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Image, Input, Mentions, Popconfirm, Segmented, Space, Spin, Tag, Typography } from 'antd';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { fmtSmart } from '../../shared/format';
import { useAction, useUsers } from '../../shared/hooks';
import { useRoom } from '../../shared/realtime';
import type { Comment, FileDto } from '../../shared/types';
import { uploadFile } from '../../shared/upload';
import { EmptyState, UserAvatar } from '../../shared/ui';

/** Подсветка «@Имя Фамилия» в тексте комментария. */
function renderText(text: string, names: string[]) {
  if (!text.includes('@') || !names.length) return text;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`);
  // split с группой захвата: нечётные элементы — найденные упоминания.
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="mention">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function Files({ files }: { files: FileDto[] }) {
  const images = files.filter((f) => f.mimeType.startsWith('image/'));
  const others = files.filter((f) => !f.mimeType.startsWith('image/'));
  return (
    <>
      {!!images.length && (
        <div className="feed-photos">
          <Image.PreviewGroup>
            {images.map((f) => (
              <Image key={f.id} src={f.url} width={96} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} />
            ))}
          </Image.PreviewGroup>
        </div>
      )}
      {others.map((f) => (
        <div key={f.id}>
          <a href={f.url} target="_blank" rel="noreferrer">
            <PaperClipOutlined /> {f.name}
          </a>
        </div>
      ))}
    </>
  );
}

export function OrderFeed({ orderId }: { orderId: string }) {
  const { me, can } = useAuth();
  const { users, byId } = useUsers();
  const { message } = App.useApp();
  useRoom(`order:${orderId}`);
  const q = useQuery({ queryKey: ['comments', orderId], queryFn: () => api.get<{ items: Comment[]; lastReadAt: string | null }>(`/orders/${orderId}/comments`) });
  const [filter, setFilter] = useState<'all' | 'comments' | 'events' | 'photos'>('all');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<FileDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const names = useMemo(() => users.map((u) => u.fullName), [users]);

  const send = useAction(() => api.post(`/orders/${orderId}/comments`, { text, fileIds: files.map((f) => f.id) }), {
    invalidate: [['comments', orderId], ['order', orderId]],
    onSuccess: () => {
      setText('');
      setFiles([]);
    },
  });
  const edit = useAction((v: { id: string; text: string }) => api.patch(`/comments/${v.id}`, { text: v.text }), { invalidate: [['comments', orderId]], onSuccess: () => setEditing(null) });
  const remove = useAction((id: string) => api.delete(`/comments/${id}`), { invalidate: [['comments', orderId]] });
  const read = useAction(() => api.post(`/orders/${orderId}/read`), { invalidate: [['orders']], silentError: true });

  // Отмечаем ленту прочитанной при открытии и при новых сообщениях (ОБЩ-4).
  const count = q.data?.items.length ?? 0;
  useEffect(() => {
    if (count) read.mutate(undefined);
    bottom.current?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all([...list].map((f) => uploadFile(f, { orderId })));
      setFiles((prev) => [...prev, ...uploaded]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const items = (q.data?.items ?? []).filter((c) =>
    filter === 'all' ? true : filter === 'comments' ? c.kind === 'comment' : filter === 'events' ? c.kind === 'system' : c.files.some((f) => f.mimeType.startsWith('image/')),
  );
  const lastRead = q.data?.lastReadAt ? new Date(q.data.lastReadAt) : null;
  const isDirector = me?.user.roles.some((r) => r === 'director' || r === 'admin');

  return (
    <div>
      <Segmented
        size="small"
        value={filter}
        onChange={(v) => setFilter(v as typeof filter)}
        options={[
          { value: 'all', label: 'Всё' },
          { value: 'comments', label: 'Комментарии' },
          { value: 'events', label: 'События' },
          { value: 'photos', label: 'Фото' },
        ]}
        style={{ marginBottom: 12 }}
      />
      {q.isLoading ? (
        <Spin />
      ) : !items.length ? (
        <EmptyState text="Здесь будет вся история заказа: комментарии, фото и события" />
      ) : (
        <div className="feed">
          {items.map((c) => {
            if (c.kind === 'system') {
              const isStage = c.payload?.event === 'stage';
              return (
                <div key={c.id} className="feed-item system">
                  {isStage ? <SwapRightOutlined /> : <ToolOutlined />}
                  {c.text}
                  {c.authorId && <> · {byId.get(c.authorId)?.fullName}</>} · {fmtSmart(c.createdAt)}
                </div>
              );
            }
            const mine = c.authorId === me?.user.id;
            const fresh = Date.now() - new Date(c.createdAt).getTime() < 15 * 60_000;
            const unread = !mine && lastRead && new Date(c.createdAt) > lastRead;
            return (
              <div key={c.id} className={`feed-item ${unread ? 'unread' : ''}`}>
                <UserAvatar userId={c.authorId} size={28} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="who">
                    <b>{byId.get(c.authorId ?? '')?.fullName}</b> · {fmtSmart(c.createdAt)}
                    {c.editedAt && ' · изменено'}
                    {!c.deletedAt && ((mine && fresh) || isDirector) && can(PERMISSIONS.commentsWrite) && (
                      <Space size={0} style={{ marginLeft: 6 }}>
                        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing({ id: c.id, text: c.text })} />
                        <Popconfirm title="Удалить комментарий?" onConfirm={() => remove.mutate(c.id)} okText="Удалить" cancelText="Отмена">
                          <Button size="small" type="text" icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    )}
                  </div>
                  {editing?.id === c.id ? (
                    <Space.Compact style={{ width: '100%' }}>
                      <Input.TextArea autoSize value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                      <Button type="primary" onClick={() => edit.mutate(editing)} loading={edit.isPending}>
                        Сохранить
                      </Button>
                    </Space.Compact>
                  ) : c.deletedAt ? (
                    <Typography.Text type="secondary" italic>
                      Комментарий удалён
                    </Typography.Text>
                  ) : (
                    <>
                      {c.text && <div className="bubble">{renderText(c.text, names)}</div>}
                      <Files files={c.files} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      )}

      {can(PERMISSIONS.commentsWrite) && (
        <div style={{ marginTop: 16, position: 'sticky', bottom: 0, paddingTop: 8 }}>
          {!!files.length && (
            <Space wrap style={{ marginBottom: 8 }}>
              {files.map((f) => (
                <Tag key={f.id} closable onClose={() => setFiles((p) => p.filter((x) => x.id !== f.id))}>
                  <PaperClipOutlined /> {f.name}
                </Tag>
              ))}
            </Space>
          )}
          <Mentions
            rows={2}
            value={text}
            onChange={setText}
            placeholder="Напишите комментарий. @ — упомянуть коллегу. Ctrl+Enter — отправить"
            options={users.filter((u) => u.isActive).map((u) => ({ value: u.fullName, label: u.fullName }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (text.trim() || files.length)) send.mutate(undefined);
            }}
          />
          <Space style={{ marginTop: 8, width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFiles(e.target.files)} />
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
              <Button icon={<CameraOutlined />} onClick={() => cameraInput.current?.click()} loading={uploading}>
                Фото
              </Button>
              <Button icon={<PaperClipOutlined />} onClick={() => fileInput.current?.click()} disabled={uploading}>
                Файл
              </Button>
            </Space>
            <Button type="primary" icon={<SendOutlined />} disabled={!text.trim() && !files.length} loading={send.isPending} onClick={() => send.mutate(undefined)}>
              Отправить
            </Button>
          </Space>
        </div>
      )}
    </div>
  );
}
