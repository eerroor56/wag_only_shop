import { Minus, Plus } from 'lucide-react';
import { LIMITS } from '@wag/shared';
import { haptic } from '@wag/web';

export function QuantityStepper({
  value,
  onChange,
  disabled = false,
  size = 'md',
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
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
        disabled={disabled || value >= LIMITS.cartItemMaxQuantity}
        onClick={() => change(value + 1)}
      >
        <Plus size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
