/** Категории товаров: создание и управление в админке, фильтр каталога у покупателя. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminCategoryDTO,
  AdminProductDTO,
  CategoryDTO,
  ProductDetailDTO,
  ProductsPageDTO,
} from '@wag/shared';
import { adminHeaders, createTestEnv, tma, type TestEnv } from './helpers.js';

let env: TestEnv;
const buyer = { id: 8001, first_name: 'Ира' };

async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  payload?: unknown,
) {
  const res = await env.app.inject({ method, url, headers, payload: payload as never });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const createCategory = async (name: string) =>
  (await api<AdminCategoryDTO>('POST', '/api/admin/categories', adminHeaders(), { name })).body;
const createProduct = async (title: string, categoryId: number | null, isActive = true) =>
  (await api<AdminProductDTO>('POST', '/api/admin/products', adminHeaders(), { title, price: 1000_00, categoryId, isActive }))
    .body;

let sneakers: AdminCategoryDTO;
let hoodies: AdminCategoryDTO;
let empty: AdminCategoryDTO;

beforeAll(async () => {
  env = await createTestEnv();
  sneakers = await createCategory('  Кроссовки ');
  hoodies = await createCategory('Худи');
  empty = await createCategory('Аксессуары');
  await createProduct('Air Max', sneakers.id);
  await createProduct('990v6', sneakers.id);
  await createProduct('Скрытые кеды', sneakers.id, false);
  await createProduct('Tech Fleece', hoodies.id);
  await createProduct('Без категории', null);
});

afterAll(async () => {
  await env?.close();
});

describe('Категории', () => {
  it('создаются с обрезкой пробелов; дубликаты без учёта регистра отклоняются', async () => {
    expect(sneakers.name).toBe('Кроссовки');
    const dup = await api<{ error: { code: string } }>('POST', '/api/admin/categories', adminHeaders(), { name: 'кроссовки' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CATEGORY_EXISTS');
    const blank = await api('POST', '/api/admin/categories', adminHeaders(), { name: '   ' });
    expect(blank.status).toBe(400);
  });

  it('админ видит все категории со счётчиками, включая скрытые товары и пустые категории', async () => {
    const list = (await api<AdminCategoryDTO[]>('GET', '/api/admin/categories', adminHeaders())).body;
    expect(list.map((c) => [c.name, c.productsCount, c.activeCount])).toEqual([
      ['Кроссовки', 3, 2],
      ['Худи', 1, 1],
      ['Аксессуары', 0, 0],
    ]);
  });

  it('покупатель видит только непустые категории и фильтрует каталог', async () => {
    const cats = (await api<CategoryDTO[]>('GET', '/api/categories', tma(buyer))).body;
    expect(cats).toEqual([
      { id: sneakers.id, name: 'Кроссовки', productsCount: 2 },
      { id: hoodies.id, name: 'Худи', productsCount: 1 },
    ]);

    const filtered = (await api<ProductsPageDTO>('GET', `/api/products?categoryId=${sneakers.id}`, tma(buyer))).body;
    expect(filtered.total).toBe(2);
    expect(filtered.items.map((p) => p.title).sort()).toEqual(['990v6', 'Air Max']);

    const all = (await api<ProductsPageDTO>('GET', '/api/products', tma(buyer))).body;
    expect(all.total).toBe(4);
  });

  it('карточка товара содержит категорию', async () => {
    const page = (await api<ProductsPageDTO>('GET', `/api/products?categoryId=${hoodies.id}`, tma(buyer))).body;
    const card = (await api<ProductDetailDTO>('GET', `/api/products/${page.items[0]!.id}`, tma(buyer))).body;
    expect(card.category).toEqual({ id: hoodies.id, name: 'Худи' });
  });

  it('несуществующая категория у товара — понятная ошибка поля', async () => {
    const res = await api<{ error: { details: { path: string }[] } }>('POST', '/api/admin/products', adminHeaders(), {
      title: 'X',
      price: 100,
      categoryId: 999_999,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]?.path).toBe('categoryId');
  });

  it('товар можно перенести в другую категорию и убрать из категории', async () => {
    const product = await createProduct('Кепка', null);
    const moved = (await api<AdminProductDTO>('PATCH', `/api/admin/products/${product.id}`, adminHeaders(), { categoryId: empty.id }))
      .body;
    expect(moved.categoryId).toBe(empty.id);
    // PATCH без categoryId категорию не трогает
    const renamed = (await api<AdminProductDTO>('PATCH', `/api/admin/products/${product.id}`, adminHeaders(), { title: 'Кепка NY' }))
      .body;
    expect(renamed.categoryId).toBe(empty.id);
    const cleared = (await api<AdminProductDTO>('PATCH', `/api/admin/products/${product.id}`, adminHeaders(), { categoryId: null }))
      .body;
    expect(cleared.categoryId).toBeNull();
  });

  it('переименование, порядок и удаление', async () => {
    const renamed = await api<AdminCategoryDTO>('PATCH', `/api/admin/categories/${hoodies.id}`, adminHeaders(), {
      name: 'Худи и свитшоты',
    });
    expect(renamed.body).toMatchObject({ name: 'Худи и свитшоты', productsCount: 1 });
    const clash = await api('PATCH', `/api/admin/categories/${hoodies.id}`, adminHeaders(), { name: 'КРОССОВКИ' });
    expect(clash.status).toBe(409);

    expect((await api('PUT', '/api/admin/categories/order', adminHeaders(), { ids: [empty.id, hoodies.id] })).status).toBe(204);
    const ordered = (await api<AdminCategoryDTO[]>('GET', '/api/admin/categories', adminHeaders())).body;
    expect(ordered.map((c) => c.id)).toEqual([empty.id, hoodies.id, sneakers.id]);

    // Удаление категории не удаляет товары — они остаются без категории.
    expect((await api('DELETE', `/api/admin/categories/${sneakers.id}`, adminHeaders())).status).toBe(204);
    const products = (await api<{ items: AdminProductDTO[] }>('GET', '/api/admin/products', adminHeaders())).body.items;
    expect(products.find((p) => p.title === 'Air Max')?.categoryId).toBeNull();
    const cats = (await api<CategoryDTO[]>('GET', '/api/categories', tma(buyer))).body;
    expect(cats.map((c) => c.name)).toEqual(['Худи и свитшоты']);
  });

  it('управление категориями доступно только администратору', async () => {
    expect((await api('GET', '/api/admin/categories', tma(buyer))).status).toBe(403);
    expect((await api('POST', '/api/admin/categories', tma(buyer), { name: 'Взлом' })).status).toBe(403);
  });
});
