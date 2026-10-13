import { LEAD_CHANNEL_LABELS, LEAD_CHANNELS, leadCreateSchema } from '@hydrocrm/shared';
import { Checkbox, Col, Form, Input, Modal, Row, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api';
import { fieldErrors, useAction, useDictionaries } from '../../shared/hooks';
import { ClientSelect, UserSelect } from '../../shared/selects';
import type { Lead } from '../../shared/types';

/** ЗАЯ-1: быстрая форма заявки — создание за 30 секунд. */
export function LeadCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const dicts = useDictionaries();
  const navigate = useNavigate();
  const create = useAction((v: unknown) => api.post<Lead>('/leads', leadCreateSchema.parse(v)), {
    invalidate: [['leads'], ['dashboard']],
    success: (l) => `Заявка ${l.number} создана`,
    onSuccess: (l) => {
      onClose();
      navigate(`/leads/${l.id}`);
    },
  });
  return (
    <Modal
      title="Новая заявка"
      open={open}
      onCancel={onClose}
      okText="Создать"
      confirmLoading={create.isPending}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ channel: 'phone' }}
        onFinish={(v) => {
          const parsed = leadCreateSchema.safeParse(v);
          if (!parsed.success) {
            form.setFields(parsed.error.issues.map((i) => ({ name: i.path as string[], errors: [i.message] })));
            return;
          }
          create.mutate(v, { onError: (e) => form.setFields(fieldErrors(e)) });
        }}
      >
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="channel" label="Канал">
              <Select options={LEAD_CHANNELS.map((c) => ({ value: c, label: LEAD_CHANNEL_LABELS[c] }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="sourceId" label="Источник">
              <Select allowClear placeholder="Откуда узнали" options={(dicts.leadSources ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="clientId" label="Клиент" extra="Если клиент уже есть в базе. Иначе укажите телефон — система сама найдёт совпадение.">
          <ClientSelect allowClear />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="contactName" label="Имя">
              <Input placeholder="Как обращаться" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label="Телефон">
              <Input placeholder="+7 900 000-00-00" inputMode="tel" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="email" label="Email">
          <Input type="email" />
        </Form.Item>
        <Form.Item name="description" label="Что нужно" rules={[{ required: true, message: 'Опишите запрос' }]}>
          <Input.TextArea rows={3} placeholder="Например: течёт насос на гидростанции пресса, нужна диагностика" autoFocus />
        </Form.Item>
        <Row gutter={12} align="middle">
          <Col xs={24} sm={12}>
            <Form.Item name="assigneeId" label="Ответственный" extra="Пусто — назначит система">
              <UserSelect role="manager" placeholder="Автоматически" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="isStatusQuestion" valuePropName="checked">
              <Checkbox>Вопрос по статусу заказа</Checkbox>
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
