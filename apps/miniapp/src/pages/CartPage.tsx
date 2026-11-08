import { ShoppingBag, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { formatPrice } from '@wag/shared';
import type { CartItemDTO } from '@wag/shared';
import {
  confirmDialog,
  EmptyState,
  ErrorState,
  errorMessage,
  haptic,
  plural,
  Skeleton,
  useToast,
} from '@wag/web';
import { useCart, useRemoveCartItem, useUpdateCartItem } from '../api/queries';
import { ProductImage } from '../components/ProductImage';
import { QuantityStepper } from '../components/QuantityStepper';

function CartRow({ item }: { item: CartItemDTO }) {
  const toast = useToast();
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();
  const productLink = `/product/${item.productId}?from=cart`;
  // Скрытый товар открыть нельзя; при проблеме с размером карточка доступна — можно выбрать другой.
  const linkable = item.unavailableReason !== 'hidden';
  const label = item.size ? `«${item.product.title}», размер ${item.size}` : `«${item.product.title}»`;

  const onRemove = async () => {
    if (!(await confirmDialog(`Удалить ${label} из корзины?`))) return;
    haptic.impact('medium');
    remove.mutate(item.id, { onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <li className={`cart-row ${item.available ? '' : 'is-unavailable'}`}>
      {linkable ? (
        <Link to={productLink} className="cart-row-media">
          <ProductImage src={item.product.image?.thumbUrl} alt={item.product.title} />
        </Link>
      ) : (
        <div className="cart-row-media">
          <ProductImage src={item.product.image?.thumbUrl} alt={item.product.title} />
        </div>
      )}
      <div className="cart-row-body">
        <div className="cart-row-top">
          {linkable ? (
            <Link to={productLink} className="cart-row-title line-clamp-2">
              {item.product.title}
            </Link>
          ) : (
            <span className="cart-row-title line-clamp-2">{item.product.title}</span>
          )}
          <button type="button" className="icon-btn icon-btn-plain" aria-label="Удалить из корзины" onClick={onRemove}>
            <Trash2 size={18} strokeWidth={1.7} />
          </button>
        </div>
        {item.size && <div className="cart-row-size">Размер: {item.size}</div>}

        {item.available ? (
          <>
            <div className="cart-row-price">
              {formatPrice(item.product.price)}
              {item.product.oldPrice != null && <s className="price-old">{formatPrice(item.product.oldPrice)}</s>}
            </div>
            <div className="cart-row-bottom">
              <QuantityStepper
                size="sm"
                value={item.quantity}
                max={item.maxQuantity}
                onChange={(quantity) =>
                  update.mutate({ itemId: item.id, quantity }, { onError: (err) => toast.error(errorMessage(err)) })
                }
              />
              <span className="cart-row-total">{formatPrice(item.lineTotal)}</span>
            </div>
          </>
        ) : (
          <div className="cart-row-unavailable">
            {item.unavailableReason === 'stock' && item.maxQuantity != null ? (
              <>
                <span>
                  В наличии только {item.maxQuantity} шт. — в корзине {item.quantity}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate(
                      { itemId: item.id, quantity: item.maxQuantity! },
                      { onError: (err) => toast.error(errorMessage(err)) },
                    )
                  }
                >
                  Оставить {item.maxQuantity} шт.
                </button>
              </>
            ) : item.unavailableReason === 'soldout' ? (
              'Товар закончился — удалите его, чтобы оформить заказ'
            ) : item.unavailableReason === 'size' ? (
              'Этого размера больше нет — удалите позицию и выберите другой размер'
            ) : (
              'Товар больше недоступен — удалите его, чтобы оформить заказ'
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function CartPage() {
  const navigate = useNavigate();
  const { data: cart, isPending, isError, error, refetch } = useCart();

  if (isPending) {
    return (
      <div className="container">
        <header className="page-header">
          <h1 className="title">Корзина</h1>
        </header>
        {Array.from({ length: 3 }, (_, i) => (
          <div className="cart-row" key={i}>
            <Skeleton className="cart-row-media" />
            <div className="cart-row-body">
              <Skeleton style={{ height: 14, width: '80%' }} />
              <Skeleton style={{ height: 14, width: '35%', marginTop: 10 }} />
              <Skeleton style={{ height: 32, width: 110, marginTop: 14, borderRadius: 10 }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container">
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="container">
        <header className="page-header">
          <h1 className="title">Корзина</h1>
        </header>
        <EmptyState
          icon={<ShoppingBag size={28} strokeWidth={1.5} />}
          title="Корзина пуста"
          text="Добавьте вещи из каталога, чтобы оформить заказ."
          action={
            <Link to="/catalog" className="btn btn-primary">
              Перейти в каталог
            </Link>
          }
        />
      </div>
    );
  }

  const canCheckout = cart.totalQuantity > 0 && !cart.hasUnavailable;

  return (
    <div className="container cart-page">
      <header className="page-header">
        <h1 className="title">Корзина</h1>
        <span className="caption">
          {cart.totalQuantity} {plural(cart.totalQuantity, 'товар', 'товара', 'товаров')}
        </span>
      </header>

      <ul className="cart-list">
        {cart.items.map((item) => (
          <CartRow key={item.id} item={item} />
        ))}
      </ul>

      <div className="checkout-bar">
        <div className="checkout-total">
          <span>Итого:</span>
          <span className="checkout-total-value">{formatPrice(cart.totalAmount)}</span>
        </div>
        {cart.hasUnavailable && <div className="field-error">Исправьте недоступные позиции, чтобы продолжить</div>}
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={!canCheckout}
          onClick={() => navigate('/checkout')}
        >
          Оформить заказ
        </button>
      </div>
    </div>
  );
}
