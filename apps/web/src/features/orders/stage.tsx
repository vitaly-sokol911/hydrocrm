import { WarningOutlined } from '@ant-design/icons';
import { PERMISSIONS } from '@hydrocrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Form, Input, Modal, Select, Typography } from 'antd';
import { useCallback, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { useDictionaries } from '../../shared/hooks';
import type { Stage } from '../../shared/types';

interface Pending {
  orderId: string;
  number: string;
  from: Stage | { code: string; sort: number; name: string };
  to: Stage;
  /** Почему спрашиваем: возврат назад, отказ или блокировка проверками. */
  reason: 'back' | 'lost' | 'blocked';
  blockers?: string[];
}

/**
 * Смена этапа с правилами ЗАК-1…4: возврат назад и отказ спрашивают комментарий и причину,
 * блокировка проверками показывает, чего не хватает, а руководитель может пропустить проверки с комментарием.
 */
export function useStageChange() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { can } = useAuth();
  const dicts = useDictionaries();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

  const send = useCallback(
    async (p: Pending, extra: { comment?: string; lostReasonId?: string; override?: boolean } = {}) => {
      setBusy(true);
      try {
        const r = await api.post<{ overridden: boolean }>(`/orders/${p.orderId}/stage`, { stageCode: p.to.code, ...extra });
        message.success(`${p.number}: «${p.to.name}»${r.overridden ? ' (проверки пропущены)' : ''}`);
        setPending(null);
        form.resetFields();
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['orders'] }),
          qc.invalidateQueries({ queryKey: ['order', p.orderId] }),
          qc.invalidateQueries({ queryKey: ['comments', p.orderId] }),
          qc.invalidateQueries({ queryKey: ['dashboard'] }),
        ]);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'STAGE_TRANSITION_BLOCKED') {
          setPending({ ...p, reason: 'blocked', blockers: e.details?.map((d) => d.reason) ?? [e.message] });
        } else {
          message.error(e instanceof ApiError ? e.message : 'Не удалось сменить этап');
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [qc, message, form],
  );

  const change = useCallback(
    (order: { id: string; number: string; stage: Pending['from'] }, to: Stage) => {
      const p: Pending = { orderId: order.id, number: order.number, from: order.stage, to, reason: 'back' };
      if (to.kind === 'lost') return setPending({ ...p, reason: 'lost' });
      if (to.sort < order.stage.sort) return setPending({ ...p, reason: 'back' });
      void send(p);
    },
    [send],
  );

  const canOverride = can(PERMISSIONS.ordersOverrideChecks);
  let body: ReactNode = null;
  if (pending) {
    if (pending.reason === 'lost') {
      body = (
        <>
          <Form.Item name="lostReasonId" label="Причина отказа" rules={[{ required: true, message: 'Выберите причину' }]}>
            <Select options={(dicts.rejectReasons ?? []).map((r) => ({ value: r.id, label: r.name }))} />
          </Form.Item>
          <Form.Item name="comment" label="Комментарий">
            <Input.TextArea rows={2} />
          </Form.Item>
        </>
      );
    } else if (pending.reason === 'back') {
      body = (
        <Form.Item name="comment" label="Почему возвращаем назад" rules={[{ required: true, message: 'Напишите комментарий' }]}>
          <Input.TextArea rows={3} autoFocus placeholder="Например: при испытаниях выявили течь, возвращаем в ремонт" />
        </Form.Item>
      );
    } else {
      body = (
        <>
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message="Чего не хватает"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {pending.blockers?.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            }
            style={{ marginBottom: 16 }}
          />
          {canOverride ? (
            <Form.Item name="comment" label="Пропустить проверки (для руководителя)" rules={[{ required: true, message: 'Комментарий обязателен' }]} extra="Факт пропуска попадёт в ленту заказа и журнал действий">
              <Input.TextArea rows={2} placeholder="Например: клиент согласовал смету по телефону, документ пришлёт завтра" />
            </Form.Item>
          ) : (
            <Typography.Text type="secondary">Исправьте пункты выше и повторите. Пропустить проверки может только руководитель.</Typography.Text>
          )}
        </>
      );
    }
  }

  const modal = (
    <Modal
      open={!!pending}
      title={pending ? `${pending.number}: «${pending.from.name}» → «${pending.to.name}»` : ''}
      onCancel={() => {
        setPending(null);
        form.resetFields();
      }}
      okText={pending?.reason === 'blocked' ? (canOverride ? 'Пропустить проверки и перевести' : 'Понятно') : pending?.reason === 'lost' ? 'Закрыть заказ' : 'Перевести'}
      okButtonProps={{ danger: pending?.reason === 'lost' || (pending?.reason === 'blocked' && canOverride) }}
      confirmLoading={busy}
      onOk={() => {
        if (pending?.reason === 'blocked' && !canOverride) {
          setPending(null);
          return;
        }
        form.submit();
      }}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(v: { comment?: string; lostReasonId?: string }) => pending && send(pending, { ...v, override: pending.reason === 'blocked' })}
      >
        {body}
      </Form>
    </Modal>
  );

  return { change, modal, busy };
}
