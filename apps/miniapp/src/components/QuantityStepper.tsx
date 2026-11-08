import { Minus, Plus } from 'lucide-react';
import { LIMITS } from '@wag/shared';
import { haptic } from '@wag/web';

export function QuantityStepper({
  value,
  onChange,
  disabled = false,
  size = 'md',
  max = null,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Остаток на складе; null — без ограничений (кроме лимита корзины). */
  max?: number | null;
}) {
  const limit = Math.min(LIMITS.cartItemMaxQuantity, max ?? LIMITS.cartItemMaxQuantity);
  const change = (next: number) => {
    haptic.selection();
    onChange(next);
  };
  return (
    <div className={`stepper stepper-${size}`}>
      <button
        type="button"
        className="stepper-btn"
        aria-label="Уменьшить количество"
        disabled={disabled || value <= 1}
        onClick={() => change(value - 1)}
      >
        <Minus size={16} strokeWidth={2} />
      </button>
      <span className="stepper-value" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className="stepper-btn"
        aria-label="Увеличить количество"
        disabled={disabled || value >= limit}
        onClick={() => change(value + 1)}
      >
        <Plus size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
