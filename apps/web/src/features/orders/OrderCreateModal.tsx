import { ORDER_TYPE_LABELS, ORDER_TYPES, orderCreateSchema, PRIORITIES, PRIORITY_LABELS, type OrderType } from '@hydrocrm/shared';
import { Checkbox, Col, DatePicker, Form, Input, InputNumber, Modal, Radio, Row, Select, Switch } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api';
import { fieldErrors, useAction } from '../../shared/hooks';
import { ClientSelect, EquipmentSelect, UserSelect } from '../../shared/selects';

export interface OrderDefaults {
  type?: OrderType;
  clientId?: string;
  clientName?: string;
  equipmentId?: string;
}

/** ЗАК-20: создание заказа с нуля, из клиента или с карточки оборудования. */
export function OrderCreateModal({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: OrderDefaults }) {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const type: OrderType = Form.useWatch('type', form) ?? defaults?.type ?? 'repair_workshop';
  const clientId: string | undefined = Form.useWatch('clientId', form) ?? defaults?.clientId;
  const [newEq, setNewEq] = useState(false);
  const create = useAction((v: unknown) => api.post<{ id: string; number: string }>('/orders', v), {
    invalidate: [['orders'], ['dashboard'], ['client']],
    success: (o) => `Заказ ${o.number} создан`,
    onSuccess: (o) => {
      onClose();
      navigate(`/orders/${o.id}`);
    },
  });
  const isRepair = type.startsWith('repair');

  return (
    <Modal title="Новый заказ" open={open} onCancel={onClose} okText="Создать заказ" confirmLoading={create.isPending} onOk={() => form.submit()} width={640} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: defaults?.type ?? 'repair_workshop', clientId: defaults?.clientId, equipmentId: defaults?.equipmentId, priority: 'normal' }}
        onFinish={(v) => {
          const body = {
            ...v,
            plannedFinishAt: v.plannedFinishAt ? v.plannedFinishAt.endOf('day').toISOString() : undefined,
            masterIds: v.masterIds ?? [],
            newEquipment: newEq ? v.newEquipment : undefined,
            equipmentId: newEq ? undefined : v.equipmentId,
          };
          const parsed = orderCreateSchema.safeParse(body);
          if (!parsed.success) {
            form.setFields(parsed.error.issues.map((i) => ({ name: i.path as string[], errors: [i.message] })));
            return;
          }
          create.mutate(parsed.data, { onError: (e) => form.setFields(fieldErrors(e)) });
        }}
      >
        <Form.Item name="type" label="Тип заказа">
          <Radio.Group optionType="button" buttonStyle="solid" options={ORDER_TYPES.map((t) => ({ value: t, label: ORDER_TYPE_LABELS[t] }))} />
        </Form.Item>
        <Form.Item name="clientId" label="Клиент" rules={[{ required: true, message: 'Выберите клиента' }]}>
          <ClientSelect initialLabel={defaults?.clientName} onChange={() => form.setFieldValue('equipmentId', undefined)} />
        </Form.Item>
        {isRepair && (
          <>
            <Form.Item label="Оборудование" style={{ marginBottom: newEq ? 8 : undefined }}>
              <Row gutter={8} align="middle">
                <Col flex="auto">
                  {!newEq && (
                    <Form.Item name="equipmentId" noStyle>
                      <EquipmentSelect clientId={clientId} />
                    </Form.Item>
                  )}
                </Col>
                <Col>
                  <Checkbox checked={newEq} onChange={(e) => setNewEq(e.target.checked)} disabled={!clientId}>
                    Новая станция
                  </Checkbox>
                </Col>
              </Row>
            </Form.Item>
            {newEq && (
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item name={['newEquipment', 'name']} label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
                    <Input placeholder="Гидростанция пресса" />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Item name={['newEquipment', 'model']} label="Модель">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Item name={['newEquipment', 'serialNumber']} label="Серийный №">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name={['newEquipment', 'manufacturer']} label="Производитель">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name={['newEquipment', 'pressureBar']} label="Давление, бар">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name={['newEquipment', 'motorPowerKw']} label="Мощность, кВт">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            )}
          </>
        )}
        <Form.Item name="title" label="Кратко" rules={[{ required: true, message: 'Кратко опишите заказ' }]}>
          <Input placeholder={isRepair ? 'Например: не набирает давление' : 'Например: гидростанция 15 кВт для пресса'} />
        </Form.Item>
        <Form.Item name="complaint" label={isRepair ? 'Жалоба клиента' : 'Техническое задание'}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="managerId" label="Менеджер" extra="Пусто — менеджер клиента">
              <UserSelect role="manager" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="masterIds" label="Мастера">
              <UserSelect role="master" mode="multiple" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="priority" label="Приоритет">
              <Select options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="plannedFinishAt" label="Срок готовности" extra="Пусто — по нормам этапов">
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          {isRepair && (
            <Col xs={24} sm={8}>
              <Form.Item name="isWarrantyCase" label="Гарантийный" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          )}
        </Row>
      </Form>
    </Modal>
  );
}
