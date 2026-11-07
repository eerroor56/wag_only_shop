import { Check } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { formatPrice } from '@wag/shared';
import { ErrorState, errorMessage, Skeleton } from '@wag/web';
import { useOrder, useShopConfig } from '../api/queries';

export function OrderSuccessPage() {
  const { id } = useParams();
  const { data: order, isPending, isError, error, refetch } = useOrder(Number(id));
  const { data: config } = useShopConfig();

  if (isError) {
    return (
      <div className="container">
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="container success">
      <div className="success-icon" aria-hidden>
        <Check size={34} strokeWidth={2.2} />
      </div>
      <h1 className="title success-title">Заказ оформлен</h1>
      <p className="success-text">
        Спасибо за заказ!
        <br />
        Магазин свяжется с вами в ближайшее время.
      </p>

      <div className="card success-details">
        {isPending ? (
          <>
            <Skeleton style={{ height: 16, width: '60%' }} />
            <Skeleton style={{ height: 16, width: '45%', marginTop: 10 }} />
          </>
        ) : (
          <>
            <div className="success-row">
              <span className="muted">Номер заказа</span>
              <span>№{order.id}</span>
            </div>
            <div className="success-row">
              <span className="muted">Сумма заказа</span>
              <span className="success-amount">{formatPrice(order.totalAmount)}</span>
            </div>
          </>
        )}
      </div>

      <div className="manager-caption">
        Менеджер магазина
        <span>@{config?.managerUsername ?? 'wag_on'}</span>
      </div>

      <Link to="/catalog" replace className="btn btn-primary btn-lg btn-block success-action">
        Вернуться в каталог
      </Link>
    </div>
  );
}
