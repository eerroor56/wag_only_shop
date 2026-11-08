import { sizeKey } from './sizes.js';

/**
 * Остатки товара: { "M": 3, "L": 0 }, у товара без размеров — { "": 5 }.
 * null — остатки не учитываются: товар всегда в наличии, количество не ограничено.
 */
export type ProductStock = Record<string, number>;

/** Ключ остатка товара без размеров. */
export const NO_SIZE_STOCK_KEY = '';

/** Порог «Осталось N шт.» в карточке. */
export const LOW_STOCK_THRESHOLD = 3;

/**
 * Приводит остатки к списку размеров: каждому размеру — своё число (по умолчанию 0),
 * лишние ключи (удалённые размеры) отбрасываются. Совпадение размеров — без учёта регистра.
 */
export function normalizeStock(sizes: string[], stock: ProductStock | null): ProductStock | null {
  if (stock == null) return null;
  const byKey = new Map(Object.entries(stock).map(([k, v]) => [sizeKey(k), v]));
  const keys = sizes.length ? sizes : [NO_SIZE_STOCK_KEY];
  return Object.fromEntries(keys.map((k) => [k, Math.max(0, Math.trunc(byKey.get(sizeKey(k)) ?? 0))]));
}

export function stockTotal(stock: ProductStock | null): number | null {
  return stock == null ? null : Object.values(stock).reduce((sum, n) => sum + n, 0);
}

/** Сколько можно купить в выбранном размере; null — без ограничений. size = null — товар без размеров. */
export function availableStock(stock: ProductStock | null, size: string | null): number | null {
  if (stock == null) return null;
  const key = size ?? NO_SIZE_STOCK_KEY;
  const exact = stock[key];
  if (exact !== undefined) return exact;
  const found = Object.entries(stock).find(([k]) => sizeKey(k) === sizeKey(key));
  return found ? found[1] : 0;
}

export const isSoldOut = (stock: ProductStock | null) => stock != null && stockTotal(stock) === 0;

// ---------- Сортировка каталога ----------

export const CATALOG_SORTS = ['default', 'price_asc', 'price_desc', 'title_asc', 'title_desc', 'new'] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  default: 'Рекомендуем',
  price_asc: 'Сначала дешевле',
  price_desc: 'Сначала дороже',
  title_asc: 'По названию: А → Я',
  title_desc: 'По названию: Я → А',
  new: 'Новинки',
};

/**
 * Ключ поиска по названию — тот же, что колонка products.title_sort: нижний регистр, ё → е.
 */
export const titleSearchKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
