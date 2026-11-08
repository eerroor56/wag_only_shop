import {
  CATALOG_SORTS,
  COLOR_KEYS,
  GENDERS,
  MATERIAL_KEYS,
  SEASONS,
  type CatalogSort,
  type ColorKey,
  type Gender,
  type MaterialKey,
  type Season,
} from '@wag/shared';

/** Фильтры из панели «Фильтры» (всё, кроме категории, поиска и сортировки). */
export interface AttributeFilters {
  /** Цена «от» / «до» в рублях; null — без ограничения. */
  priceMin: number | null;
  priceMax: number | null;
  /** Ключи брендов (brandKey). */
  brands: string[];
  sizes: string[];
  colors: ColorKey[];
  materials: MaterialKey[];
  seasons: Season[];
  gender: Gender | null;
  inStock: boolean;
}

export interface CatalogFilters extends AttributeFilters {
  categoryId: number | null;
  sort: CatalogSort;
  /** Поиск по названию (уже без лишних пробелов). */
  q: string;
}

export const EMPTY_ATTRIBUTES: AttributeFilters = {
  priceMin: null,
  priceMax: null,
  brands: [],
  sizes: [],
  colors: [],
  materials: [],
  seasons: [],
  gender: null,
  inStock: false,
};

/** Сколько групп фильтров включено — бейдж на кнопке «Фильтры». */
export function activeFiltersCount(f: AttributeFilters): number {
  return [
    f.priceMin != null || f.priceMax != null,
    f.brands.length > 0,
    f.sizes.length > 0,
    f.colors.length > 0,
    f.materials.length > 0,
    f.seasons.length > 0,
    f.gender != null,
    f.inStock,
  ].filter(Boolean).length;
}

// ---------- адрес страницы (?pmin=&pmax=&brand=&size=&color=&mat=&season=&gender=&stock=1) ----------

const list = (params: URLSearchParams, key: string) =>
  (params.get(key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const known = <T extends string>(values: string[], allowed: readonly T[]) =>
  values.filter((v): v is T => (allowed as readonly string[]).includes(v));

const rubles = (raw: string | null) => {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : null;
};

export function readAttributes(params: URLSearchParams): AttributeFilters {
  const gender = params.get('gender');
  return {
    priceMin: rubles(params.get('pmin')),
    priceMax: rubles(params.get('pmax')),
    brands: list(params, 'brand'),
    sizes: list(params, 'size'),
    colors: known(list(params, 'color'), COLOR_KEYS),
    materials: known(list(params, 'mat'), MATERIAL_KEYS),
    seasons: known(list(params, 'season'), SEASONS),
    gender: gender && (GENDERS as readonly string[]).includes(gender) ? (gender as Gender) : null,
    inStock: params.get('stock') === '1',
  };
}

/** Патч адреса для набора фильтров: пустые значения удаляют параметр. */
export function attributesToUrl(f: AttributeFilters): Record<string, string | null> {
  const join = (v: string[]) => (v.length ? v.join(',') : null);
  return {
    pmin: f.priceMin != null && f.priceMin > 0 ? String(f.priceMin) : null,
    pmax: f.priceMax != null ? String(f.priceMax) : null,
    brand: join(f.brands),
    size: join(f.sizes),
    color: join(f.colors),
    mat: join(f.materials),
    season: join(f.seasons),
    gender: f.gender,
    stock: f.inStock ? '1' : null,
  };
}

export const readSort = (params: URLSearchParams): CatalogSort => {
  const s = params.get('sort') as CatalogSort | null;
  return s && CATALOG_SORTS.includes(s) ? s : 'default';
};

// ---------- параметры API (цены — в копейках) ----------

export function catalogApiParams(f: Partial<CatalogFilters>, limit: number, offset = 0): URLSearchParams {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const set = (key: string, value: string | null | undefined) => {
    if (value) params.set(key, value);
  };
  if (f.categoryId != null) set('categoryId', String(f.categoryId));
  if (f.sort && f.sort !== 'default') set('sort', f.sort);
  set('q', f.q);
  if (f.inStock) set('inStock', '1');
  if (f.priceMin != null && f.priceMin > 0) set('priceMin', String(f.priceMin * 100));
  // «до 15 000 ₽» включает 15 000,99 ₽.
  if (f.priceMax != null) set('priceMax', String(f.priceMax * 100 + 99));
  set('brands', f.brands?.join(','));
  set('sizes', f.sizes?.join(','));
  set('colors', f.colors?.join(','));
  set('materials', f.materials?.join(','));
  set('seasons', f.seasons?.join(','));
  set('gender', f.gender);
  return params;
}

/** Стабильный ключ кэша для набора фильтров. */
export const filtersKey = (f: Partial<CatalogFilters>) => catalogApiParams(f, 0).toString();
