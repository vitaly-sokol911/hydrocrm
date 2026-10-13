import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ClientFormModal } from '../clients/ClientFormModal';
import { LeadCreateModal } from '../leads/LeadCreateModal';
import { OrderCreateModal, type OrderDefaults } from '../orders/OrderCreateModal';
import { TaskModal, type TaskDefaults } from '../tasks/TaskModal';

type Kind = 'lead' | 'order' | 'client' | 'task';
interface Defaults {
  order?: OrderDefaults;
  task?: TaskDefaults;
}

const Ctx = createContext<{ open: (k: Kind, d?: Defaults) => void } | null>(null);

/** Кнопка «+ Создать» доступна с любого экрана (ЗАЯ-1, ЗАД-2). */
export function CreateProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [defaults, setDefaults] = useState<Defaults>({});
  const open = useCallback((k: Kind, d: Defaults = {}) => {
    setDefaults(d);
    setKind(k);
  }, []);
  const close = () => setKind(null);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {kind === 'lead' && <LeadCreateModal open onClose={close} />}
      {kind === 'order' && <OrderCreateModal open onClose={close} defaults={defaults.order} />}
      {kind === 'client' && <ClientFormModal open onClose={close} />}
      {kind === 'task' && <TaskModal open onClose={close} defaults={defaults.task} />}
    </Ctx.Provider>
  );
}

export function useCreate() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCreate вне CreateProvider');
  return ctx;
}
