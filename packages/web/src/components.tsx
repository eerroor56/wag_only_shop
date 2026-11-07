import { useEffect, useRef, type ReactNode } from 'react';
import { formatPrice } from '@wag/shared';
import { tg, isTelegram } from './telegram.js';

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Загрузка" />;
}

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {text && <div className="empty-state-text">{text}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      title="Не удалось загрузить"
      text={message}
      action={
        onRetry && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Повторить
          </button>
        )
      }
    />
  );
}

/** Цена: финальная, зачёркнутая старая и процент скидки. */
export function PriceView({
  price,
  oldPrice,
  discountPercent,
  size = 'md',
}: {
  price: number;
  oldPrice: number | null;
  discountPercent: number | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <div className={`price price-${size}`}>
      <span className="price-current">{formatPrice(price)}</span>
      {oldPrice != null && <s className="price-old">{formatPrice(oldPrice)}</s>}
      {discountPercent != null && <span className="badge-discount">−{discountPercent}%</span>}
    </div>
  );
}

/**
 * Кнопка «Назад» Telegram. handler = null — кнопка скрыта.
 * Вне Telegram ничего не делает (в интерфейсе есть собственная кнопка).
 */
export function useTelegramBackButton(handler: (() => void) | null) {
  const ref = useRef(handler);
  ref.current = handler;
  const enabled = handler !== null;
  useEffect(() => {
    if (!isTelegram || !tg || !enabled) return;
    const cb = () => ref.current?.();
    tg.BackButton.onClick(cb);
    tg.BackButton.show();
    return () => {
      tg!.BackButton.offClick(cb);
      tg!.BackButton.hide();
    };
  }, [enabled]);
}
