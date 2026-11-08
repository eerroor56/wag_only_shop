/**
 * Характеристики товара для фильтров каталога: бренд, пол, цвет, материал, сезон.
 *
 * Цвет и материал задаются двумя полями: текст, который видит покупатель («Графитовый меланж»,
 * «80% хлопок, 20% полиэстер»), и значения из палитры — по ним работает фильтр.
 */

// ---------- Цвета ----------

export interface PaletteColor {
  key: string;
  label: string;
  /** CSS-фон образца (цвет или градиент). */
  swatch: string;
  /** Светлый образец — нужна обводка, чтобы он не терялся на светлом фоне. */
  light?: boolean;
}

export const COLOR_PALETTE = [
  { key: 'black', label: 'Чёрный', swatch: '#121212' },
  { key: 'white', label: 'Белый', swatch: '#ffffff', light: true },
  { key: 'grey', label: 'Серый', swatch: '#8e8e93' },
  { key: 'beige', label: 'Бежевый', swatch: '#d9c4a3', light: true },
  { key: 'brown', label: 'Коричневый', swatch: '#7a4a2a' },
  { key: 'red', label: 'Красный', swatch: '#d32f2f' },
  { key: 'burgundy', label: 'Бордовый', swatch: '#7b1f2e' },
  { key: 'pink', label: 'Розовый', swatch: '#f4a3c0', light: true },
  { key: 'orange', label: 'Оранжевый', swatch: '#f57c00' },
  { key: 'yellow', label: 'Жёлтый', swatch: '#f9cf2b', light: true },
  { key: 'green', label: 'Зелёный', swatch: '#2e8b4a' },
  { key: 'khaki', label: 'Хаки', swatch: '#78744a' },
  { key: 'lightblue', label: 'Голубой', swatch: '#8cc8f2', light: true },
  { key: 'blue', label: 'Синий', swatch: '#1f5bd8' },
  { key: 'navy', label: 'Тёмно-синий', swatch: '#1b2a4a' },
  { key: 'purple', label: 'Фиолетовый', swatch: '#7e57c2' },
  { key: 'silver', label: 'Серебристый', swatch: 'linear-gradient(135deg, #f2f2f2 0%, #a9a9ae 50%, #e6e6e8 100%)', light: true },
  { key: 'gold', label: 'Золотистый', swatch: 'linear-gradient(135deg, #f6e27a 0%, #c9a227 50%, #f3d870 100%)', light: true },
  {
    key: 'multi',
    label: 'Разноцветный',
    swatch: 'conic-gradient(#e53935, #fb8c00, #fdd835, #43a047, #1e88e5, #8e24aa, #e53935)',
  },
] as const satisfies readonly PaletteColor[];

export type ColorKey = (typeof COLOR_PALETTE)[number]['key'];
export const COLOR_KEYS = COLOR_PALETTE.map((c) => c.key) as [ColorKey, ...ColorKey[]];
export const colorByKey = (key: string): PaletteColor | undefined => COLOR_PALETTE.find((c) => c.key === key);

// ---------- Материалы ----------

export interface PaletteMaterial {
  key: string;
  label: string;
}

export const MATERIAL_PALETTE = [
  { key: 'cotton', label: 'Хлопок' },
  { key: 'polyester', label: 'Полиэстер' },
  { key: 'wool', label: 'Шерсть' },
  { key: 'cashmere', label: 'Кашемир' },
  { key: 'linen', label: 'Лён' },
  { key: 'viscose', label: 'Вискоза' },
  { key: 'nylon', label: 'Нейлон' },
  { key: 'elastane', label: 'Эластан' },
  { key: 'fleece', label: 'Флис' },
  { key: 'knit', label: 'Трикотаж' },
  { key: 'denim', label: 'Деним' },
  { key: 'leather', label: 'Кожа' },
  { key: 'ecoleather', label: 'Экокожа' },
  { key: 'suede', label: 'Замша' },
  { key: 'mesh', label: 'Сетка' },
  { key: 'down', label: 'Пух' },
  { key: 'synthetic', label: 'Синтетика' },
] as const satisfies readonly PaletteMaterial[];

export type MaterialKey = (typeof MATERIAL_PALETTE)[number]['key'];
export const MATERIAL_KEYS = MATERIAL_PALETTE.map((m) => m.key) as [MaterialKey, ...MaterialKey[]];
export const materialByKey = (key: string): PaletteMaterial | undefined => MATERIAL_PALETTE.find((m) => m.key === key);

// ---------- Пол и сезон ----------

