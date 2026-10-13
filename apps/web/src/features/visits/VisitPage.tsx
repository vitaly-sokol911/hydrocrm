import { ArrowLeftOutlined, CameraOutlined, CarOutlined, CheckCircleOutlined, CloudUploadOutlined, EnvironmentOutlined, PhoneOutlined } from '@ant-design/icons';
import { PERMISSIONS, VISIT_RESULT_LABELS, VISIT_RESULTS, VISIT_STATUS_LABELS, type VisitResult, type VisitStatus } from '@hydrocrm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Image, Input, InputNumber, Modal, Radio, Result, Skeleton, Space, Steps, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { dayjs, fmtDateTime, fmtTime } from '../../shared/format';
import type { Visit } from '../../shared/types';
import { uploadFile } from '../../shared/upload';
import { Avatars, Phone } from '../../shared/ui';

// ---------- Офлайн-очередь (ВЫЕ-40) ----------
// Нажатия кнопок мастера сохраняются на устройстве и отправляются, когда появится связь.
// Время события берётся с устройства, поэтому в заказе оно будет правильным.
interface QueuedAction {
  visitId: string;
  body: { status: VisitStatus; result?: VisitResult; report?: string; travelKm?: number | null; at: string };
}
const QUEUE_KEY = 'hcrm-visit-queue';
const readQueue = (): QueuedAction[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
};
const writeQueue = (q: QueuedAction[]) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* хранилище недоступно */
  }
};

