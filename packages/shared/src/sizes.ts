/**
 * Размеры одежды. Хранятся как упорядоченный список строк у товара:
 * буквенные (M, XL), российские (48), диапазоны (48-52, 52/54, M/L) или «One size».
 */

export const SIZE_PRESETS = {
  letters: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  numbers: ['42', '44', '46', '48', '50', '52', '54', '56', '58'],
} as const;

export const SIZE_LABEL_MAX = 20;
export const SIZE_LABEL_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ./\-–]*$/u;

const LETTER_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];

/** "  m " → "M", "48 - 52" → "48-52", "one size" → "One size". */
export function normalizeSizeLabel(input: string): string {
  let s = input.trim().replace(/\s+/g, ' ').replace(/\s*([-–/])\s*/g, '$1').replace('–', '-');
  if (/^[a-z0-9/-]+$/i.test(s) && /[a-z]/i.test(s) && s.length <= 9) s = s.toUpperCase();
  if (/^one size$/i.test(s)) s = 'One size';
  return s;
}

/** Ключ для сравнения размеров без учёта регистра. */
export const sizeKey = (label: string) => normalizeSizeLabel(label).toLowerCase();

function rank(label: string): [number, number] {
  const upper = label.toUpperCase();
  const first = upper.split(/[-/]/)[0] ?? upper;
  const letterIndex = LETTER_ORDER.indexOf(first);
  if (letterIndex >= 0) return [0, letterIndex + (first !== upper ? 0.5 : 0)];
  const num = parseFloat(first);
  if (!Number.isNaN(num)) return [1, num + (first !== upper ? 0.5 : 0)];
  return [2, 0];
}

/** Привычный порядок: XS → 3XL, затем числовые по возрастанию, затем остальные в исходном порядке. */
export function sortSizes(labels: string[]): string[] {
  return labels
    .map((label, i) => ({ label, i, r: rank(label) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
    .map((x) => x.label);
}
