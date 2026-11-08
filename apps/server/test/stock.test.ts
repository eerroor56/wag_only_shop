/** Остатки товаров (списание, возврат при отмене) и сортировка / поиск / фильтр «в наличии» в каталоге. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminOrderDTO, AdminProductDTO, CartDTO, OrderDTO, ProductsPageDTO } from '@wag/shared';
import { adminHeaders, createTestEnv, tma, type TestEnv } from './helpers.js';

let env: TestEnv;
const anna = { id: 9001, first_name: 'Анна' };
const boris = { id: 9002, first_name: 'Борис' };

async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  payload?: unknown,
) {
  const res = await env.app.inject({ method, url, headers, payload: payload as never });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const product = async (data: Record<string, unknown>) =>
  (await api<AdminProductDTO>('POST', '/api/admin/products', adminHeaders(), { price: 1000_00, ...data })).body;

const checkout = (user: { id: number; first_name: string }) =>
  api<OrderDTO & { error?: { code: string; message: string } }>('POST', '/api/orders', tma(user), {
    customerName: user.first_name,
    phone: '+79990000000',
    idempotencyKey: randomUUID(),
  });

const catalog = async (query = '') =>
  (await api<ProductsPageDTO>('GET', `/api/products?${query}`, tma(anna))).body.items.map((p) => p.title);

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env?.close();
});

describe('Остатки', () => {
  let hoodie: AdminProductDTO;
  let cap: AdminProductDTO;

  it('приводятся к списку размеров; без размеров — ключ ""; null — не учитываются', async () => {
    hoodie = await product({ title: 'Худи Остаток', sizes: ['M', 'L'], stock: { m: 2, XL: 7 } });
    expect(hoodie.stock).toEqual({ M: 2, L: 0 });
    expect(hoodie.stockTotal).toBe(2);

    cap = await product({ title: 'Кепка Остаток', stock: { '': 1 } });
    expect(cap.stock).toEqual({ '': 1 });

    const free = await product({ title: 'Без учёта' });
    expect(free.stock).toBeNull();
    expect(free.stockTotal).toBeNull();

    const negative = await api('POST', '/api/admin/products', adminHeaders(), { title: 'X', price: 1, stock: { '': -1 } });
    expect(negative.status).toBe(400);
  });

  it('удаление размера удаляет его остаток, новый размер получает 0', async () => {
    const tmp = await product({ title: 'Временный', sizes: ['S', 'M'], stock: { S: 1, M: 4 } });
    const patched = (await api<AdminProductDTO>('PATCH', `/api/admin/products/${tmp.id}`, adminHeaders(), { sizes: ['M', 'XL'] }))
      .body;
    expect(patched.stock).toEqual({ M: 4, XL: 0 });
    expect(patched.stockTotal).toBe(4);
  });

  it('в корзину нельзя положить больше, чем в наличии', async () => {
    const over = await api<{ error: { code: string; message: string } }>('POST', '/api/cart/items', tma(anna), {
      productId: hoodie.id,
      size: 'M',
      quantity: 3,
    });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('OUT_OF_STOCK');
    expect(over.body.error.message).toContain('только 2 шт.');

    const soldSize = await api('POST', '/api/cart/items', tma(anna), { productId: hoodie.id, size: 'L' });
    expect(soldSize.status).toBe(409);

    const ok = (await api<CartDTO>('POST', '/api/cart/items', tma(anna), { productId: hoodie.id, size: 'M', quantity: 2 })).body;
    expect(ok.items[0]).toMatchObject({ quantity: 2, maxQuantity: 2, available: true });

    const more = await api('PATCH', `/api/cart/items/${ok.items[0]!.id}`, tma(anna), { quantity: 3 });
    expect(more.status).toBe(409);
  });

  it('заказ списывает остаток; у второго покупателя позиция становится «закончился»', async () => {
    await api('POST', '/api/cart/items', tma(boris), { productId: hoodie.id, size: 'M', quantity: 1 });

    const order = await checkout(anna);
    expect(order.status).toBe(201);
    const after = (await api<AdminProductDTO>('GET', `/api/admin/products/${hoodie.id}`, adminHeaders())).body;
    expect(after.stock).toEqual({ M: 0, L: 0 });
    expect(after.stockTotal).toBe(0);

    const borisCart = (await api<CartDTO>('GET', '/api/cart', tma(boris))).body;
    expect(borisCart.items[0]).toMatchObject({ available: false, unavailableReason: 'soldout', maxQuantity: 0 });
    const failed = await checkout(boris);
    expect(failed.status).toBe(409);
    expect(failed.body.error?.message).toContain('закончился');
  });

  it('отмена заказа возвращает товар на склад, восстановление — списывает снова', async () => {
    const orders = (await api<{ items: AdminOrderDTO[] }>('GET', '/api/admin/orders', adminHeaders())).body.items;
    const annaOrder = orders.find((o) => o.items.some((i) => i.productId === hoodie.id))!;

    await api('PATCH', `/api/admin/orders/${annaOrder.id}`, adminHeaders(), { status: 'cancelled' });
    let current = (await api<AdminProductDTO>('GET', `/api/admin/products/${hoodie.id}`, adminHeaders())).body;
    expect(current.stock).toEqual({ M: 2, L: 0 });

    // повторная «отмена» отменённого заказа не удваивает возврат
    await api('PATCH', `/api/admin/orders/${annaOrder.id}`, adminHeaders(), { status: 'cancelled' });
    current = (await api<AdminProductDTO>('GET', `/api/admin/products/${hoodie.id}`, adminHeaders())).body;
    expect(current.stock).toEqual({ M: 2, L: 0 });

    // Борис покупает освободившийся товар — восстановить заказ Анны уже не из чего.
    expect((await checkout(boris)).status).toBe(201);
    const restore = await api<{ error: { code: string } }>('PATCH', `/api/admin/orders/${annaOrder.id}`, adminHeaders(), {
      status: 'processing',
    });
    expect(restore.status).toBe(409);
    expect(restore.body.error.code).toBe('OUT_OF_STOCK');
    const still = (await api<AdminOrderDTO>('GET', `/api/admin/orders/${annaOrder.id}`, adminHeaders())).body;
    expect(still.status).toBe('cancelled');

    // Пополнили склад — заказ восстанавливается и списывает остаток.
    await api('PATCH', `/api/admin/products/${hoodie.id}`, adminHeaders(), { stock: { M: 5, L: 0 } });
    expect((await api('PATCH', `/api/admin/orders/${annaOrder.id}`, adminHeaders(), { status: 'processing' })).status).toBe(200);
    current = (await api<AdminProductDTO>('GET', `/api/admin/products/${hoodie.id}`, adminHeaders())).body;
    expect(current.stock).toEqual({ M: 3, L: 0 });
  });

  it('карточка каталога отдаёт остатки и признак soldOut', async () => {
    await api('PATCH', `/api/admin/products/${cap.id}`, adminHeaders(), { stock: { '': 0 } });
    const page = (await api<ProductsPageDTO>('GET', '/api/products?q=остаток', tma(anna))).body;
    const capCard = page.items.find((p) => p.id === cap.id)!;
    expect(capCard).toMatchObject({ soldOut: true, stock: { '': 0 } });
    expect(page.items.find((p) => p.id === hoodie.id)).toMatchObject({ soldOut: false, stock: { M: 3, L: 0 } });
  });
});

describe('Сортировка и поиск', () => {
  beforeAll(async () => {
    // отдельный набор товаров в своей категории, чтобы не зависеть от товаров из блока «Остатки»
    const { body: cat } = await api<{ id: number }>('POST', '/api/admin/categories', adminHeaders(), { name: 'Сортировка' });
    const add = (title: string, price: number, stock: Record<string, number> | null = null) =>
      product({ title, price, stock, categoryId: cat.id });
    await add('banana Tee', 3000_00);
    await add('Ёлочная шапка', 1000_00);
    await add('Apple Hoodie', 5000_00);
    await add('ялик', 2000_00);
    await add('Жилет', 4000_00, { '': 0 });
    sortCategory = cat.id;
  });
  let sortCategory = 0;
  const inCat = (query: string) => catalog(`categoryId=${sortCategory}&${query}`);

  it('цена: дешевле / дороже, закончившиеся — в конце', async () => {
    expect(await inCat('sort=price_asc')).toEqual(['Ёлочная шапка', 'ялик', 'banana Tee', 'Apple Hoodie', 'Жилет']);
    expect(await inCat('sort=price_desc')).toEqual(['Apple Hoodie', 'banana Tee', 'ялик', 'Ёлочная шапка', 'Жилет']);
  });

  it('название: А→Я без учёта регистра, латиница перед кириллицей, ё как е', async () => {
    expect(await inCat('sort=title_asc')).toEqual(['Apple Hoodie', 'banana Tee', 'Ёлочная шапка', 'ялик', 'Жилет']);
    expect(await inCat('sort=title_desc')).toEqual(['ялик', 'Ёлочная шапка', 'banana Tee', 'Apple Hoodie', 'Жилет']);
  });

  it('новинки и неизвестная сортировка', async () => {
    expect(await inCat('sort=new')).toEqual(['ялик', 'Apple Hoodie', 'Ёлочная шапка', 'banana Tee', 'Жилет']);
    const fallback = await api('GET', `/api/products?categoryId=${sortCategory}&sort=hack`, tma(anna));
    expect(fallback.status).toBe(200);
  });

  it('поиск по названию — без учёта регистра и ё, спецсимволы LIKE не работают как шаблон', async () => {
    expect(await inCat('q=ЕЛОЧ')).toEqual(['Ёлочная шапка']);
    expect(await inCat(`q=${encodeURIComponent('hoodie')}`)).toEqual(['Apple Hoodie']);
    expect(await inCat(`q=${encodeURIComponent('%')}`)).toEqual([]);
  });

  it('«только в наличии» скрывает закончившиеся', async () => {
    expect(await inCat('sort=price_asc&inStock=1')).toEqual(['Ёлочная шапка', 'ялик', 'banana Tee', 'Apple Hoodie']);
  });
});
