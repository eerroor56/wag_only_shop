import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { LIMITS, SIZE_PRESETS, sizeKey, sizeLabelSchema, sortSizes } from '@wag/shared';
import { haptic } from '@wag/web';

/**
 * Редактор размеров товара: быстрый выбор стандартных (XS–3XL, 42–58)
 * и произвольные значения — диапазоны 48-52, 52/54, M/L, One size.
 * Размеры автоматически упорядочиваются: XS → 3XL, затем числовые по возрастанию.
 */
export function SizesEditor({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (sizes: string[]) => void;
  error?: string;
}) {
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState('');
  const selected = new Set(value.map(sizeKey));

  const toggle = (label: string) => {
    haptic.selection();
    if (selected.has(sizeKey(label))) onChange(value.filter((s) => sizeKey(s) !== sizeKey(label)));
    else if (value.length < LIMITS.productSizesMax) onChange(sortSizes([...value, label]));
  };

  const addCustom = () => {
    const parsed = sizeLabelSchema.safeParse(custom);
    if (!parsed.success) {
      setCustomError(parsed.error.issues[0]?.message ?? 'Некорректный размер');
      return;
    }
    if (selected.has(sizeKey(parsed.data))) {
      setCustomError('Такой размер уже добавлен');
      return;
    }
    if (value.length >= LIMITS.productSizesMax) {
      setCustomError(`Не более ${LIMITS.productSizesMax} размеров`);
      return;
    }
    onChange(sortSizes([...value, parsed.data]));
    setCustom('');
    setCustomError('');
    haptic.selection();
  };

  return (
    <section className="field sizes-editor">
      <span className="field-label">Размеры</span>

      {value.length > 0 ? (
        <div className="size-chips">
          {value.map((s) => (
            <span key={s} className="size-chip">
              {s}
              <button type="button" aria-label={`Убрать размер ${s}`} onClick={() => toggle(s)}>
                <X size={13} strokeWidth={2.4} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <span className="field-hint">Размеры не выбраны — товар продаётся без выбора размера.</span>
      )}

      <div className="size-presets">
        <span className="caption">Буквенные</span>
        <div className="chips-wrap">
          {SIZE_PRESETS.letters.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={selected.has(sizeKey(s))} onClick={() => toggle(s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="caption">Российские</span>
        <div className="chips-wrap">
          {SIZE_PRESETS.numbers.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={selected.has(sizeKey(s))} onClick={() => toggle(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="size-custom">
        <input
          className="input"
          placeholder="Свой: 48-52, 52/54, M/L"
          maxLength={20}
          value={custom}
          aria-invalid={Boolean(customError)}
          onChange={(e) => {
            setCustom(e.target.value);
            setCustomError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={addCustom} disabled={!custom.trim()}>
          <Plus size={16} /> Добавить
        </button>
      </div>
      {(customError || error) && <span className="field-error">{customError || error}</span>}
      <span className="field-hint">Покупатель выбирает размер в карточке товара; он указывается в заказе.</span>
    </section>
  );
}