export const GENDERS = ['men', 'women', 'unisex'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = { men: 'Мужское', women: 'Женское', unisex: 'Унисекс' };

export const SEASONS = ['summer', 'demi', 'winter', 'all'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_LABELS: Record<Season, string> = {
  summer: 'Лето',
  demi: 'Демисезон',
  winter: 'Зима',
  all: 'Всесезон',
};

/** Сколько цветов / материалов из палитры можно отметить у одного товара. */
export const PALETTE_PICK_MAX = 4;

// ---------- Бренд ----------

/** Ключ сравнения брендов: «NIKE», «Nike» и «nike» — один бренд в фильтре. */
export const brandKey = (brand: string) => brand.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');

// ---------- Подбор палитры по тексту ----------

/** Порядок важен: составные («тёмно-синий», «экокожа») проверяются раньше простых и «съедают» совпадение. */
const COLOR_WORDS: [RegExp, ColorKey][] = [
  [/т[её]мно[\s-]?син\p{L}*|navy|нэйви|нейви/giu, 'navy'],
  [/серебр\p{L}*|silver|металлик/giu, 'silver'],
  [/золот\p{L}*|gold/giu, 'gold'],
  [/разноцветн\p{L}*|мульти\p{L}*|multicolou?r|принт\p{L}*/giu, 'multi'],
  [/ч[её]рн\p{L}*|black/giu, 'black'],
  [/(?<!\p{L})бел\p{L}*|white|молочн\p{L}*|айвори|ivory|кремов\p{L}*/giu, 'white'],
  [/(?<!\p{L})сер(ый|ая|ое|ые|ого|ой|ую|ых)?(?!\p{L})|графит\p{L}*|антрацит\p{L}*|grey|gray|меланж/giu, 'grey'],
  [/беж\p{L}*|beige|песочн\p{L}*|sand/giu, 'beige'],
  [/коричн\p{L}*|шоколад\p{L}*|кэмел|camel|brown|кофейн\p{L}*/giu, 'brown'],
  [/бордо\p{L}*|винн\p{L}*|burgundy|марсала/giu, 'burgundy'],
  [/красн\p{L}*|red\b|(?<!\p{L})алый/giu, 'red'],
  [/розов\p{L}*|pink|пудров\p{L}*/giu, 'pink'],
  [/оранж\p{L}*|orange|терракот\p{L}*/giu, 'orange'],
  [/ж[её]лт\p{L}*|yellow|горчичн\p{L}*/giu, 'yellow'],
  [/хаки|khaki|олив\p{L}*|olive/giu, 'khaki'],
  [/зел[её]н\p{L}*|green|мятн\p{L}*/giu, 'green'],
  [/голуб\p{L}*|light ?blue|небесн\p{L}*/giu, 'lightblue'],
  [/(?<!\p{L})син\p{L}*|blue|индиго/giu, 'blue'],
  [/фиолет\p{L}*|сирен\p{L}*|лилов\p{L}*|purple|лаванд\p{L}*/giu, 'purple'],
];

const MATERIAL_WORDS: [RegExp, MaterialKey][] = [
  [/эко[\s-]?кож\p{L}*|искусственн\p{L}* кож\p{L}*|ecoleather|eco[\s-]leather|faux leather/giu, 'ecoleather'],
  [/(?<!\p{L})кож\p{L}*|leather/giu, 'leather'],
  [/хлоп\p{L}*|cotton|футер\p{L}*/giu, 'cotton'],
  [/полиэст\p{L}*|polyester/giu, 'polyester'],
  [/кашемир\p{L}*|cashmere/giu, 'cashmere'],
  [/шерст\p{L}*|wool|мерино\p{L}*/giu, 'wool'],
  [/(?<!\p{L})л[её]н(?!\p{L})|льнян\p{L}*|linen/giu, 'linen'],
  [/вискоз\p{L}*|viscose/giu, 'viscose'],
  [/нейлон\p{L}*|полиамид\p{L}*|nylon|polyamide/giu, 'nylon'],
  [/эластан\p{L}*|спандекс\p{L}*|лайкр\p{L}*|elastane|spandex/giu, 'elastane'],
  [/флис\p{L}*|fleece/giu, 'fleece'],
  [/трикотаж\p{L}*|knit/giu, 'knit'],
  [/деним\p{L}*|джинс\p{L}*|denim/giu, 'denim'],
  [/замш\p{L}*|suede|нубук\p{L}*/giu, 'suede'],
  [/сетк\p{L}*|сетчат\p{L}*|mesh/giu, 'mesh'],
  [/(?<!\p{L})пух(?!\p{L})|пухов\p{L}*|\bdown\b/giu, 'down'],
  [/синтет\p{L}*|синтепон\p{L}*|synthetic/giu, 'synthetic'],
];

function detect<K extends string>(text: string, words: [RegExp, K][]): K[] {
  let rest = text.toLowerCase();
  const found: K[] = [];
  for (const [re, key] of words) {
    re.lastIndex = 0;
    if (!re.test(rest)) continue;
    if (!found.includes(key)) found.push(key);
    rest = rest.replace(re, ' ');
  }
  return found.slice(0, PALETTE_PICK_MAX);
}

/** «Тёмно-синий с белым» → ['navy', 'white']. Подсказка для админки: палитру можно поправить вручную. */
export const detectColors = (text: string) => detect(text, COLOR_WORDS);
/** «80% хлопок, 20% полиэстер» → ['cotton', 'polyester']. */
export const detectMaterials = (text: string) => detect(text, MATERIAL_WORDS);

/** Текст цвета для покупателя: введённое название или подписи выбранных цветов палитры. */
export function colorDisplay(colorName: string | null, colors: readonly string[]): string | null {
  if (colorName) return colorName;
  const labels = colors.map((k) => colorByKey(k)?.label).filter(Boolean);
  return labels.length ? labels.join(', ') : null;
}

export function materialDisplay(materialName: string | null, materials: readonly string[]): string | null {
  if (materialName) return materialName;
  const labels = materials.map((k) => materialByKey(k)?.label).filter(Boolean);
  return labels.length ? labels.join(', ') : null;
}

// ---------- Фасеты каталога ----------

export interface FacetValue<T extends string = string> {
  value: T;
  /** Товаров в продаже с этим значением (в выбранной категории). */
  count: number;
}

/** Доступные значения фильтров каталога — строятся по товарам в продаже выбранной категории. */
export interface CatalogFacetsDTO {
  /** Цена самого дорогого товара, копейки (верхняя граница ползунка). */
  priceMax: number;
  brands: (FacetValue & { label: string })[];
  genders: FacetValue<Gender>[];
  sizes: FacetValue[];
  colors: FacetValue<ColorKey>[];
  materials: FacetValue<MaterialKey>[];
  seasons: FacetValue<Season>[];
}
