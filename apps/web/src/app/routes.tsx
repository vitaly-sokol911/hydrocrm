import { Spin } from 'antd';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../shared/auth';
import { RealtimeProvider } from '../shared/realtime';
import { AppLayout } from './Layout';
import { LoginPage } from '../features/auth/LoginPage';

const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage'));
const LeadsPage = lazy(() => import('../features/leads/LeadsPage'));
const OrdersPage = lazy(() => import('../features/orders/OrdersPage'));
const OrderPage = lazy(() => import('../features/orders/OrderPage'));
const ClientsPage = lazy(() => import('../features/clients/ClientsPage'));
const ClientPage = lazy(() => import('../features/clients/ClientPage'));
const EquipmentPage = lazy(() => import('../features/clients/EquipmentPage'));
const TasksPage = lazy(() => import('../features/tasks/TasksPage'));
const VisitsPage = lazy(() => import('../features/visits/VisitsPage'));
const VisitPage = lazy(() => import('../features/visits/VisitPage'));
const ChatPage = lazy(() => import('../features/chat/ChatPage'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage'));

const Loading = () => (
  <div style={{ display: 'grid', placeItems: 'center', height: '60vh' }}>
    <Spin size="large" />
  </div>
);

export function AppRoutes() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <RealtimeProvider>
      <AppLayout>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/leads/:id" element={<LeadsPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:id" element={<ClientPage />} />
            <Route path="/equipment/:id" element={<EquipmentPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/visits" element={<VisitsPage />} />
            <Route path="/visits/:id" element={<VisitPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppLayout>
    </RealtimeProvider>
  );
}
