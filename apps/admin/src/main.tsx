import { QueryClientProvider } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError, EmptyState, errorMessage, getInitData, initTelegram, Spinner, ToastProvider } from '@wag/web';
import '@wag/web/styles.css';
import './styles/admin.css';
import { queryClient, useMe } from './api/queries';
import { AdminLayout } from './components/AdminLayout';
import { BroadcastPage } from './pages/BroadcastPage';
import { DashboardPage } from './pages/DashboardPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { ProductEditorPage } from './pages/ProductEditorPage';
import { ProductsPage } from './pages/ProductsPage';
import { UsersPage } from './pages/UsersPage';

initTelegram();

const router = createBrowserRouter(
  [
    {
      element: <AdminLayout />,
      children: [
        { path: '/', element: <DashboardPage /> },
        { path: '/products', element: <ProductsPage /> },
        { path: '/products/new', element: <ProductEditorPage /> },
        { path: '/products/:id', element: <ProductEditorPage /> },
        { path: '/orders', element: <OrdersPage /> },
        { path: '/orders/:id', element: <OrderDetailPage /> },
        { path: '/users', element: <UsersPage /> },
        { path: '/broadcast', element: <BroadcastPage /> },
        { path: '*', element: <DashboardPage /> },
      ],
    },
  ],
  { basename: '/admin' },
);

function Gate({ children }: { children: ReactNode }) {
  const hasInitData = Boolean(getInitData());
  const { data: me, isPending, error } = useMe();

  if (!hasInitData) {
    return (
      <EmptyState
        icon={<ShieldAlert size={26} strokeWidth={1.5} />}
        title="Откройте админ-панель в Telegram"
        text="Отправьте боту команду /admin и нажмите «Открыть админ-панель»."
      />
    );
  }
  if (isPending) {
    return (
      <div className="page-loader">
        <Spinner />
      </div>
    );
  }
  if (error || !me?.isAdmin) {
    return (
      <EmptyState
        icon={<ShieldAlert size={26} strokeWidth={1.5} />}
        title="Нет доступа"
        text={
          error instanceof ApiError && error.status !== 403
            ? errorMessage(error)
            : 'Админ-панель доступна только администраторам магазина.'
        }
      />
    );
  }
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Gate>
          <RouterProvider router={router} />
        </Gate>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
