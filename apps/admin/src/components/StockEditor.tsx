import { Minus, Plus } from 'lucide-react';
import { LIMITS, NO_SIZE_STOCK_KEY, sizeKey } from '@wag/shared';
import { haptic } from '@wag/web';

/** Значения полей ввода по размерам (строки — чтобы поле можно было очистить при вводе). */
export type StockDraft = Record<string, string>;

/** Черновик остатков → число по каждому размеру. Пустое поле — 0. null — есть ошибка ввода. */
export function parseStockDraft(sizes: string[], draft: StockDraft): Record<string, number> | null {
  const keys = sizes.length ? sizes : [NO_SIZE_STOCK_KEY];
  const result: Record<string, number> = {};
  for (const key of keys) {
    const raw = (draftValue(draft, key) ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.stockMax) return null;
    result[key] = n;
  }
  return result;
}

function draftValue(draft: StockDraft, key: string): string | undefined {
  if (key in draft) return draft[key];
  return Object.entries(draft).find(([k]) => sizeKey(k) === sizeKey(key))?.[1];
}

function StockStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const n = Number(value) || 0;
  const set = (next: number) => {
    haptic.selection();
    onChange(String(Math.min(LIMITS.stockMax, Math.max(0, next))));
  };
  return (
    <div className={`stock-cell ${n === 0 ? 'is-empty' : ''}`}>
      <span className="stock-cell-label">{label || 'Количество, шт.'}</span>
      <div className="stock-stepper">
        <button type="button" aria-label={`Уменьшить остаток ${label}`} disabled={n <= 0} onClick={() => set(n - 1)}>
          <Minus size={14} strokeWidth={2.4} />
        </button>
        <input
          inputMode="numeric"
          aria-label={label ? `Остаток размера ${label}` : 'Остаток'}
          value={value}
          placeholder="0"
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
        />
        <button type="button" aria-label={`Увеличить остаток ${label}`} onClick={() => set(n + 1)}>
          <Plus size={14} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}

/** Остатки товара: выключено — товар всегда в наличии; включено — количество по каждому размеру. */
export function StockEditor({
  sizes,
  enabled,
  draft,
  onToggle,
  onChange,
  error,
}: {
  sizes: string[];
  enabled: boolean;
  draft: StockDraft;
  onToggle: (enabled: boolean) => void;
  onChange: (draft: StockDraft) => void;
  error?: string;
}) {
  const keys = sizes.length ? sizes : [NO_SIZE_STOCK_KEY];
  const parsed = parseStockDraft(sizes, draft);
  const total = parsed ? Object.values(parsed).reduce((a, b) => a + b, 0) : null;
  const soldOutSizes = parsed && sizes.length ? sizes.filter((s) => parsed[s] === 0) : [];

  return (
    <section className="card editor-card">
      <label className="switch-row switch-row-plain">
        <span>
          <span className="switch-title">Учитывать остатки</span>
          <span className="caption">
            {enabled
              ? 'Нельзя заказать больше, чем есть. Остаток уменьшается с каждым заказом и возвращается при отмене'
              : 'Товар всегда в наличии, количество не ограничено'}
          </span>
        </span>
        <input type="checkbox" className="switch" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
      </label>

      {enabled && (
        <>
          <div className={sizes.length ? 'stock-grid' : 'stock-single'}>
            {keys.map((key) => (
              <StockStepper
                key={key || 'single'}
                label={key}
                value={draftValue(draft, key) ?? ''}
                onChange={(v) => onChange({ ...draft, [key]: v })}
              />
            ))}
          </div>
          <div className="stock-summary">
            {total === null ? (
              <span className="field-error">Остаток — целое число от 0 до {LIMITS.stockMax}</span>
            ) : total === 0 ? (
              <span className="pill pill-strong">Нет в наличии</span>
            ) : (
              <span className="caption">
                Всего в наличии: <b>{total} шт.</b>
                {soldOutSizes.length > 0 && ` · закончились: ${soldOutSizes.join(', ')}`}
              </span>
            )}
          </div>
          {error && <span className="field-error">{error}</span>}
        </>
      )}
    </section>
  );
}
