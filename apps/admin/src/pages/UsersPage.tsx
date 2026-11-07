import { Users } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, plural, Spinner } from '@wag/web';
import { useAdminUsers } from '../api/queries';
import { ListSkeleton, PageHeader, SearchInput } from '../components/common';

export function UsersPage() {
  const [q, setQ] = useState('');
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAdminUsers(q);
  const users = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="container">
      <PageHeader
        title="Пользователи"
        subtitle={data && `${total} ${plural(total, 'пользователь', 'пользователя', 'пользователей')}${q ? ' найдено' : ''}`}
      />
      <SearchInput value={q} onChange={setQ} placeholder="Имя, @username или Telegram ID" />

      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : users.length === 0 ? (
        <EmptyState
          icon={<Users size={26} strokeWidth={1.5} />}
          title={q ? 'Никого не найдено' : 'Пользователей пока нет'}
          text={q ? undefined : 'Здесь появятся все, кто запускал бота или магазин.'}
        />
      ) : (
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="list-row user-row">
              <div className="avatar" aria-hidden>
                {(u.firstName || u.username || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="list-row-text">
                <div className="list-row-title">
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || 'Без имени'}
                  {u.isBlocked && <span className="pill">Заблокировал бота</span>}
                </div>
                <div className="list-row-meta">
                  {u.username && <span>@{u.username}</span>}
                  <span>ID {u.telegramId}</span>
                </div>
                <div className="list-row-meta">
                  <span>С {formatDate(u.createdAt)}</span>
                  <span>· активность {formatDateTime(u.lastSeenAt)}</span>
                </div>
              </div>
              <div className="user-orders" title="Заказов">
                {u.ordersCount}
                <span>{plural(u.ordersCount, 'заказ', 'заказа', 'заказов')}</span>
              </div>
            </div>
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
