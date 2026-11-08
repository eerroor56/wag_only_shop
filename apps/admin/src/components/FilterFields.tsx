import { Check, Palette, Sparkles, Layers, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  brandKey,
  COLOR_PALETTE,
  detectColors,
  detectMaterials,
  GENDER_LABELS,
  GENDERS,
  LIMITS,
  MATERIAL_PALETTE,
  PALETTE_PICK_MAX,
  SEASON_LABELS,
  SEASONS,
  type ColorKey,
  type Gender,
  type MaterialKey,
  type Season,
} from '@wag/shared';
import { BottomSheet, ColorDots, ColorSwatch, haptic, plural } from '@wag/web';
import { useAdminProducts } from '../api/queries';

// ------------------------------------------------------------------ бренд

/** Бренд с подсказками из уже заведённых товаров — чтобы «Nike» не превращался в «Найк» и «NIKE». */
export function BrandField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const { data } = useAdminProducts();
  const [focused, setFocused] = useState(false);

  const brands = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const p of data?.items ?? []) {
      if (!p.brand) continue;
      const key = brandKey(p.brand);
      const found = map.get(key);
      if (found) found.count++;
      else map.set(key, { name: p.brand, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'));
  }, [data]);

  const key = brandKey(value);
  const exact = brands.some((b) => b.name === value.trim());
  const suggestions = (key ? brands.filter((b) => brandKey(b.name).includes(key)) : brands).slice(0, 8);

  return (
    <div className="field">
      <label className="field-label" htmlFor="product-brand">
        Бренд
      </label>
      <input
        id="product-brand"
        className="input"
        placeholder="Например, Nike"
        maxLength={LIMITS.brandMax}
        value={value}
        aria-invalid={Boolean(error)}
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <span className="field-error">{error}</span>}
      {(focused || !value) && !exact && suggestions.length > 0 && (
        <span className="brand-suggestions" role="listbox" aria-label="Бренды из каталога">
          {suggestions.map((b) => (
            <button
              key={b.name}
              type="button"
              className="chip"
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                haptic.selection();
                onChange(b.name);
              }}
            >
              {b.name}
              <span className="chip-count">{b.count}</span>
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ пол и сезон

export function GenderField({ value, onChange }: { value: Gender | null; onChange: (v: Gender | null) => void }) {
  const options: [Gender | null, string][] = [[null, 'Не указан'], ...GENDERS.map((g): [Gender, string] => [g, GENDER_LABELS[g]])];
  return (
    <div className="field">
      <span className="field-label">Пол</span>
      <div className="segmented segmented-4" role="radiogroup" aria-label="Пол">
        {options.map(([g, label]) => (
          <button
            key={g ?? 'none'}
            type="button"
            role="radio"
            aria-checked={value === g}
            className="segment"
            onClick={() => {
              haptic.selection();
              onChange(g);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="field-hint">Унисекс-вещи покупатель увидит и в мужском, и в женском фильтре.</span>
    </div>
  );
}

export function SeasonField({ value, onChange }: { value: Season[]; onChange: (v: Season[]) => void }) {
  const toggle = (s: Season) => {
    haptic.selection();
    if (value.includes(s)) onChange(value.filter((x) => x !== s));
    // «Всесезон» исключает конкретные сезоны и наоборот.
    else if (s === 'all') onChange(['all']);
    else onChange(SEASONS.filter((x) => x !== 'all' && (x === s || value.includes(x))));
  };
  return (
    <div className="field">
      <span className="field-label">Сезон</span>
      <div className="chips-wrap" role="group" aria-label="Сезон">
        {SEASONS.map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={value.includes(s)} onClick={() => toggle(s)}>
            {SEASON_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ цвет и материал

type PaletteKind = 'color' | 'material';

const PALETTE = {
  color: {
    label: 'Цвет',
    placeholder: 'Например, графитовый меланж',
    max: LIMITS.colorNameMax,
    sheetTitle: 'Цвет для фильтра',
    sheetHint: 'Покупатель найдёт товар, отметив эти цвета в фильтре каталога.',
    options: COLOR_PALETTE.map((c) => ({ key: c.key as string, label: c.label })),
    detect: detectColors as (text: string) => string[],
  },
  material: {
    label: 'Материал',
    placeholder: 'Например, 80% хлопок, 20% полиэстер',
    max: LIMITS.materialNameMax,
    sheetTitle: 'Материал для фильтра',
    sheetHint: 'Отметьте основные материалы — по ним покупатель фильтрует каталог.',
    options: MATERIAL_PALETTE.map((m) => ({ key: m.key as string, label: m.label })),
    detect: detectMaterials as (text: string) => string[],
  },
} as const;

/**
 * Текст для покупателя + значения палитры для фильтра. Кнопка справа открывает палитру популярных
 * цветов / материалов; если палитра пуста, она подбирается по введённому тексту.
 */
export function PaletteField<K extends ColorKey | MaterialKey>({
  kind,
  text,
  onText,
  keys,
  onKeys,
  error,
}: {
  kind: PaletteKind;
  text: string;
  onText: (v: string) => void;
  keys: K[];
  onKeys: (v: K[]) => void;
  error?: string;
}) {
  const cfg = PALETTE[kind];
  const [open, setOpen] = useState(false);
  const labelOf = (k: string) => cfg.options.find((o) => o.key === k)?.label ?? k;
  const detected = keys.length === 0 && text.trim() ? (cfg.detect(text) as K[]) : [];

  return (
    <div className="field">
      <span className="field-label">{cfg.label}</span>
      <div className="palette-input">
        <input
          className="input"
          placeholder={cfg.placeholder}
          maxLength={cfg.max}
          value={text}
          aria-invalid={Boolean(error)}
          onChange={(e) => onText(e.target.value)}
          // Палитра пуста — подставляем найденное в тексте, дальше её можно поправить.
          onBlur={() => {
            if (detected.length) onKeys(detected);
          }}
        />
        <button
          type="button"
          className={`palette-trigger ${keys.length ? 'has-value' : ''}`}
          aria-label={`${cfg.sheetTitle}: ${keys.length ? keys.map(labelOf).join(', ') : 'не выбран'}`}
          onClick={() => {
            haptic.impact('light');
            setOpen(true);
          }}
        >
          {keys.length && kind === 'color' ? (
            <ColorDots keys={keys} size={16} />
          ) : kind === 'color' ? (
            <Palette size={19} strokeWidth={1.8} />
          ) : (
            <Layers size={19} strokeWidth={1.8} />
          )}
          {keys.length > 0 && kind === 'material' && <span className="palette-trigger-count">{keys.length}</span>}
        </button>
      </div>

      {keys.length > 0 ? (
        <span className="palette-picked">
          <span className="caption">В фильтре:</span>
          {keys.map((k) => (
            <span key={k} className="palette-tag">
              {kind === 'color' && <ColorSwatch colorKey={k} size={14} />}
              {labelOf(k)}
              <button
                type="button"
                aria-label={`Убрать «${labelOf(k)}» из фильтра`}
                onClick={() => onKeys(keys.filter((x) => x !== k))}
              >
                <X size={12} strokeWidth={2.6} />
              </button>
            </span>
          ))}
        </span>
      ) : detected.length > 0 ? (
        <button type="button" className="palette-suggest" onClick={() => onKeys(detected)}>
          <Sparkles size={14} strokeWidth={2} />
          Добавить в фильтр: {detected.map(labelOf).join(', ')}
        </button>
      ) : (
        <span className="field-hint">
          Нажмите {kind === 'color' ? <Palette size={13} className="inline-icon" /> : <Layers size={13} className="inline-icon" />},
          чтобы выбрать {kind === 'color' ? 'цвета' : 'материалы'} для фильтра покупателя.
        </span>
      )}
      {error && <span className="field-error">{error}</span>}

      <PaletteSheet
        open={open}
        onClose={() => setOpen(false)}
        kind={kind}
        value={keys}
        onChange={(v) => onKeys(v as K[])}
      />
    </div>
  );
}

function PaletteSheet({
  open,
  onClose,
  kind,
  value,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  kind: PaletteKind;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const cfg = PALETTE[kind];
  const full = value.length >= PALETTE_PICK_MAX;

  const toggle = (key: string) => {
    if (value.includes(key)) {
      haptic.selection();
      onChange(value.filter((k) => k !== key));
    } else if (!full) {
      haptic.selection();
      onChange([...value, key]);
    } else {
      haptic.notify('error');
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={cfg.sheetTitle}
      footer={
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
          {value.length ? `Готово · ${value.length} ${plural(value.length, 'выбран', 'выбрано', 'выбрано')}` : 'Готово'}
        </button>
      }
    >
      <p className="palette-hint">
        {cfg.sheetHint} Можно отметить до {PALETTE_PICK_MAX}.
      </p>
      {kind === 'color' ? (
        <div className="palette-grid" role="group" aria-label={cfg.sheetTitle}>
          {COLOR_PALETTE.map((c) => {
            const on = value.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                className="palette-color"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle(c.key)}
              >
                <ColorSwatch colorKey={c.key} size={40} selected={on} />
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="palette-materials" role="group" aria-label={cfg.sheetTitle}>
          {MATERIAL_PALETTE.map((m) => {
            const on = value.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                className="palette-material"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle(m.key)}
              >
                <span className="palette-material-check" aria-hidden>
                  <Check size={13} strokeWidth={3} />
                </span>
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </BottomSheet>
  );
}
