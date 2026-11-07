import { ArrowLeft, Phone } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { checkoutSchema, formatPrice } from '@wag/shared';
import {
  ApiError,
  canRequestContact,
  errorMessage,
  haptic,
  plural,
  requestPhone,
  Spinner,
  telegramUser,
  useTelegramBackButton,
  useToast,
  uuid,
} from '@wag/web';
import { keys, queryClient, useCart, useCreateOrder, useShopConfig } from '../api/queries';

type Errors = Partial<Record<'customerName' | 'phone', string>>;

function validate(customerName: string, phone: string): Errors {
  const result = checkoutSchema.pick({ customerName: true, phone: true }).safeParse({ customerName, phone });
  if (result.success) return {};
  const errors: Errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof Errors;
    errors[field] ??= issue.message;
  }
  return errors;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: cart, isPending } = useCart();
  const { data: config } = useShopConfig();
  const createOrder = useCreateOrder();

  const tgUser = telegramUser();
  const [customerName, setCustomerName] = useState(() =>
    [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ').slice(0, 100),
  );
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Один ключ на попытку оформления: повторное нажатие не создаст второй заказ.
  const [idempotencyKey] = useState(uuid);

  const goBack = useCallback(() => navigate('/cart'), [navigate]);
  useTelegramBackButton(goBack);

  const revalidate = (name: string, tel: string, field?: keyof Errors) => {
    const next = validate(name, tel);
    if (field) setErrors((prev) => ({ ...prev, [field]: touched[field] ? next[field] : prev[field] }));
    else setErrors(next);
  };

  const onSharePhone = async () => {
    const shared = await requestPhone();
    if (shared) {
      setPhone(shared);
      setErrors((e) => ({ ...e, phone: undefined }));
      haptic.notify('success');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (createOrder.isPending || !cart) return;
    setTouched({ customerName: true, phone: true });
    const found = validate(customerName, phone);
    setErrors(found);
    if (Object.keys(found).length) {
      haptic.notify('error');
      return;
    }

    createOrder.mutate(
      { customerName: customerName.trim(), phone: phone.trim(), expectedTotal: cart.totalAmount, idempotencyKey },
      {
        onSuccess: (order) => {
          haptic.notify('success');
          navigate(`/order/${order.id}`, { replace: true });
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.code === 'VALIDATION_ERROR') {
              setErrors(err.fieldErrors());
              haptic.notify('error');
              return;
            }
            if (['PRICE_CHANGED', 'CART_HAS_UNAVAILABLE', 'CART_EMPTY'].includes(err.code)) {
              void queryClient.invalidateQueries({ queryKey: keys.cart });
              toast.error(err.message);
              navigate('/cart', { replace: true });
              return;
            }
          }
          toast.error(errorMessage(err));
        },
      },
    );
  };

  if (!isPending && (!cart || cart.totalQuantity === 0 || cart.hasUnavailable) && !createOrder.isSuccess) {
    return <Navigate to="/cart" replace />;
  }

  return (
    <div className="container checkout">
      <header className="page-header page-header-back">
        <button type="button" className="icon-btn" aria-label="Вернуться в корзину" onClick={goBack}>
          <ArrowLeft size={18} strokeWidth={2} />
        </button>
        <h1 className="title">Оформление заказа</h1>
      </header>

      {cart && (
        <div className="card order-summary">
          <div className="order-summary-row">
            <span className="muted">
              {cart.totalQuantity} {plural(cart.totalQuantity, 'товар', 'товара', 'товаров')}
            </span>
            <span className="order-summary-total">{formatPrice(cart.totalAmount)}</span>
          </div>
        </div>
      )}

      <form className="checkout-form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field-label">Имя</span>
          <input
            className="input"
            name="name"
            autoComplete="name"
            placeholder="Введите ваше имя"
            maxLength={100}
            value={customerName}
            aria-invalid={Boolean(errors.customerName)}
            onChange={(e) => {
              setCustomerName(e.target.value);
              revalidate(e.target.value, phone, 'customerName');
            }}
            onBlur={() => {
              setTouched((t) => ({ ...t, customerName: true }));
              setErrors((prev) => ({ ...prev, customerName: validate(customerName, phone).customerName }));
            }}
          />
          {errors.customerName && <span className="field-error">{errors.customerName}</span>}
        </label>

        <label className="field">
          <span className="field-label">Номер телефона</span>
          <input
            className="input"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Введите номер телефона"
            maxLength={32}
            value={phone}
            aria-invalid={Boolean(errors.phone)}
            onChange={(e) => {
              setPhone(e.target.value);
              revalidate(customerName, e.target.value, 'phone');
            }}
            onBlur={() => {
              setTouched((t) => ({ ...t, phone: true }));
              setErrors((prev) => ({ ...prev, phone: validate(customerName, phone).phone }));
            }}
          />
          {errors.phone ? (
            <span className="field-error">{errors.phone}</span>
          ) : (
            <span className="field-hint">Например, +7 999 123 45 67</span>
          )}
        </label>

        {canRequestContact() && (
          <button type="button" className="btn btn-outline btn-block" onClick={onSharePhone}>
            <Phone size={17} strokeWidth={1.8} />
            Взять номер из Telegram
          </button>
        )}

        <p className="checkout-note">
          Оплата в приложении не производится. После оформления менеджер магазина
          {config ? ` @${config.managerUsername}` : ''} свяжется с вами в Telegram, чтобы подтвердить заказ, оплату и
          получение.
        </p>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={createOrder.isPending || !cart}>
          {createOrder.isPending ? <Spinner size={18} /> : 'Оформить заказ'}
        </button>
      </form>
    </div>
  );
}
