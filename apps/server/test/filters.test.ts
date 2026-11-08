/** Фильтры каталога: бренд, пол, размер, цвет, материал, сезон, цена — и фасеты для панели фильтров. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminProductDTO, CatalogFacetsDTO, ProductDetailDTO, ProductsPageDTO } from '@wag/shared';
import { adminHeaders, createTestEnv, tma, type TestEnv } from './helpers.js';

let env: TestEnv;
const user = { id: 9101, first_name: 'Вера' };
let categoryId: number;
let otherCategoryId: number;

async function api<T>(method: 'GET' | 'POST' | 'PATCH', url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await env.app.inject({ method, url, headers, payload: payload as never });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const create = async (data: Record<string, unknown>) => {
  const res = await api<AdminProductDTO>('POST', '/api/admin/products', adminHeaders(), {
    price: 1000_00,
    categoryId,
    ...data,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};

/** Названия товаров каталога в выбранной категории по фильтру. */
const titles = async (query: string) => {
  const res = await api<ProductsPageDTO>('GET', `/api/products?categoryId=${categoryId}&sort=title_asc&${query}`, tma(user));
  expect(res.status).toBe(200);
  return res.body.items.map((p) => p.title);
};

beforeAll(async () => {
  env = await createTestEnv();
  const cat = async (name: string) =>
    (await api<{ id: number }>('POST', '/api/admin/categories', adminHeaders(), { name })).body.id;
  categoryId = await cat('Фильтры');
  otherCategoryId = await cat('Фильтры-2');

  await create({
    title: 'A Худи',
    brand: 'Nike',
    colorName: 'Графит',
    colors: ['grey', 'black'],
    materialName: '80% хлопок, 20% полиэстер',
    materials: ['cotton', 'polyester'],
    gender: 'men',
    seasons: ['demi'],
    sizes: ['M', 'L'],
    stock: { M: 0, L: 3 },
    price: 5000_00,
  });
  await create({
    title: 'B Куртка',
    brand: 'NIKE ',
    colors: ['navy'],
    materials: ['nylon', 'down'],
    gender: 'women',
    seasons: ['winter'],
    sizes: ['S', 'M'],
    price: 20000_00,
  });
  await create({
    title: 'C Футболка',
    brand: 'Stone Island',
    colors: ['white'],
    materials: ['cotton'],
    gender: 'unisex',
    seasons: ['all'],
    price: 3000_00,
  });
  await create({ title: 'D Без характеристик', price: 1000_00 });
  await create({ title: 'E Другая категория', brand: 'Adidas', price: 90000_00, categoryId: otherCategoryId });
});

afterAll(async () => {
  await env?.close();
});

describe('Характеристики товара', () => {
  it('сохраняются, нормализуются и отдаются в карточке', async () => {
    const p = await create({
      title: 'Z Проверка',
      brand: '  Carhartt   WIP ',
      colorName: '',
      colors: ['black', 'black'],
      materials: [],
      seasons: ['summer', 'summer'],
    });
    expect(p.brand).toBe('Carhartt WIP');
    expect(p.colorName).toBeNull();
    expect(p.colors).toEqual(['black']);
    expect(p.seasons).toEqual(['summer']);

    const detail = await api<ProductDetailDTO>('GET', `/api/products/${p.id}`, tma(user));
    expect(detail.body.brand).toBe('Carhartt WIP');
    expect(detail.body.colors).toEqual(['black']);
    expect(detail.body.gender).toBeNull();

    // PATCH меняет только переданное.
    const patched = await api<AdminProductDTO>('PATCH', `/api/admin/products/${p.id}`, adminHeaders(), { gender: 'women' });
    expect(patched.body.gender).toBe('women');
    expect(patched.body.brand).toBe('Carhartt WIP');
    await api('PATCH', `/api/admin/products/${p.id}`, adminHeaders(), { isActive: false });
  });

  it('отклоняет неизвестный цвет, слишком много цветов и бренд с запятой', async () => {
    const bad = async (data: Record<string, unknown>) =>
      (await api('POST', '/api/admin/products', adminHeaders(), { title: 'X', price: 1, ...data })).status;
    expect(await bad({ colors: ['ultraviolet'] })).toBe(400);
    expect(await bad({ colors: ['black', 'white', 'red', 'blue', 'green'] })).toBe(400);
    expect(await bad({ brand: 'Nike, Adidas' })).toBe(400);
    expect(await bad({ gender: 'kids' })).toBe(400);
  });
});

