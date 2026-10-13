import { Alert, Col, DatePicker, Form, Input, Modal, Row, TimePicker } from 'antd';
import { useState } from 'react';
import { api } from '../../shared/api';
import { dayjs } from '../../shared/format';
import { fieldErrors, useAction, useUsers } from '../../shared/hooks';
import { UserSelect } from '../../shared/selects';
import type { OrderDetail } from '../../shared/types';

interface Result {
  warnings: { orderNumber: string; start: string; masterIds: string[] }[];
}

/** ВЫЕ-1…3: планирование выезда из заказа с предупреждением о пересечениях. */
export function VisitFormModal({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const [form] = Form.useForm();
  const { name } = useUsers();
  const [warnings, setWarnings] = useState<Result['warnings']>([]);
  const create = useAction((v: unknown) => api.post<Result>('/visits', v), {
    invalidate: [['order', order.id], ['visits'], ['comments', order.id], ['dashboard']],
    success: 'Выезд запланирован',
    onSuccess: (r) => {
      if (r.warnings.length) setWarnings(r.warnings);
      else onClose();
    },
  });
  if (warnings.length) {
    return (
      <Modal title="Выезд запланирован" open onCancel={onClose} onOk={onClose} cancelButtonProps={{ style: { display: 'none' } }}>
        <Alert
          type="warning"
          showIcon
          message="Пересечение по времени"
          description={warnings.map((w) => (
            <div key={w.orderNumber + w.start}>
              {w.masterIds.map(name).join(', ')} уже на выезде {w.orderNumber} в {dayjs(w.start).format('DD.MM HH:mm')}
            </div>
          ))}
        />
        <p style={{ marginTop: 12 }}>Время можно поправить в календаре выездов перетаскиванием.</p>
      </Modal>
    );
  }
  return (
    <Modal title={`Выезд по ${order.number}`} open onCancel={onClose} okText="Запланировать" onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          date: dayjs().add(1, 'day'),
          time: [dayjs().hour(10).minute(0), dayjs().hour(13).minute(0)],
          address: order.client.address,
          contactName: order.contact?.fullName,
          contactPhone: order.contact?.phone ?? order.client.phone,
          masterIds: order.assignees.map((a) => a.userId),
        }}
        onFinish={(v) => {
          const day = v.date as dayjs.Dayjs;
          const [from, to] = v.time as [dayjs.Dayjs, dayjs.Dayjs];
          create.mutate(
            {
              orderId: order.id,
              plannedStartAt: day.hour(from.hour()).minute(from.minute()).second(0).toISOString(),
              plannedEndAt: day.hour(to.hour()).minute(to.minute()).second(0).toISOString(),
              address: v.address,
              contactName: v.contactName,
              contactPhone: v.contactPhone,
              masterIds: v.masterIds ?? [],
            },
            { onError: (e) => form.setFields(fieldErrors(e)) },
          );
        }}
      >
        <Row gutter={12}>
          <Col xs={12}>
            <Form.Item name="date" label="Дата" rules={[{ required: true }]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12}>
            <Form.Item name="time" label="Время" rules={[{ required: true }]}>
              <TimePicker.RangePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="masterIds" label="Мастера" rules={[{ required: true, message: 'Назначьте мастера' }]}>
          <UserSelect role="master" mode="multiple" />
        </Form.Item>
        <Form.Item name="address" label="Адрес объекта" rules={[{ required: true, message: 'Укажите адрес' }]}>
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={12}>
            <Form.Item name="contactName" label="Контакт на объекте">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12}>
            <Form.Item name="contactPhone" label="Телефон">
              <Input inputMode="tel" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
