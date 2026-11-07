import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { getInitData, initTelegram, Spinner, ToastProvider } from '@wag/web';
import '@wag/web/styles.css';
import './styles/app.css';
import { queryClient } from './api/queries';
import { AppLayout } from './components/AppLayout';
import { CartPage } from './pages/CartPage';
import { CatalogPage } from './pages/CatalogPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OpenInTelegramPage } from './pages/OpenInTelegramPage';
import { ProductPage } from './pages/ProductPage';

// Форма заказа тянет валидацию телефонов (libphonenumber) — грузим её отдельным чанком.
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const OrderSuccessPage = lazy(() =>
  import('./pages/OrderSuccessPage').then((m) => ({ default: m.OrderSuccessPage })),
);

initTelegram();

const fallback = (
  <div className="page-loader">
    <Spinner />
  </div>
);

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/catalog', element: <CatalogPage /> },
      { path: '/product/:id', element: <ProductPage /> },
      { path: '/cart', element: <CartPage /> },
      {
        path: '/checkout',
        element: (
          <Suspense fallback={fallback}>
            <CheckoutPage />
          </Suspense>
        ),
      },
      {
        path: '/order/:id',
        element: (
          <Suspense fallback={fallback}>
            <OrderSuccessPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{getInitData() ? <RouterProvider router={router} /> : <OpenInTelegramPage />}</ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
