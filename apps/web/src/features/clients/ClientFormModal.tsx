import { CLIENT_TYPE_LABELS, CLIENT_TYPES, clientSchema, normalizePhone } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, Checkbox, Col, Form, Input, InputNumber, Modal, Row, Segmented, Select } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api';
import { fieldErrors, useAction, useDictionaries } from '../../shared/hooks';
import { UserSelect } from '../../shared/selects';
import type { ClientDetail } from '../../shared/types';

/** Создание и редактирование клиента (КЛН-20…25), с проверкой дублей. */
export function ClientFormModal({ open, onClose, client }: { open: boolean; onClose: () => void; client?: ClientDetail }) {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const dicts = useDictionaries();
  const type = Form.useWatch('type', form) ?? client?.type ?? 'company';
  const [probe, setProbe] = useState<{ phone?: string; email?: string; inn?: string }>({});
  const dupes = useQuery({
    queryKey: ['clients', 'dupes', probe],
    queryFn: () => api.get<{ id: string; name: string }[]>('/clients/duplicates', { ...probe, excludeId: client?.id }),
    enabled: !!(probe.phone || probe.email || probe.inn),
  });
  const save = useAction(
    (v: unknown) => (client ? api.patch<{ id: string }>(`/clients/${client.id}`, v, { version: client.version }) : api.post<{ id: string }>('/clients', v)),
    {
      invalidate: [['clients'], ['client']],
      success: client ? 'Сохранено' : 'Клиент создан',
      onSuccess: (c) => {
        onClose();
        if (!client) navigate(`/clients/${c.id}`);
      },
    },
  );
  const legal = type !== 'person';

  return (
    <Modal
      title={client ? 'Редактирование клиента' : 'Новый клиент'}
      open={open}
      onCancel={onClose}
      okText={client ? 'Сохранить' : 'Создать'}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      width={680}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={client ? { ...client, pdConsent: !!client.pdConsentAt } : { type: 'company', paymentTermsDays: 0, tags: [] }}
        onValuesChange={(ch: Record<string, string>) => {
          if ('phone' in ch || 'email' in ch || 'inn' in ch) {
            const v = form.getFieldsValue(['phone', 'email', 'inn']);
            setProbe({ phone: normalizePhone(v.phone) ?? undefined, email: v.email || undefined, inn: v.inn?.length >= 10 ? v.inn : undefined });
          }
        }}
        onFinish={(v) => {
          const parsed = clientSchema.safeParse(v);
          if (!parsed.success) {
            form.setFields(parsed.error.issues.map((i) => ({ name: i.path as string[], errors: [i.message] })));
            return;
          }
          save.mutate(parsed.data, { onError: (e) => form.setFields(fieldErrors(e)) });
        }}
      >
        <Form.Item name="type">
          <Segmented block options={CLIENT_TYPES.map((t) => ({ value: t, label: CLIENT_TYPE_LABELS[t] }))} />
        </Form.Item>
        <Form.Item name="name" label={legal ? 'Название' : 'ФИО'} rules={[{ required: true, message: 'Обязательное поле' }]}>
          <Input placeholder={legal ? 'ООО «Пример»' : 'Иванов Иван Иванович'} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label="Телефон">
              <Input inputMode="tel" placeholder="+7 900 000-00-00" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="email" label="Email">
              <Input type="email" />
            </Form.Item>
          </Col>
        </Row>
        {!!dupes.data?.length && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Похоже, клиент уже есть"
            description={dupes.data.map((d) => (
              <div key={d.id}>
                <Link to={`/clients/${d.id}`} onClick={onClose}>
                  {d.name}
                </Link>
              </div>
            ))}
          />
        )}
        {legal && (
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              <Form.Item name="inn" label="ИНН">
                <Input maxLength={12} inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="kpp" label="КПП">
                <Input maxLength={9} inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col xs={12} sm={8}>
              <Form.Item name="ogrn" label="ОГРН">
                <Input maxLength={15} inputMode="numeric" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="legalAddress" label="Юридический адрес">
                <Input />
              </Form.Item>
            </Col>
          </Row>
        )}
        <Form.Item name="address" label="Адрес для выездов">
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="managerId" label="Менеджер">
              <UserSelect role="manager" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="sourceId" label="Источник">
              <Select allowClear options={(dicts.leadSources ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="paymentTermsDays" label="Отсрочка, дней">
              <InputNumber min={0} max={365} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="tags" label="Метки">
          <Select mode="tags" options={['ключевой', 'дилер', 'гарантия', 'проблемный'].map((t) => ({ value: t }))} />
        </Form.Item>
        <Form.Item name="note" label="Заметка">
          <Input.TextArea rows={2} />
        </Form.Item>
        {type === 'person' && (
          <Form.Item name="pdConsent" valuePropName="checked">
            <Checkbox>Согласие на обработку персональных данных получено</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
