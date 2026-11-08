import { useEffect, useState, type CSSProperties } from 'react';
import { haptic } from '@wag/web';

const nf = new Intl.NumberFormat('ru-RU');

/** Шаг ползунка: ~100–200 делений на всю шкалу, круглыми суммами. */
function priceStep(max: number): number {
  if (max <= 2_000) return 10;
  if (max <= 10_000) return 50;
  if (max <= 50_000) return 100;
  if (max <= 200_000) return 500;
  return 1_000;
}

export type PriceValue = [min: number | null, max: number | null];

/**
 * Диапазон цены в рублях: двойной ползунок и поля «от» / «до».
 * Нижняя граница шкалы — 0, верхняя — цена самого дорогого товара. null — без ограничения.
 */
export function PriceRange({ max, value, onChange }: { max: number; value: PriceValue; onChange: (v: PriceValue) => void }) {
  const step = priceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const lo = Math.min(value[0] ?? 0, top);
  const hi = Math.min(value[1] ?? top, top);

  const emit = (nextLo: number, nextHi: number) => {
    const a = Math.max(0, Math.min(nextLo, nextHi));
    const b = Math.max(nextLo, nextHi);
    onChange([a > 0 ? a : null, b < top ? b : null]);
  };

  const style = { '--lo': lo / top, '--hi': hi / top } as CSSProperties;

  return (
    <div className="price-range">
      <div className="price-inputs">
        <PriceInput label="от" value={lo} placeholder="0" onCommit={(v) => emit(v ?? 0, hi)} />
        <span className="price-inputs-dash" aria-hidden>
          —
        </span>
        <PriceInput label="до" value={hi} placeholder={nf.format(top)} onCommit={(v) => emit(lo, v ?? top)} />
      </div>
      <div className="price-slider" style={style}>
        <span className="price-slider-track" aria-hidden>
          <span className="price-slider-fill" />
        </span>
        <input
          type="range"
          aria-label="Цена от"
          min={0}
          max={top}
          step={step}
          value={lo}
          // Оба ползунка у правого края — нижний должен оставаться доступным.
          style={{ zIndex: lo >= hi && lo > top / 2 ? 3 : 2 }}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), hi);
            if (v !== lo) haptic.selection();
            onChange([v > 0 ? v : null, value[1]]);
          }}
        />
        <input
          type="range"
          aria-label="Цена до"
          min={0}
          max={top}
          step={step}
          value={hi}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), lo);
            if (v !== hi) haptic.selection();
            onChange([value[0], v < top ? v : null]);
          }}
        />
      </div>
      <div className="price-scale" aria-hidden>
        <span>0 ₽</span>
        <span>{nf.format(top)} ₽</span>
      </div>
    </div>
  );
}

function PriceInput({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number;
  placeholder: string;
  onCommit: (v: number | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!focused) setDraft(nf.format(value));
  }, [value, focused]);

  const commit = () => {
    const digits = draft.replace(/\D/g, '');
    onCommit(digits ? Number(digits) : null);
  };

  return (
    <label className="price-input">
      <span>{label}</span>
      <input
        inputMode="numeric"
        enterKeyHint="done"
        placeholder={placeholder}
        value={draft}
        aria-label={`Цена ${label}`}
        onFocus={(e) => {
          setFocused(true);
          setDraft(String(value));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d\s]/g, '').slice(0, 12))}
        onBlur={() => {
          commit();
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="price-input-currency">₽</span>
    </label>
  );
}
