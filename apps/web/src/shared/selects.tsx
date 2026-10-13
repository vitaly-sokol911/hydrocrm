import { CLIENT_TYPE_LABELS, formatPhone } from '@hydrocrm/shared';
import { useQuery } from '@tanstack/react-query';
import { Select, type SelectProps } from 'antd';
import { useState } from 'react';
import { api } from './api';
import { useUsers } from './hooks';
import type { ClientDetail, ClientListItem, Paged } from './types';
import { UserAvatar } from './ui';

/** Выбор клиента с поиском по названию, телефону, ИНН, серийному номеру. */
export function ClientSelect(props: Omit<SelectProps<string>, 'options'> & { initialLabel?: string }) {
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['clients', 'select', q],
    queryFn: () => api.get<Paged<ClientListItem>>('/clients', { q, pageSize: 20 }),
  });
  const options = (list.data?.items ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    desc: `${CLIENT_TYPE_LABELS[c.type]}${c.phone ? ' · ' + formatPhone(c.phone) : ''}`,
  }));
  if (props.value && props.initialLabel && !options.some((o) => o.value === props.value)) {
    options.unshift({ value: props.value as string, label: props.initialLabel, desc: '' });
  }
  return (
    <Select
      showSearch
      filterOption={false}
      onSearch={setQ}
      loading={list.isFetching}
      placeholder="Найдите клиента"
      notFoundContent={list.isFetching ? 'Ищем…' : 'Не найдено'}
      optionRender={(o) => (
        <div>
          <div>{o.data.label}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {o.data.desc}
          </div>
        </div>
      )}
      options={options}
      {...props}
    />
  );
}

export function EquipmentSelect({ clientId, ...props }: Omit<SelectProps<string>, 'options'> & { clientId?: string | null }) {
  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.get<ClientDetail>(`/clients/${clientId}`),
    enabled: !!clientId,
  });
  return (
    <Select
      placeholder={clientId ? 'Станция клиента' : 'Сначала выберите клиента'}
      disabled={!clientId}
      allowClear
      options={(client.data?.equipment ?? []).map((e) => ({
        value: e.id,
        label: `${e.name}${e.model ? ` (${e.model})` : ''}${e.serialNumber ? ` · ${e.serialNumber}` : ''}`,
      }))}
      {...props}
    />
  );
}

export function UserSelect({ role, ...props }: Omit<SelectProps<string | string[]>, 'options'> & { role?: string | string[] }) {
  const { users } = useUsers();
  const roles = role ? (Array.isArray(role) ? role : [role]) : null;
  const list = users.filter((u) => u.isActive && (!roles || u.roles.some((r) => roles.includes(r))));
  return (
    <Select
      showSearch
      optionFilterProp="label"
      allowClear
      options={list.map((u) => ({ value: u.id, label: u.fullName }))}
      optionRender={(o) => <UserAvatar userId={o.value as string} withName size={20} />}
      {...props}
    />
  );
}
