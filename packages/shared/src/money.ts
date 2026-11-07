/**
 * Все денежные значения в системе хранятся и передаются в КОПЕЙКАХ (целое число).
 * Это исключает ошибки округления float и позволяет в будущем работать с копейками.
 */

const NBSP = ' ';

/** 1999000 → "19 990 ₽" */
export function formatPrice(kopecks: number): string {
  const rubles = Math.trunc(kopecks / 100);
  const rest = Math.abs(kopecks % 100);
  const int = String(Math.abs(rubles)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const sign = kopecks < 0 ? '-' : '';
  const frac = rest ? `,${String(rest).padStart(2, '0')}` : '';
  return `${sign}${int}${frac}${NBSP}₽`;
}

/** Преобразует ввод администратора ("19 990", "19990,50") в копейки. null — если ввод пустой или некорректный. */
export function parseRublesInput(input: string): number | null {
  const cleaned = input.replace(/[\s ₽]/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [int, frac = ''] = cleaned.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0'));
}

/** Копейки → строка для поля ввода ("19990" или "19990,50"). */
export function kopecksToInput(kopecks: number | null | undefined): string {
  if (kopecks == null) return '';
  const rub = Math.trunc(kopecks / 100);
  const rest = kopecks % 100;
  return rest ? `${rub},${String(rest).padStart(2, '0')}` : String(rub);
}
