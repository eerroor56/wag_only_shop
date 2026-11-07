import { MessageCircle, Phone } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { formatPhone, formatPrice, ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from '@wag/shared';
import {
  ErrorState,
  errorMessage,
  formatDateTime,
  haptic,
  openTelegramLink,
  Spinner,
  useTelegramBackButton,
  useToast,
} from '@wag/web';
import { useAdminOrder, useUpdateOrderStatus } from '../api/queries';
import { PageHeader, StatusBadge } from '../components/common';

export function OrderDetailPage() {
  const { id } = useParams();
  const orderId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { data: order, isPending, isError, error, refetch } = useAdminOrder(orderId);
  const updateStatus = useUpdateOrderStatus();

  // Открыто из уведомления бота — истории нет, «назад» ведёт к списку заказов.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate('/orders', { replace: true }));
  useTelegramBackButton(goBack);

  const setStatus = (status: OrderStatus) => {
    if (!order || order.status === status) return;
    haptic.selection();
    updateStatus.mutate(
      { id: order.id, status },
      {
        onSuccess: () => toast.success(`Статус: ${ORDER_STATUS_LABELS[status]}`),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  if (isError) {
    return (
      <div className="container">
        <PageHeader title={`Заказ №${id}`} onBack={goBack} />
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="page-loader">
        <Spinner />
      </div>
    );
  }

  const username = order.telegramUsername ?? order.user.username;

  return (
    <div className="container order-detail">
      <PageHeader
        title={`Заказ №${order.id}`}
        subtitle={formatDateTime(order.createdAt)}
        onBack={goBack}
        action={<StatusBadge status={order.status} />}
      />

      <section className="detail-section">
        <div className="section-label">Статус</div>
        <div className="segmented" role="radiogroup" aria-label="Статус заказа">
          {ORDER_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={order.status === s}
              className="segment"
              disabled={updateStatus.isPending}
              onClick={() => setStatus(s)}
            >
              {ORDER_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      <section className="detail-section card detail-card">
        <div className="section-label">Клиент</div>
        <dl className="kv">
          <div>
            <dt>Имя</dt>
            <dd>{order.customerName}</dd>
          </div>
          <div>
            <dt>Телефон</dt>
            <dd>
              <a href={`tel:${order.phone}`}>{formatPhone(order.phone)}</a>
            </dd>
          </div>
          <div>
            <dt>Telegram</dt>
            <dd>{username ? `@${username}` : `ID ${order.user.telegramId}`}</dd>
          </div>
          {username && order.telegramUsername && order.user.username && order.user.username !== order.telegramUsername && (
            <div>
              <dt>Текущий username</dt>
              <dd>@{order.user.username}</dd>
            </div>
          )}
        </dl>
        <div className="contact-actions">
          {username && (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => openTelegramLink(`https://t.me/${username}`)}
            >
              <MessageCircle size={17} /> Связаться в Telegram
            </button>
          )}
          <a href={`tel:${order.phone}`} className="btn btn-outline btn-block">
            <Phone size={17} /> Позвонить
          </a>
        </div>
        {!username && (
          <p className="field-hint">
            У клиента нет username — напишите по номеру телефона или найдите его по Telegram ID {order.user.telegramId}.
          </p>
        )}
      </section>

      <section className="detail-section card detail-card">
        <div className="section-label">Товары</div>
        <ul className="order-items">
          {order.items.map((item, i) => (
            <li key={item.id}>
              <div className="order-item-title">
                {i + 1}.{' '}
                {item.productId ? (
                  <Link to={`/products/${item.productId}`}>{item.title}</Link>
                ) : (
                  <span>
                    {item.title} <span className="caption">(товар удалён)</span>
                  </span>
                )}
              </div>
              <div className="order-item-calc">
                {item.quantity} × {formatPrice(item.price)} = <b>{formatPrice(item.total)}</b>
              </div>
            </li>
          ))}
        </ul>
        <div className="order-total">
          <span>Итого</span>
          <span>{formatPrice(order.totalAmount)}</span>
        </div>
        <p className="field-hint">Цены и названия зафиксированы на момент оформления заказа.</p>
      </section>
    </div>
  );
}
