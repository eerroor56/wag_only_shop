/** Размеры одежды: выбор в корзине, snapshot в заказе, уведомление, изменение списка размеров. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminOrderDTO, AdminProductDTO, CartDTO, OrderDTO, ProductDetailDTO } from '@wag/shared';
import { ADMIN_ID, adminHeaders, createTestEnv, tma, waitFor, type TestEnv } from './helpers.js';

let env: TestEnv;
const buyer = { id: 7001, first_name: 'Олег', username: 'oleg' };

async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await env.app.inject({ method, url, headers, payload: payload as never });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

let jacket: AdminProductDTO;
let cap: AdminProductDTO;

beforeAll(async () => {
  env = await createTestEnv();
  jacket = (
    await api<AdminProductDTO>('POST', '/api/admin/products', adminHeaders(), {
      title: 'Куртка',
      price: 10_000_00,
      sizes: ['l', ' m ', '48 - 52', '52/54'],
    })
  ).body;
  cap = (await api<AdminProductDTO>('POST', '/api/admin/products', adminHeaders(), { title: 'Кепка', price: 2_000_00 })).body;
});

afterAll(async () => {
  await env?.close();
});

describe('Размеры', () => {
  it('нормализуются и сохраняются в порядке администратора', () => {
    expect(jacket.sizes).toEqual(['L', 'M', '48-52', '52/54']);
    expect(cap.sizes).toEqual([]);
  });

  it('повторяющиеся и некорректные размеры отклоняются', async () => {
    const dup = await api('POST', '/api/admin/products', adminHeaders(), { title: 'X', price: 100, sizes: ['M', 'm'] });
    expect(dup.status).toBe(400);
    const bad = await api('POST', '/api/admin/products', adminHeaders(), { title: 'X', price: 100, sizes: ['<b>'] });
    expect(bad.status).toBe(400);
  });

  it('карточка товара отдаёт размеры', async () => {
    const card = await api<ProductDetailDTO>('GET', `/api/products/${jacket.id}`, tma(buyer));
    expect(card.body.sizes).toEqual(['L', 'M', '48-52', '52/54']);
  });

  it('для товара с размерами размер обязателен и должен быть из списка', async () => {
    const none = await api<{ error: { details: { path: string }[] } }>('POST', '/api/cart/items', tma(buyer), { productId: jacket.id });
    expect(none.status).toBe(400);
    expect(none.body.error.details[0]?.path).toBe('size');
    const wrong = await api('POST', '/api/cart/items', tma(buyer), { productId: jacket.id, size: 'XXL' });
    expect(wrong.status).toBe(400);
  });

  it('разные размеры одного товара — разные позиции; размер приводится к написанию из карточки', async () => {
    await api('POST', '/api/cart/items', tma(buyer), { productId: jacket.id, size: 'm' });
    await api('POST', '/api/cart/items', tma(buyer), { productId: jacket.id, size: 'M' });
    const cart = (await api<CartDTO>('POST', '/api/cart/items', tma(buyer), { productId: jacket.id, size: '48-52' })).body;
    const bySize = Object.fromEntries(cart.items.map((i) => [i.size, i.quantity]));
    expect(bySize).toEqual({ M: 2, '48-52': 1 });
    // товар без размеров: переданный размер игнорируется
    const withCap = (await api<CartDTO>('POST', '/api/cart/items', tma(buyer), { productId: cap.id, size: 'M' })).body;
    expect(withCap.items.find((i) => i.productId === cap.id)?.size).toBeNull();
    expect(withCap.totalAmount).toBe(3 * 10_000_00 + 2_000_00);
  });

  it('удалённый администратором размер делает позицию недоступной', async () => {
    await api('PATCH', `/api/admin/products/${jacket.id}`, adminHeaders(), { sizes: ['L', 'M', '52/54'] });
    const cart = (await api<CartDTO>('GET', '/api/cart', tma(buyer))).body;
    const removed = cart.items.find((i) => i.size === '48-52')!;
    expect(removed).toMatchObject({ available: false, unavailableReason: 'size' });
    expect(cart.totalAmount).toBe(2 * 10_000_00 + 2_000_00);

    const checkout = await api<{ error: { code: string; message: string } }>('POST', '/api/orders', tma(buyer), {
      customerName: 'Олег',
      phone: '+79991112233',
      idempotencyKey: randomUUID(),
    });
    expect(checkout.body.error.code).toBe('CART_HAS_UNAVAILABLE');
    expect(checkout.body.error.message).toContain('Куртка (48-52)');

    await api('DELETE', `/api/cart/items/${removed.id}`, tma(buyer));
  });

  it('размер сохраняется в заказе и уведомлении и не меняется после правок товара', async () => {
    const res = await api<OrderDTO>('POST', '/api/orders', tma(buyer), {
      customerName: 'Олег',
      phone: '+79991112233',
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(201);
    expect(res.body.items.map((i) => i.size)).toEqual(['M', null]);

    await waitFor(() => env.telegram.messagesTo(ADMIN_ID).some((m) => String(m.payload.text).includes(`№${res.body.id}`)));
    const text = String(env.telegram.messagesTo(ADMIN_ID).find((m) => String(m.payload.text).includes(`№${res.body.id}`))!.payload.text);
    expect(text).toContain('1. Куртка · размер <b>M</b>');
    expect(text).toContain('2. Кепка\n');

    await api('PATCH', `/api/admin/products/${jacket.id}`, adminHeaders(), { sizes: [] });
    const order = (await api<AdminOrderDTO>('GET', `/api/admin/orders/${res.body.id}`, adminHeaders())).body;
    expect(order.items[0]).toMatchObject({ title: 'Куртка', size: 'M', quantity: 2 });
  });
});
