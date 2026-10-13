import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { STATIC_DEMO, tokenStore } from './api';
import { useAuth } from './auth';

/**
 * Живые обновления (API-60…64). Сервер присылает только «что изменилось», а данные
 * перезапрашиваются через REST — поэтому права работают так же, как в обычных запросах.
 */
const SocketCtx = createContext<Socket | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);
  const navRef = useRef(navigate);
  navRef.current = navigate;

  useEffect(() => {
    if (!me || !STATIC_DEMO) return;
    // Демо без сервера: события приходят из демо-сервера этой и других вкладок посетителя.
    let off = () => {};
    import('../demo-static/store').then(({ onEvent }) => {
      off = onEvent((event, data) => {
        if (event === 'notification.new') {
          if (!(data.userIds as string[]).includes(me.user.id)) return;
          qc.invalidateQueries({ queryKey: ['notifications'] });
          notification.info({
            message: data.title,
            placement: 'bottomRight',
            duration: 5,
            onClick: () => data.link && navRef.current(data.link),
          });
          return;
        }
        qc.invalidateQueries();
      });
    });
    return () => off();
  }, [me, qc, notification]);

  useEffect(() => {
    if (!me || STATIC_DEMO) return;
    // Клиент WebSocket загружается только в серверном режиме — в демо без сервера он не нужен.
    let s: Socket | null = null;
    let cancelled = false;
    import('socket.io-client').then(({ io }) => {
      if (cancelled) return;
      s = io({ path: '/ws', auth: (cb) => cb({ token: tokenStore.get() }), transports: ['websocket'] });
      subscribe(s, qc, (title, link) =>
        notification.info({
          message: title,
          placement: 'bottomRight',
          duration: 5,
          onClick: () => link && navRef.current(link),
          style: { cursor: link ? 'pointer' : undefined },
        }),
      );
      setSocket(s);
    });
    return () => {
      cancelled = true;
      s?.disconnect();
      setSocket(null);
    };
  }, [me, qc, notification]);

  return <SocketCtx.Provider value={socket}>{children}</SocketCtx.Provider>;
}

/** События сервера → обновление нужных данных (API-61). */
function subscribe(s: Socket, qc: QueryClient, toast: (title: string, link?: string) => void) {
  const inv = (key: unknown[]) => qc.invalidateQueries({ queryKey: key });
  s.on('order.updated', (e: { id: string }) => {
    inv(['orders']);
    inv(['order', e.id]);
    inv(['dashboard']);
  });
  s.on('order.stageChanged', (e: { id: string }) => {
    inv(['orders']);
    inv(['order', e.id]);
    inv(['dashboard']);
  });
  s.on('order.created', () => {
    inv(['orders']);
    inv(['dashboard']);
  });
  s.on('comment.created', (e: { orderId: string }) => inv(['comments', e.orderId]));
  s.on('comment.updated', (e: { orderId: string }) => inv(['comments', e.orderId]));
  s.on('lead.created', () => {
    inv(['leads']);
    inv(['dashboard']);
  });
  s.on('lead.updated', () => inv(['leads']));
  s.on('visit.changed', () => {
    inv(['visits']);
    inv(['dashboard']);
  });
  s.on('task.changed', () => {
    inv(['tasks']);
    inv(['dashboard']);
  });
  s.on('chat.message', (e: { channelId: string }) => {
    inv(['chat', 'channels']);
    inv(['chat', 'messages', e.channelId]);
  });
  s.on('chat.channels', () => inv(['chat', 'channels']));
  s.on('notification.new', (e: { title: string; link?: string }) => {
    inv(['notifications']);
    toast(e.title, e.link);
  });
  // После обрыва связи перезапрашиваем всё открытое (API-64).
  s.io.on('reconnect', () => qc.invalidateQueries());
}

/** Подписка на комнату заказа или чата, пока компонент на экране. */
export function useRoom(room: string | null) {
  const socket = useContext(SocketCtx);
  useEffect(() => {
    if (!socket || !room) return;
    const join = () => socket.emit('join', room);
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      socket.emit('leave', room);
    };
  }, [socket, room]);
}