function useVisitQueue(onFlushed: () => void) {
  const [pending, setPending] = useState(() => readQueue().length);
  const flush = async () => {
    const q = readQueue();
    while (q.length) {
      try {
        await api.post(`/visits/${q[0].visitId}/status`, q[0].body);
        q.shift();
        writeQueue(q);
      } catch (e) {
        if (e instanceof ApiError && e.status > 0) {
          q.shift(); // ошибка бизнес-логики — повтор не поможет
          writeQueue(q);
        } else break; // нет сети — ждём
      }
    }
    setPending(q.length);
    onFlushed();
  };
  useEffect(() => {
    const on = () => void flush();
    window.addEventListener('online', on);
    void flush();
    return () => window.removeEventListener('online', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const push = async (a: QueuedAction) => {
    writeQueue([...readQueue(), a]);
    setPending(readQueue().length);
    await flush();
  };
  return { pending, push };
}

const STEPS: VisitStatus[] = ['planned', 'on_the_way', 'on_site', 'done'];

/** Экран «Мой выезд» для мастера со смартфона (ИНФ-23, ВЫЕ-10…15). */
export default function VisitPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const { message } = App.useApp();
  const q = useQuery({ queryKey: ['visit', id], queryFn: () => api.get<Visit>(`/visits/${id}`) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['visit', id] });
    qc.invalidateQueries({ queryKey: ['visits'] });
  };
  const { pending, push } = useVisitQueue(refresh);
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState<VisitResult>('fixed');
  const [report, setReport] = useState('');
  const [km, setKm] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const camera = useRef<HTMLInputElement>(null);

  if (q.isError) return <Result status="404" title="Выезд не найден" extra={<Link to="/visits">К выездам</Link>} />;
  const v = q.data;
  if (!v) return <Skeleton active />;
  const isMaster = v.assignees.some((a) => a.userId === me?.user.id);
  const canAct = (isMaster && can(PERMISSIONS.visitsWork)) || can(PERMISSIONS.visitsPlan);
  const step = STEPS.indexOf(v.status);

  const act = async (status: VisitStatus, extra: Partial<QueuedAction['body']> = {}) => {
    await push({ visitId: v.id, body: { status, at: new Date().toISOString(), ...extra } });
    if (!navigator.onLine) message.info('Нет связи — отправим, как только появится сеть');
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      await Promise.all([...files].map((f) => uploadFile(f, { orderId: v.orderId, visitId: v.id })));
      message.success('Фото загружены');
      refresh();
    } catch {
      message.error('Не удалось загрузить фото — проверьте связь');
    } finally {
      setUploading(false);
    }
  };
  const mapsUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(v.address)}`;
  const photos = (v.files ?? []).filter((f) => f.mimeType.startsWith('image/'));

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <Space style={{ marginBottom: 8 }}>
        <a className="muted" onClick={() => navigate(-1)}>
          <ArrowLeftOutlined /> Назад
        </a>
      </Space>
      {pending > 0 && <Alert type="warning" showIcon icon={<CloudUploadOutlined />} message={`Не отправлено действий: ${pending}. Отправим автоматически, когда появится связь`} style={{ marginBottom: 12 }} />}
      <Card>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space wrap>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Выезд {dayjs(v.plannedStartAt).format('D MMMM')}, {fmtTime(v.plannedStartAt)}–{fmtTime(v.plannedEndAt)}
            </Typography.Title>
            <Tag color={v.status === 'done' ? 'green' : v.status === 'on_site' ? 'purple' : 'blue'}>{VISIT_STATUS_LABELS[v.status]}</Tag>
          </Space>
          {v.order && (
            <Typography.Text>
              <Link to={`/orders/${v.order.id}`}>{v.order.number}</Link> · {v.order.client.name} · {v.order.title}
            </Typography.Text>
          )}
          {v.order?.equipment && <Typography.Text type="secondary">{v.order.equipment.name} {v.order.equipment.model} {v.order.equipment.serialNumber && `№ ${v.order.equipment.serialNumber}`}</Typography.Text>}
          <Avatars ids={v.assignees.map((a) => a.userId)} />
        </Space>
        <Space wrap style={{ marginTop: 16, width: '100%' }}>
          <Button size="large" icon={<EnvironmentOutlined />} href={mapsUrl} target="_blank">
            Маршрут
          </Button>
          {v.contactPhone && (
            <Button size="large" icon={<PhoneOutlined />} href={`tel:${v.contactPhone}`}>
              {v.contactName ?? 'Позвонить'}
            </Button>
          )}
        </Space>
        <Typography.Paragraph style={{ marginTop: 12 }}>
          <EnvironmentOutlined /> {v.address}
          {v.contactName && (
            <>
              <br />
              Контакт: {v.contactName} <Phone value={v.contactPhone} />
            </>
          )}
        </Typography.Paragraph>
        {v.order?.complaint && <Alert type="info" message="Что случилось" description={v.order.complaint} style={{ marginBottom: 12 }} />}
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Steps
          size="small"
          current={step}
          responsive={false}
          labelPlacement="vertical"
          items={STEPS.map((s) => ({
            title: VISIT_STATUS_LABELS[s],
            description: s === 'on_the_way' ? fmtTime(v.departedAt) : s === 'on_site' ? fmtTime(v.arrivedAt) : s === 'done' ? fmtTime(v.finishedAt) : undefined,
          }))}
        />
        {canAct && v.status !== 'done' && v.status !== 'cancelled' && (
          <Space direction="vertical" style={{ width: '100%', marginTop: 20 }} size={12}>
            {v.status === 'planned' && (
              <Button type="primary" block className="big-btn" icon={<CarOutlined />} onClick={() => act('on_the_way')}>
                Выехал
              </Button>
            )}
            {(v.status === 'planned' || v.status === 'on_the_way') && (
              <Button type={v.status === 'on_the_way' ? 'primary' : 'default'} block className="big-btn" icon={<EnvironmentOutlined />} onClick={() => act('on_site')}>
                На месте
              </Button>
            )}
            {v.status === 'on_site' && (
              <Button type="primary" block className="big-btn" icon={<CheckCircleOutlined />} onClick={() => setFinishing(true)}>
                Работы завершены
              </Button>
            )}
            <input ref={camera} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => upload(e.target.files)} />
            <Button block className="big-btn" icon={<CameraOutlined />} loading={uploading} onClick={() => camera.current?.click()}>
              Фото
            </Button>
          </Space>
        )}
        {v.status === 'done' && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text strong>{v.result && VISIT_RESULT_LABELS[v.result]}</Typography.Text>
            {v.report && <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{v.report}</Typography.Paragraph>}
            <Typography.Text type="secondary">
              Завершён {fmtDateTime(v.finishedAt)}
              {v.travelKm && ` · пробег ${Number(v.travelKm)} км`}
            </Typography.Text>
          </div>
        )}
        {!!photos.length && (
          <Image.PreviewGroup>
            <Space wrap style={{ marginTop: 12 }}>
              {photos.map((f) => (
                <Image key={f.id} src={f.url} width={88} height={66} style={{ objectFit: 'cover', borderRadius: 6 }} />
              ))}
            </Space>
          </Image.PreviewGroup>
        )}
      </Card>

      <Modal
        title="Работы на объекте завершены"
        open={finishing}
        onCancel={() => setFinishing(false)}
        okText="Завершить выезд"
        onOk={async () => {
          setFinishing(false);
          await act('done', { result, report: report || undefined, travelKm: km });
        }}
      >
        <Typography.Text strong>Результат</Typography.Text>
        <Radio.Group value={result} onChange={(e) => setResult(e.target.value)} style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0 16px' }}>
          {VISIT_RESULTS.map((r) => (
            <Radio key={r} value={r}>
              {VISIT_RESULT_LABELS[r]}
            </Radio>
          ))}
        </Radio.Group>
        {result === 'need_workshop' && <Alert type="info" showIcon message="Система создаст заказ «Ремонт в цеху» с этим клиентом, оборудованием, фото и отчётом" style={{ marginBottom: 12 }} />}
        <Input.TextArea rows={4} placeholder="Что сделано (можно надиктовать голосом с клавиатуры)" value={report} onChange={(e) => setReport(e.target.value)} />
        <Space style={{ marginTop: 12 }}>
          Пробег, км <InputNumber min={0} value={km} onChange={setKm} />
        </Space>
      </Modal>
    </div>
  );
}
