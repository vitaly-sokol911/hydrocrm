import { PRIORITIES, PRIORITY_LABELS, taskCreateSchema } from '@hydrocrm/shared';
import { Col, DatePicker, Form, Input, Modal, Row, Select } from 'antd';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { dayjs } from '../../shared/format';
import { fieldErrors, useAction } from '../../shared/hooks';
import { UserSelect } from '../../shared/selects';

export interface TaskDefaults {
  orderId?: string;
  orderNumber?: string;
  clientId?: string;
  title?: string;
  assigneeId?: string;
}

/** ЗАД-1, ЗАД-2: задача из любой карточки или из сообщения. */
export function TaskModal({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: TaskDefaults }) {
  const [form] = Form.useForm();
  const { me } = useAuth();
  const create = useAction((v: unknown) => api.post('/tasks', v), {
    invalidate: [['tasks'], ['dashboard'], ['order']],
    success: 'Задача поставлена',
    onSuccess: onClose,
  });
  return (
    <Modal
      title={defaults?.orderNumber ? `Задача по ${defaults.orderNumber}` : 'Новая задача'}
      open={open}
      onCancel={onClose}
      okText="Поставить"
      onOk={() => form.submit()}
      confirmLoading={create.isPending}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          title: defaults?.title,
          assigneeId: defaults?.assigneeId ?? me?.user.id,
          priority: 'normal',
          dueAt: dayjs().add(1, 'day').hour(12).minute(0),
        }}
        onFinish={(v) => {
          const body = { ...v, dueAt: v.dueAt ? v.dueAt.toISOString() : null, orderId: defaults?.orderId, clientId: defaults?.clientId };
          const parsed = taskCreateSchema.safeParse(body);
          if (!parsed.success) {
            form.setFields(parsed.error.issues.map((i) => ({ name: i.path as string[], errors: [i.message] })));
            return;
          }
          create.mutate(parsed.data, { onError: (e) => form.setFields(fieldErrors(e)) });
        }}
      >
        <Form.Item name="title" label="Что сделать" rules={[{ required: true, message: 'Что нужно сделать' }]}>
          <Input autoFocus />
        </Form.Item>
        <Form.Item name="description" label="Подробности">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="assigneeId" label="Исполнитель" rules={[{ required: true, message: 'Кому' }]}>
              <UserSelect allowClear={false} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="dueAt" label="Срок">
              <DatePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="DD.MM HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="priority" label="Приоритет">
              <Select options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
