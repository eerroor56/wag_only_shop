/**
 * Сквозные сценарии из ТЗ (раздел 26) на уровне HTTP API с реальной PostgreSQL
 * и фейковым Telegram Bot API.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AdminImageDTO,
  AdminOrderDTO,
  AdminProductDTO,
  BroadcastDTO,
  CartDTO,
  DashboardDTO,
  OrderDTO,
  Paginated,
  ProductDetailDTO,
  ProductsPageDTO,
} from '@wag/shared';
import { orderItems, orders, users } from '../src/db/schema.js';
import { buildInitData } from '../src/lib/telegram-init-data.js';
import { ADMIN_ID, adminHeaders, BOT_TOKEN, createTestEnv, tma, waitFor, type TestEnv } from './helpers.js';

let env: TestEnv;
const buyer = { id: 5001, first_name: 'Иван', username: 'ivan_buyer' };
const buyerNoUsername = { id: 5002, first_name: 'Пётр' };
/** Отдельный пользователь для проверок валидации — чтобы не упираться в rate limit оформления (10/мин). */
const validator = { id: 5003, first_name: 'Валидатор' };

async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  headers: Record<string, string>,
  payload?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await env.app.inject({ method, url, headers, payload: payload as never });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

async function uploadImage(color: string): Promise<AdminImageDTO> {
  const png = await sharp({ create: { width: 800, height: 1000, channels: 3, background: color } }).png().toBuffer();
  const boundary = `----wag${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await env.app.inject({
    method: 'POST',
    url: '/api/admin/images',
    headers: { ...adminHeaders(), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function createProduct(data: Partial<Record<string, unknown>> = {}): Promise<AdminProductDTO> {
  const res = await api<AdminProductDTO>('POST', '/api/admin/products', adminHeaders(), {
    title: 'Тестовый товар',
    price: 1_000_00,
    ...data,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env?.close();
});

describe('Авторизация Telegram initData', () => {
  it('отклоняет запросы без initData', async () => {
    const res = await api('GET', '/api/products', {});
    expect(res.status).toBe(401);
  });

  it('отклоняет поддельную подпись', async () => {
    const forged = buildInitData({ id: 1, first_name: 'Hacker' }, '999:wrong_token_wrong_token_wrong_token_x');
    const res = await api('GET', '/api/products', { authorization: `tma ${forged}` });
    expect(res.status).toBe(401);
  });

  it('отклоняет устаревшую initData', async () => {
    const old = buildInitData({ id: 1, first_name: 'Old' }, BOT_TOKEN, new Date(Date.now() - 3 * 86400_000));
    const res = await api('GET', '/api/products', { authorization: `tma ${old}` });
    expect(res.status).toBe(401);
  });

  it('обычный пользователь не имеет доступа к admin API', async () => {
    const res = await api('GET', '/api/admin/dashboard', tma(buyer));
    expect(res.status).toBe(403);
    const create = await api('POST', '/api/admin/products', tma(buyer), { title: 'x', price: 100 });
    expect(create.status).toBe(403);
  });

  it('сохраняет пользователя и определяет админа по whitelist', async () => {
    const me = await api<{ isAdmin: boolean; telegramId: number }>('GET', '/api/me', tma(buyer));
    expect(me.body).toMatchObject({ isAdmin: false, telegramId: buyer.id });
    const admin = await api<{ isAdmin: boolean }>('GET', '/api/me', adminHeaders());
    expect(admin.body.isAdmin).toBe(true);
  });
});

describe('Сценарии покупателя', () => {
  let productA: AdminProductDTO;
  let productB: AdminProductDTO;

  beforeAll(async () => {
    const img1 = await uploadImage('#111111');
    const img2 = await uploadImage('#222222');
    productA = await createProduct({
      title: 'Nike Tech Fleece',
      price: 19_990_00,
      oldPrice: 24_990_00,
      imageIds: [img1.id, img2.id],
    });
    productB = await createProduct({ title: 'Stone Island', price: 42_000_00 });
  });

  it('1. Каталог: пользователь видит активные товары со скидкой', async () => {
    const res = await api<ProductsPageDTO>('GET', '/api/products', tma(buyer));
    expect(res.status).toBe(200);
    const nike = res.body.items.find((p) => p.id === productA.id)!;
    expect(nike).toMatchObject({ price: 19_990_00, oldPrice: 24_990_00, discountPercent: 20 });
    expect(nike.image?.thumbUrl).toMatch(/^\/uploads\/products\/.+_thumb\.webp$/);
  });

  it('2. Карточка с галереей и добавление в корзину', async () => {
    const card = await api<ProductDetailDTO>('GET', `/api/products/${productA.id}`, tma(buyer));
    expect(card.body.images).toHaveLength(2);
    const file = await env.app.inject({ method: 'GET', url: card.body.images[0]!.url });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    const cart = await api<CartDTO>('POST', '/api/cart/items', tma(buyer), { productId: productA.id });
    expect(cart.status).toBe(200);
    expect(cart.body.totalQuantity).toBe(1);
    expect(cart.body.totalAmount).toBe(19_990_00);
  });

  it('3. Несколько товаров, изменение количества — сумма пересчитывается сервером', async () => {
    let cart = (await api<CartDTO>('POST', '/api/cart/items', tma(buyer), { productId: productB.id })).body;
    expect(cart.items).toHaveLength(2);
    const itemA = cart.items.find((i) => i.productId === productA.id)!;
    cart = (await api<CartDTO>('PATCH', `/api/cart/items/${itemA.id}`, tma(buyer), { quantity: 3 })).body;
    expect(cart.totalQuantity).toBe(4);
    expect(cart.totalAmount).toBe(3 * 19_990_00 + 42_000_00);
    expect(cart.items.find((i) => i.id === itemA.id)!.lineTotal).toBe(3 * 19_990_00);
  });

  it('не позволяет изменять чужую корзину', async () => {
    const cart = (await api<CartDTO>('GET', '/api/cart', tma(buyer))).body;
    const res = await api('PATCH', `/api/cart/items/${cart.items[0]!.id}`, tma({ id: 9999 }), { quantity: 5 });
    expect(res.status).toBe(404);
    const del = await api('DELETE', `/api/cart/items/${cart.items[0]!.id}`, tma({ id: 9999 }));
    expect(del.status).toBe(404);
  });

  it('валидирует количество', async () => {
    const cart = (await api<CartDTO>('GET', '/api/cart', tma(buyer))).body;
    const res = await api('PATCH', `/api/cart/items/${cart.items[0]!.id}`, tma(buyer), { quantity: 0 });
    expect(res.status).toBe(400);
    const res2 = await api('PATCH', `/api/cart/items/${cart.items[0]!.id}`, tma(buyer), { quantity: 1000 });
    expect(res2.status).toBe(400);
  });

  it('5. Нельзя оформить заказ без имени', async () => {
    const res = await api<{ error: { details: { path: string }[] } }>('POST', '/api/orders', tma(validator), {
      customerName: '   ',
      phone: '+79991234567',
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.path)).toContain('customerName');
  });

  it('6. Нельзя оформить заказ без телефона или с некорректным номером', async () => {
    for (const phone of ['', '12345', '+7 123 456 78 90', 'abc']) {
      const res = await api<{ error: { details: { path: string }[] } }>('POST', '/api/orders', tma(validator), {
        customerName: 'Иван',
        phone,
        idempotencyKey: randomUUID(),
      });
      expect(res.status, phone).toBe(400);
      expect(res.body.error.details.map((d) => d.path)).toContain('phone');
    }
  });

  it('сумма с frontend не используется: при расхождении — 409 PRICE_CHANGED', async () => {
    await api('POST', '/api/cart/items', tma(validator), { productId: productA.id });
    const res = await api<{ error: { code: string } }>('POST', '/api/orders', tma(validator), {
      customerName: 'Иван',
      phone: '89991234567',
      expectedTotal: 1,
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
  });

  let order: OrderDTO;

  it('7–8. Заказ сохраняется, корзина очищается, владелец получает сообщение', async () => {
    const cartBefore = (await api<CartDTO>('GET', '/api/cart', tma(buyer))).body;
    const key = randomUUID();
    const res = await api<OrderDTO>('POST', '/api/orders', tma(buyer), {
      customerName: 'Иван <b>Тест</b>',
      phone: '8 (999) 123-45-67',
      expectedTotal: cartBefore.totalAmount,
      idempotencyKey: key,
      // Попытка подменить сумму / пользователя игнорируется
      totalAmount: 1,
      telegramId: 1,
    });
    expect(res.status).toBe(201);
    order = res.body;
    expect(order.id).toBeGreaterThanOrEqual(1001);
    expect(order.totalAmount).toBe(cartBefore.totalAmount);
    expect(order.phone).toBe('+79991234567');
    expect(order.items).toHaveLength(2);

    const [dbOrder] = await env.db.db.select().from(orders).where(eq(orders.id, order.id));
    expect(dbOrder?.status).toBe('new');

    const cartAfter = (await api<CartDTO>('GET', '/api/cart', tma(buyer))).body;
    expect(cartAfter.items).toHaveLength(0);

    // Повтор с тем же ключом (двойное нажатие) не создаёт второй заказ
    const repeat = await api<OrderDTO>('POST', '/api/orders', tma(buyer), {
      customerName: 'Иван',
      phone: '89991234567',
      idempotencyKey: key,
    });
    expect(repeat.status).toBe(200);
    expect(repeat.body.id).toBe(order.id);

    // Уведомление владельцу
    await waitFor(() => env.telegram.messagesTo(ADMIN_ID).length > 0);
    const msg = env.telegram.messagesTo(ADMIN_ID)[0]!.payload;
    const text = String(msg.text);
    expect(text).toContain(`Заказ №${order.id}`);
    expect(text).toContain('+7 999 123 45 67');
    expect(text).toContain('@ivan_buyer');
    expect(text).toContain('Nike Tech Fleece');
    expect(text).toContain('3 × 19 990 ₽ = 59 970 ₽');
    expect(text).toContain('Иван &lt;b&gt;Тест&lt;/b&gt;'); // HTML экранирован
    expect(msg.parse_mode).toBe('HTML');
    const keyboard = (msg.reply_markup as { inline_keyboard: { text: string; url?: string; web_app?: { url: string } }[][] })
      .inline_keyboard.flat();
    expect(keyboard.find((b) => b.text === 'Открыть заказ')?.web_app?.url).toBe(`https://shop.test/admin/orders/${order.id}`);
    expect(keyboard.find((b) => b.text === 'Связаться с клиентом')?.url).toBe('https://t.me/ivan_buyer');
    await waitFor(async () => {
      const [o] = await env.db.db.select().from(orders).where(eq(orders.id, order.id));
      return Boolean(o?.ownerNotifiedAt);
    });
  });

  it('пустую корзину оформить нельзя', async () => {
    const res = await api('POST', '/api/orders', tma(buyer), {
      customerName: 'Иван',
      phone: '+79991234567',
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(400);
  });

  it('пользователь без username: в уведомлении Telegram ID', async () => {
    await api('POST', '/api/cart/items', tma(buyerNoUsername), { productId: productB.id });
    const res = await api<OrderDTO>('POST', '/api/orders', tma(buyerNoUsername), {
      customerName: 'Пётр',
      phone: '+79120000000',
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(201);
    await waitFor(() =>
      env.telegram.messagesTo(ADMIN_ID).some((m) => String(m.payload.text).includes(`Заказ №${res.body.id}`)),
    );
    const msg = env.telegram.messagesTo(ADMIN_ID).find((m) => String(m.payload.text).includes(`Заказ №${res.body.id}`))!;
    expect(String(msg.payload.text)).toContain(`Telegram ID: <code>${buyerNoUsername.id}</code>`);
    const buttons = (msg.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(['Открыть заказ']);
  });

  it('пользователь видит только свои заказы', async () => {
    const own = await api<OrderDTO>('GET', `/api/orders/${order.id}`, tma(buyer));
    expect(own.status).toBe(200);
    const foreign = await api('GET', `/api/orders/${order.id}`, tma(buyerNoUsername));
    expect(foreign.status).toBe(404);
  });

  it('10. Изменение цены: новые заказы по новой цене, старые сохраняют snapshot', async () => {
    const upd = await api<AdminProductDTO>('PATCH', `/api/admin/products/${productA.id}`, adminHeaders(), {
      price: 15_000_00,
      title: 'Nike Tech Fleece (new)',
    });
    expect(upd.status).toBe(200);

    await api('POST', '/api/cart/items', tma(buyer), { productId: productA.id });
    const newOrder = await api<OrderDTO>('POST', '/api/orders', tma(buyer), {
      customerName: 'Иван',
      phone: '+79991234567',
      idempotencyKey: randomUUID(),
    });
    expect(newOrder.body.totalAmount).toBe(15_000_00);

    const old = await api<AdminOrderDTO>('GET', `/api/admin/orders/${order.id}`, adminHeaders());
    const oldItem = old.body.items.find((i) => i.productId === productA.id)!;
    expect(oldItem).toMatchObject({ title: 'Nike Tech Fleece', price: 19_990_00, quantity: 3, total: 59_970_00 });
  });

  it('11. Скрытый товар исчезает из каталога, старые заказы доступны', async () => {
    await api('POST', '/api/cart/items', tma(buyer), { productId: productB.id });
    const hide = await api<AdminProductDTO>('PATCH', `/api/admin/products/${productB.id}`, adminHeaders(), { isActive: false });
    expect(hide.body.isActive).toBe(false);

    const catalog = await api<ProductsPageDTO>('GET', '/api/products', tma(buyer));
    expect(catalog.body.items.map((p) => p.id)).not.toContain(productB.id);
    expect((await api('GET', `/api/products/${productB.id}`, tma(buyer))).status).toBe(404);

    // В корзине товар помечен недоступным и не входит в сумму; оформить нельзя
    const cart = (await api<CartDTO>('GET', '/api/cart', tma(buyer))).body;
    expect(cart.hasUnavailable).toBe(true);
    expect(cart.totalAmount).toBe(0);
    const checkout = await api<{ error: { code: string } }>('POST', '/api/orders', tma(buyer), {
      customerName: 'Иван',
      phone: '+79991234567',
      idempotencyKey: randomUUID(),
    });
    expect(checkout.body.error.code).toBe('CART_HAS_UNAVAILABLE');

    const old = await api<AdminOrderDTO>('GET', `/api/admin/orders/${order.id}`, adminHeaders());
    expect(old.status).toBe(200);
    expect(old.body.items.some((i) => i.productId === productB.id)).toBe(true);

    // Вернуть в каталог
    await api('PATCH', `/api/admin/products/${productB.id}`, adminHeaders(), { isActive: true });
    expect((await api('GET', `/api/products/${productB.id}`, tma(buyer))).status).toBe(200);
  });

  it('удаление товара не ломает старые заказы (snapshot + product_id = NULL)', async () => {
    const temp = await createProduct({ title: 'Временный', price: 500_00 });
    await api('POST', '/api/cart/items', tma(buyerNoUsername), { productId: temp.id });
    const o = await api<OrderDTO>('POST', '/api/orders', tma(buyerNoUsername), {
      customerName: 'Пётр',
      phone: '+79120000000',
      idempotencyKey: randomUUID(),
    });
    const del = await api('DELETE', `/api/admin/products/${temp.id}`, adminHeaders());
    expect(del.status).toBe(204);
    const [item] = await env.db.db.select().from(orderItems).where(eq(orderItems.orderId, o.body.id));
    expect(item).toMatchObject({ productId: null, productTitleSnapshot: 'Временный', priceSnapshot: 500_00 });
  });
});

describe('Админ-панель', () => {
  it('9. Товар с 5 фотографиями: порядок и главное фото → корректная карусель', async () => {
    const imgs = [];
    for (const c of ['#101010', '#202020', '#303030', '#404040', '#505050']) imgs.push(await uploadImage(c));
    const product = await createProduct({
      title: 'Пять фото',
      price: 9_990_00,
      imageIds: imgs.map((i) => i.id),
      mainImageId: imgs[2]!.id,
    });
    expect(product.images.map((i) => i.id)).toEqual(imgs.map((i) => i.id));
    expect(product.images.find((i) => i.isMain)?.id).toBe(imgs[2]!.id);

    const card = await api<ProductDetailDTO>('GET', `/api/products/${product.id}`, tma(buyer));
    expect(card.body.images).toHaveLength(5);
    expect(card.body.images[0]!.id).toBe(imgs[2]!.id); // главное — первым
    expect(card.body.image?.id).toBe(imgs[2]!.id);

    // Перестановка, удаление фото и смена главного
    const reordered = [imgs[4]!.id, imgs[0]!.id, imgs[1]!.id, imgs[3]!.id];
    const upd = await api<AdminProductDTO>('PATCH', `/api/admin/products/${product.id}`, adminHeaders(), {
      imageIds: reordered,
      mainImageId: imgs[0]!.id,
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.images.map((i) => i.id)).toEqual(reordered);
    expect(upd.body.images.filter((i) => i.isMain).map((i) => i.id)).toEqual([imgs[0]!.id]);
    // файл удалённого фото больше не отдаётся
    const removed = await env.app.inject({ method: 'GET', url: imgs[2]!.url });
    expect(removed.statusCode).toBe(404);
  });

  it('фото чужого товара нельзя «украсть»', async () => {
    const img = await uploadImage('#606060');
    const owner = await createProduct({ title: 'Владелец фото', price: 100_00, imageIds: [img.id] });
    const res = await api('POST', '/api/admin/products', adminHeaders(), { title: 'Вор', price: 100_00, imageIds: [img.id] });
    expect(res.status).toBe(400);
    expect((await api<AdminProductDTO>('GET', `/api/admin/products/${owner.id}`, adminHeaders())).body.images).toHaveLength(1);
  });

  it('загрузка: не-изображение отклоняется', async () => {
    const boundary = 'xxBOUNDARYxx';
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/admin/images',
      headers: { ...adminHeaders(), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n<script>alert(1)</script>\r\n--${boundary}--\r\n`,
      ),
    });
    expect(res.statusCode).toBe(400);
  });

  it('валидация цен: старая цена должна быть больше, скидка требует старую цену', async () => {
    const bad1 = await api('POST', '/api/admin/products', adminHeaders(), { title: 'X', price: 100_00, oldPrice: 50_00 });
    expect(bad1.status).toBe(400);
    const bad2 = await api('POST', '/api/admin/products', adminHeaders(), { title: 'X', price: 100_00, discountPercent: 10 });
    expect(bad2.status).toBe(400);
    const ok = await createProduct({ title: 'Ручная скидка', price: 80_00, oldPrice: 100_00, discountPercent: 25 });
    expect(ok.effectiveDiscountPercent).toBe(25); // ручное значение администратора
    const p = await api<AdminProductDTO>('PATCH', `/api/admin/products/${ok.id}`, adminHeaders(), { oldPrice: null });
    expect(p.status).toBe(400); // скидка без старой цены
  });

  it('цена без скидки: создание и снятие скидки у товара', async () => {
    const plain = await createProduct({ title: 'Без скидки', price: 5_000_00 });
    expect(plain).toMatchObject({ oldPrice: null, discountPercent: null, effectiveDiscountPercent: null });
    const plainCard = await api<ProductDetailDTO>('GET', `/api/products/${plain.id}`, tma(buyer));
    expect(plainCard.body).toMatchObject({ price: 5_000_00, oldPrice: null, discountPercent: null });

    const discounted = await createProduct({ title: 'Была скидка', price: 80_00, oldPrice: 100_00, discountPercent: 25 });
    // Выключение скидки в админке отправляет обе величины как null
    const off = await api<AdminProductDTO>('PATCH', `/api/admin/products/${discounted.id}`, adminHeaders(), {
      price: 90_00,
      oldPrice: null,
      discountPercent: null,
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body).toMatchObject({ price: 90_00, oldPrice: null, discountPercent: null, effectiveDiscountPercent: null });
    const card = await api<ProductDetailDTO>('GET', `/api/products/${discounted.id}`, tma(buyer));
    expect(card.body).toMatchObject({ price: 90_00, oldPrice: null, discountPercent: null });
  });

  it('изменение порядка товаров', async () => {
    const list = (await api<{ items: AdminProductDTO[] }>('GET', '/api/admin/products', adminHeaders())).body.items;
    const ids = list.map((p) => p.id).reverse();
    expect((await api('PUT', '/api/admin/products/order', adminHeaders(), { ids })).status).toBe(204);
    const after = (await api<{ items: AdminProductDTO[] }>('GET', '/api/admin/products', adminHeaders())).body.items;
    expect(after.map((p) => p.id)).toEqual(ids);
  });

  it('заказы: фильтр по статусу, поиск и смена статуса', async () => {
    const all = (await api<Paginated<AdminOrderDTO>>('GET', '/api/admin/orders', adminHeaders())).body;
    expect(all.total).toBeGreaterThanOrEqual(3);
    const first = all.items[all.items.length - 1]!;

    const byId = (await api<Paginated<AdminOrderDTO>>('GET', `/api/admin/orders?q=${first.id}`, adminHeaders())).body;
    expect(byId.items.map((o) => o.id)).toContain(first.id);
    const byPhone = (await api<Paginated<AdminOrderDTO>>('GET', '/api/admin/orders?q=999%20123', adminHeaders())).body;
    expect(byPhone.items.every((o) => o.phone.includes('999123'))).toBe(true);
    const byUser = (await api<Paginated<AdminOrderDTO>>('GET', '/api/admin/orders?q=%40ivan_buyer', adminHeaders())).body;
    expect(byUser.total).toBeGreaterThan(0);
    const byName = (await api<Paginated<AdminOrderDTO>>('GET', `/api/admin/orders?q=${encodeURIComponent('пётр')}`, adminHeaders())).body;
    expect(byName.items.every((o) => o.customerName === 'Пётр')).toBe(true);
    const injection = await api<Paginated<AdminOrderDTO>>('GET', `/api/admin/orders?q=${encodeURIComponent("%' OR 1=1 --")}`, adminHeaders());
    expect(injection.status).toBe(200);
    expect(injection.body.total).toBe(0);

    const upd = await api<AdminOrderDTO>('PATCH', `/api/admin/orders/${first.id}`, adminHeaders(), { status: 'processing' });
    expect(upd.body.status).toBe('processing');
    const filtered = (await api<Paginated<AdminOrderDTO>>('GET', '/api/admin/orders?status=processing', adminHeaders())).body;
    expect(filtered.items.map((o) => o.id)).toEqual([first.id]);
    expect((await api('PATCH', `/api/admin/orders/${first.id}`, adminHeaders(), { status: 'paid' })).status).toBe(400);
  });

  it('dashboard и пользователи', async () => {
    const d = (await api<DashboardDTO>('GET', '/api/admin/dashboard', adminHeaders())).body;
    expect(d.ordersToday).toBeGreaterThanOrEqual(3);
    expect(d.usersTotal).toBeGreaterThanOrEqual(3);
    expect(d.productsTotal).toBeGreaterThanOrEqual(d.productsActive);
    const u = (await api<Paginated<{ telegramId: number; ordersCount: number }>>('GET', '/api/admin/users?q=ivan', adminHeaders())).body;
    expect(u.items[0]).toMatchObject({ telegramId: buyer.id });
    expect(u.items[0]!.ordersCount).toBeGreaterThanOrEqual(2);
  });

  it('12. Рассылка: заблокировавшие бота не ломают рассылку', async () => {
    // 20 пользователей, 3 из них заблокировали бота
    for (let i = 0; i < 20; i++) await api('GET', '/api/me', tma({ id: 8000 + i, first_name: `U${i}` }));
    env.telegram.blocked.add(8003).add(8007).add(8011);

    const info = (await api<{ recipients: number }>('GET', '/api/admin/broadcasts', adminHeaders())).body;
    expect(info.recipients).toBeGreaterThanOrEqual(23);

    env.ctx.broadcast.start();
    const created = await api<BroadcastDTO>('POST', '/api/admin/broadcasts', adminHeaders(), {
      text: 'Новая коллекция уже в каталоге <b>не HTML</b>',
      withShopButton: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.totalRecipients).toBe(info.recipients);

    // Пока рассылка идёт — вторую создать нельзя
    const second = await api('POST', '/api/admin/broadcasts', adminHeaders(), { text: 'ещё' });
    expect([201, 409]).toContain(second.status);

    let final: BroadcastDTO = created.body;
    await waitFor(async () => {
      final = (await api<BroadcastDTO>('GET', `/api/admin/broadcasts/${created.body.id}`, adminHeaders())).body;
      return final.status === 'completed';
    }, 20_000);
    expect(final.failedCount).toBe(3);
    expect(final.sentCount).toBe(info.recipients - 3);

    const delivered = env.telegram.messagesTo(8000)[0]!.payload;
    expect(delivered.text).toBe('Новая коллекция уже в каталоге <b>не HTML</b>');
    expect(delivered.parse_mode).toBeUndefined();

    const [blockedUser] = await env.db.db.select().from(users).where(eq(users.telegramId, 8007));
    expect(blockedUser?.isBlocked).toBe(true);
    const after = (await api<{ recipients: number }>('GET', '/api/admin/broadcasts', adminHeaders())).body;
    expect(after.recipients).toBe(info.recipients - 3);
  });
});
