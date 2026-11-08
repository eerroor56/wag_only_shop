import { Check } from 'lucide-react';
import { colorByKey } from '@wag/shared';

/** Образец цвета из палитры (COLOR_PALETTE). selected — с галочкой поверх. */
export function ColorSwatch({ colorKey, size = 28, selected = false }: { colorKey: string; size?: number; selected?: boolean }) {
  const color = colorByKey(colorKey);
  if (!color) return null;
  return (
    <span
      className={`swatch ${color.light ? 'is-light' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ width: size, height: size, background: color.swatch }}
      aria-hidden
    >
      {selected && <Check size={Math.round(size * 0.5)} strokeWidth={3} />}
    </span>
  );
}

/** Несколько цветов кружками внахлёст — компактное превью выбранной палитры. */
export function ColorDots({ keys, size = 18 }: { keys: readonly string[]; size?: number }) {
  return (
    <span className="swatch-dots" aria-hidden>
      {keys.slice(0, 4).map((k) => (
        <ColorSwatch key={k} colorKey={k} size={size} />
      ))}
    </span>
  );
}