describe('Фильтры каталога', () => {
  it('бренд — без учёта регистра и пробелов, несколько через запятую', async () => {
    expect(await titles('brands=nike')).toEqual(['A Худи', 'B Куртка']);
    expect(await titles('brands=NIKE,stone%20island')).toEqual(['A Худи', 'B Куртка', 'C Футболка']);
  });

  it('пол: мужское и женское включают унисекс', async () => {
    expect(await titles('gender=men')).toEqual(['A Худи', 'C Футболка']);
    expect(await titles('gender=women')).toEqual(['B Куртка', 'C Футболка']);
    expect(await titles('gender=unisex')).toEqual(['C Футболка']);
    // Неизвестное значение игнорируется.
    expect(await titles('gender=kids')).toHaveLength(4);
  });

  it('цвет и материал — любой из выбранных', async () => {
    expect(await titles('colors=black')).toEqual(['A Худи']);
    expect(await titles('colors=navy,white')).toEqual(['B Куртка', 'C Футболка']);
    expect(await titles('materials=cotton')).toEqual(['A Худи', 'C Футболка']);
    expect(await titles('materials=down,unknown')).toEqual(['B Куртка']);
  });

  it('сезон: всесезонные вещи подходят под любой сезон', async () => {
    expect(await titles('seasons=winter')).toEqual(['B Куртка', 'C Футболка']);
    expect(await titles('seasons=all')).toEqual(['C Футболка']);
  });

  it('размер учитывает наличие', async () => {
    // У худи размер M закончился.
    expect(await titles('sizes=m')).toEqual(['B Куртка']);
    expect(await titles('sizes=L,s')).toEqual(['A Худи', 'B Куртка']);
  });

  it('диапазон цены', async () => {
    expect(await titles('priceMin=300000&priceMax=500000')).toEqual(['A Худи', 'C Футболка']);
    expect(await titles('priceMin=1000000')).toEqual(['B Куртка']);
    expect(await titles('priceMax=100000')).toEqual(['D Без характеристик']);
  });

  it('фильтры сочетаются', async () => {
    expect(await titles('brands=nike&gender=men&colors=grey&priceMax=600000')).toEqual(['A Худи']);
    expect(await titles('brands=nike&seasons=summer')).toEqual([]);
  });
});

describe('Фасеты', () => {
  it('строятся по товарам в продаже выбранной категории', async () => {
    const { body: f } = await api<CatalogFacetsDTO>('GET', `/api/products/facets?categoryId=${categoryId}`, tma(user));
    expect(f.priceMax).toBe(20000_00);
    expect(f.brands).toEqual([
      { value: 'nike', label: expect.stringMatching(/^NIKE|Nike$/), count: 2 },
      { value: 'stone island', label: 'Stone Island', count: 1 },
    ]);
    expect(f.genders).toEqual([
      { value: 'men', count: 1 },
      { value: 'women', count: 1 },
      { value: 'unisex', count: 1 },
    ]);
    // M есть только у куртки (у худи закончился), размеры в привычном порядке.
    expect(f.sizes).toEqual([
      { value: 'S', count: 1 },
      { value: 'M', count: 1 },
      { value: 'L', count: 1 },
    ]);
    expect(f.colors.map((c) => c.value)).toEqual(['black', 'white', 'grey', 'navy']);
    expect(f.materials.find((m) => m.value === 'cotton')?.count).toBe(2);
    expect(f.seasons.map((s) => s.value)).toEqual(['demi', 'winter', 'all']);
  });

  it('без категории — по всему каталогу', async () => {
    const { body: f } = await api<CatalogFacetsDTO>('GET', '/api/products/facets', tma(user));
    expect(f.priceMax).toBeGreaterThanOrEqual(90000_00);
    expect(f.brands.some((b) => b.value === 'adidas')).toBe(true);
  });
});
