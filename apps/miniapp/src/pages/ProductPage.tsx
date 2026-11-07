import { ArrowLeft, PackageX } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  EmptyState,
  ErrorState,
  errorMessage,
  haptic,
  PriceView,
  Skeleton,
  Spinner,
  useTelegramBackButton,
  useToast,
  ApiError,
} from '@wag/web';
import { useAddToCart, useCart, useProduct, useUpdateCartItem } from '../api/queries';
import { Gallery } from '../components/Gallery';
import { QuantityStepper } from '../components/QuantityStepper';

export function ProductPage() {
  const { id } = useParams();
  const productId = Number(id);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  /** Карточка открыта из корзины → кнопка «Вернуться в корзину» ведёт именно в корзину. */
  const fromCart = params.get('from') === 'cart';
  const hasHistory = location.key !== 'default';

  const goBack = useCallback(() => {
    // Из корзины карточка открывается обычным переходом, поэтому шаг назад возвращает в корзину
    // с сохранённой прокруткой. Если истории нет (перезагрузка страницы) — переходим в корзину явно.
    if (fromCart) {
      if (hasHistory) navigate(-1);
      else navigate('/cart', { replace: true });
    } else if (hasHistory) navigate(-1);
    else navigate('/catalog', { replace: true });
  }, [fromCart, hasHistory, navigate]);

  useTelegramBackButton(goBack);

  const { data: product, isPending, isError, error, refetch } = useProduct(productId);
  const { data: cart } = useCart();
  const addToCart = useAddToCart();
  const updateItem = useUpdateCartItem();

  const cartItem = cart?.items.find((i) => i.productId === productId && i.available);

  const onAdd = () => {
    addToCart.mutate(
      { productId },
      {
        onSuccess: () => {
          haptic.impact('light');
          toast.success('Добавлено в корзину');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const backButton = (
    <button type="button" className="floating-back" onClick={goBack}>
      <ArrowLeft size={18} strokeWidth={2} />
      <span>{fromCart ? 'Вернуться в корзину' : 'Назад'}</span>
    </button>
  );

  if (isPending) {
    return (
      <div className="product-page">
        {backButton}
        <Skeleton className="gallery-skeleton" style={{ borderRadius: 0 }} />
        <div className="container product-info">
          <Skeleton style={{ height: 22, width: '70%' }} />
          <Skeleton style={{ height: 26, width: '40%', marginTop: 12 }} />
          <Skeleton style={{ height: 14, width: '100%', marginTop: 24 }} />
          <Skeleton style={{ height: 14, width: '90%', marginTop: 8 }} />
        </div>
      </div>
    );
  }

  if (isError) {
    const gone = error instanceof ApiError && error.status === 404;
    return (
      <div className="product-page product-page-plain">
        {backButton}
        {gone ? (
          <EmptyState
            icon={<PackageX size={28} strokeWidth={1.5} />}
            title="Товар недоступен"
            text="Возможно, он снят с продажи."
            action={
              <Link to="/catalog" className="btn btn-primary">
                Перейти в каталог
              </Link>
            }
          />
        ) : (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  return (
    <div className="product-page">
      {backButton}
      <Gallery images={product.images} title={product.title} />

      <div className="container product-info">
        <h1 className="product-title">{product.title}</h1>
        <PriceView
          price={product.price}
          oldPrice={product.oldPrice}
          discountPercent={product.discountPercent}
          size="lg"
        />

        {product.description && <p className="product-description">{product.description}</p>}

        {product.attributes.length > 0 && (
          <dl className="attributes">
            {product.attributes.map((a, i) => (
              <div className="attribute-row" key={`${a.name}-${i}`}>
                <dt>{a.name}</dt>
                <dd>{a.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <p className="product-note">
          Заказ оформляется через магазин — оплату и получение согласует менеджер в Telegram.
        </p>
      </div>

      <div className="buy-bar">
        {cartItem ? (
          <>
            <QuantityStepper
              value={cartItem.quantity}
              onChange={(quantity) =>
                updateItem.mutate(
                  { itemId: cartItem.id, quantity },
                  { onError: (err) => toast.error(errorMessage(err)) },
                )
              }
            />
            <Link to="/cart" className="btn btn-primary btn-lg buy-bar-main">
              В корзину
            </Link>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={onAdd}
            disabled={addToCart.isPending}
          >
            {addToCart.isPending ? <Spinner size={18} /> : 'Добавить в корзину'}
          </button>
        )}
      </div>
    </div>
  );
}
