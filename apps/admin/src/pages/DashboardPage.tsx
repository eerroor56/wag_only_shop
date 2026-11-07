import { ChevronRight, Plus, Store } from 'lucide-react';
import { Link } from 'react-router';
import { formatPrice } from '@wag/shared';
import { ErrorState, errorMessage, Skeleton } from '@wag/web';
import { useDashboard, useMe } from '../api/queries';
import { PageHeader } from '../components/common';

export function DashboardPage() {
  const { data, isPending, isError, error, refetch } = useDashboard();
  const { data: me } = useMe();

  const stats = data
    ? [
        { label: 'Новые заказы', value: data.ordersNew, to: '/orders?status=new', accent: data.ordersNew > 0 },
        { label: 'Заказов сегодня', value: data.ordersToday, to: '/orders' },
        { label: 'Сумма за сегодня', value: formatPrice(data.revenueToday), to: '/orders', wide: true },
        { label: 'Товаров', value: data.productsTotal, to: '/products' },
        { label: 'Активных товаров', value: data.productsActive, to: '/products' },
        { label: 'Пользователей', value: data.usersTotal, to: '/users', wide: true },
      ]
    : [];

  return (
    <div className="container">
      <PageHeader
        title="Dashboard"
        subtitle={me ? `Здравствуйте, ${me.firstName || 'администратор'}` : 'WAG Shop'}
        action={
          // Mini App магазина — отдельное приложение на том же домене.
          <a href="/" className="btn btn-outline btn-sm">
            <Store size={15} /> В магазин
          </a>
        }
      />

      {isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <div className="stats-grid">
          {isPending
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="stat-card" style={{ height: 88 }} />)
            : stats.map((s) => (
                <Link key={s.label} to={s.to} className={`stat-card ${s.accent ? 'is-accent' : ''} ${s.wide ? 'is-wide' : ''}`}>
                  <span className="stat-label">{s.label}</span>
                  <span className="stat-value">{s.value}</span>
                </Link>
              ))}
        </div>
      )}

      {data && (
        <p className="caption dashboard-note">
          «Сегодня» — по времени магазина ({data.timezone}). Сумма не учитывает отменённые заказы.
        </p>
      )}

      <div className="quick-actions">
        <Link to="/products/new" className="btn btn-primary btn-lg btn-block">
          <Plus size={18} strokeWidth={2} />
          Добавить товар
        </Link>
        <Link to="/broadcast" className="list-link">
          <span>Сделать рассылку</span>
          <ChevronRight size={18} />
        </Link>
      </div>
    </div>
  );
}
