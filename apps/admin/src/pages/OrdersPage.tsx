import { ReceiptText } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatPhone, formatPrice, ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from '@wag/shared';
import { EmptyState, ErrorState, errorMessage, formatDateTime, plural, Spinner } from '@wag/web';
import { useAdminOrders } from '../api/queries';
import { ListSkeleton, PageHeader, SearchInput, StatusBadge } from '../components/common';

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status');
  const status: OrderStatus | 'all' = ORDER_STATUSES.includes(statusParam as OrderStatus)
    ? (statusParam as OrderStatus)
    : 'all';
  const q = params.get('q') ?? '';

  const update = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const onSearch = useCallback((v: string) => update('q', v || null), [update]);

  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching } =
    useAdminOrders(status, q);
  const orders = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="container">
      <PageHeader title="Заказы" subtitle={data && `${total} ${plural(total, 'заказ', 'заказа', 'заказов')}`} />

      <SearchInput
        value={q}
        onChange={onSearch}
        placeholder="№ заказа, имя, телефон, @username"
      />

      <div className="chips toolbar-chips">
        <button type="button" className="chip" aria-pressed={status === 'all'} onClick={() => update('status', null)}>
          Все
        </button>
        {ORDER_STATUSES.map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => update('status', s)}>
            {ORDER_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ReceiptText size={26} strokeWidth={1.5} />}
          title={q || status !== 'all' ? 'Ничего не найдено' : 'Заказов пока нет'}
          text={q || status !== 'all' ? 'Измените поиск или фильтр.' : 'Новые заказы появятся здесь.'}
        />
      ) : (
        <div className={`list ${isFetching && !isFetchingNextPage ? 'is-refreshing' : ''}`}>
          {orders.map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="list-row order-row">
              <div className="order-row-main">
                <div className="order-row-top">
                  <span className="order-number">№{o.id}</span>
                  <StatusBadge status={o.status} />
                </div>
                <div className="list-row-title">{o.customerName}</div>
                <div className="list-row-meta">
                  <span>{formatPhone(o.phone)}</span>
                  {(o.telegramUsername ?? o.user.username) && <span>@{o.telegramUsername ?? o.user.username}</span>}
                </div>
                <div className="list-row-meta">
                  <span>{formatDateTime(o.createdAt)}</span>
                  <span>
                    · {o.itemsCount} {plural(o.itemsCount, 'товар', 'товара', 'товаров')}
                  </span>
                </div>
              </div>
              <div className="order-row-total">{formatPrice(o.totalAmount)}</div>
            </Link>
          ))}
          {hasNextPage && (
            <button
              type="button"
              className="btn btn-secondary btn-block load-more"
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? <Spinner size={18} /> : 'Показать ещё'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
