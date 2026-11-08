import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  normalizePhone,
  type AdminOrderDTO,
  type CheckoutInput,
  type OrderDTO,
  type OrderItemDTO,
  type OrderStatus,
  type Paginated,
} from '@wag/shared';
import type { Database } from '../../db/client.js';
import { cartItems, carts, orderItems, orders, products, users, type Order, type OrderItem, type User } from '../../db/schema.js';
import { AppError, badRequest, conflict, notFound, validationError } from '../../lib/errors.js';
import { escapeLike } from '../../lib/format.js';
import { maxQuantityFor, NO_SIZE, resolveSize, unavailableReason } from '../cart/size-availability.js';
import { applyStockChanges, describeShortages } from '../products/stock.js';

export interface CreateOrderResult {
  order: OrderDTO;
  /** false — повторный запрос с тем же idempotencyKey, заказ уже существовал. */
  created: boolean;
}

function toItemDTO(i: OrderItem): OrderItemDTO {
  return {
    id: i.id,
    productId: i.productId,
    title: i.productTitleSnapshot,
    size: i.sizeSnapshot,
    price: i.priceSnapshot,
    quantity: i.quantity,
    total: i.total,
  };
}

function toOrderDTO(o: Order, items: OrderItem[]): OrderDTO {
  return {
    id: o.id,
    status: o.status,
    customerName: o.customerName,
    phone: o.phone,
    totalAmount: o.totalAmount,
    itemsCount: o.itemsCount,
    createdAt: o.createdAt.toISOString(),
    items: items.map(toItemDTO),
  };
}

function toAdminOrderDTO(o: Order, items: OrderItem[], u: User): AdminOrderDTO {
  return {
    ...toOrderDTO(o, items),
    updatedAt: o.updatedAt.toISOString(),
    telegramUsername: o.telegramUsername,
    user: { id: u.id, telegramId: u.telegramId, username: u.username, firstName: u.firstName, lastName: u.lastName },
  };
}

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
};

export class OrdersService {
  constructor(private readonly db: Database) {}

  private async itemsFor(orderIds: number[]): Promise<Map<number, OrderItem[]>> {
    const map = new Map<number, OrderItem[]>();
    if (!orderIds.length) return map;
    const rows = await this.db
      .select()
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds))
      .orderBy(asc(orderItems.id));
    for (const r of rows) {
      const list = map.get(r.orderId) ?? [];
      list.push(r);
      map.set(r.orderId, list);
    }
    return map;
  }

  /**
   * Оформление заказа. Состав и цены берутся ТОЛЬКО из корзины пользователя в БД;
   * итоговая сумма считается сервером. Корзина очищается в той же транзакции.
   */
  async createFromCart(userId: number, input: CheckoutInput, telegramUsername: string | null): Promise<CreateOrderResult> {
    const phone = normalizePhone(input.phone);
    if (!phone) throw validationError([{ path: 'phone', message: 'Некорректный номер телефона' }]);

    const existing = await this.findByIdempotencyKey(userId, input.idempotencyKey);
    if (existing) return { order: existing, created: false };

    try {
      const orderId = await this.db.transaction(async (tx) => {
        // Блокируем корзину: параллельные запросы оформления выполняются строго по очереди.
        const [cart] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId)).for('update');
        if (!cart) throw badRequest('Корзина пуста');

        const rows = await tx
          .select({ item: cartItems, product: products })
          .from(cartItems)
          .innerJoin(products, eq(products.id, cartItems.productId))
          .where(eq(cartItems.cartId, cart.id))
          .orderBy(asc(cartItems.createdAt), asc(cartItems.id));

        if (!rows.length) throw new AppError(400, 'CART_EMPTY', 'Корзина пуста');
        const unavailable = rows
          .map((r) => ({ ...r, reason: unavailableReason(r.product, r.item.size, r.item.quantity) }))
          .filter((r) => r.reason !== null);
        if (unavailable.length) {
          const names = unavailable.map(({ item, product, reason }) => {
            const name = item.size ? `${product.title} (${item.size})` : product.title;
            if (reason === 'soldout') return `${name} — закончился`;
            if (reason === 'stock') return `${name} — осталось ${maxQuantityFor(product, item.size)} шт.`;
            return name;
          });
          throw conflict(
            'CART_HAS_UNAVAILABLE',
            `Некоторые позиции недоступны: ${names.join(', ')}. Обновите корзину.`,
          );
        }

        const lines = rows.map(({ item, product }) => ({
          productId: product.id,
          productTitleSnapshot: product.title,
          sizeSnapshot: item.size === NO_SIZE ? null : resolveSize(product, item.size),
          priceSnapshot: product.price,
          quantity: item.quantity,
          total: product.price * item.quantity,
        }));
        const totalAmount = lines.reduce((s, l) => s + l.total, 0);
        const itemsCount = lines.reduce((s, l) => s + l.quantity, 0);

        if (input.expectedTotal !== undefined && input.expectedTotal !== totalAmount) {
          throw conflict('PRICE_CHANGED', 'Цены в корзине изменились. Проверьте сумму и оформите заказ ещё раз.');
        }

        const [order] = await tx
          .insert(orders)
          .values({
            userId,
            customerName: input.customerName,
            phone,
            telegramUsername,
            totalAmount,
            itemsCount,
            idempotencyKey: input.idempotencyKey,
          })
          .returning({ id: orders.id });

        // Списание остатков под блокировкой товаров: параллельные заказы не уведут остаток в минус.
        const shortages = await applyStockChanges(
          tx,
          lines.map((l) => ({ productId: l.productId, size: l.sizeSnapshot, delta: -l.quantity })),
        );
        if (shortages.length) {
          throw conflict('OUT_OF_STOCK', `Товара не хватает: ${describeShortages(shortages)}. Обновите корзину.`);
        }

        await tx.insert(orderItems).values(lines.map((l) => ({ ...l, orderId: order!.id })));
        await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
        return order!.id;
      });

      return { order: (await this.getForUser(userId, orderId))!, created: true };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const order = await this.findByIdempotencyKey(userId, input.idempotencyKey);
        if (order) return { order, created: false };
      }
      throw err;
    }
  }

  private async findByIdempotencyKey(userId: number, key: string): Promise<OrderDTO | null> {
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, key)));
    return row ? this.getForUser(userId, row.id) : null;
  }

  async getForUser(userId: number, orderId: number): Promise<OrderDTO | null> {
    const [order] = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    if (!order) return null;
    const items = (await this.itemsFor([order.id])).get(order.id) ?? [];
    return toOrderDTO(order, items);
  }

  async listForUser(userId: number): Promise<OrderDTO[]> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(50);
    const items = await this.itemsFor(rows.map((o) => o.id));
    return rows.map((o) => toOrderDTO(o, items.get(o.id) ?? []));
  }

  // ------------------------------------------------------------------ admin

  async adminList(params: {
    status?: OrderStatus;
    q?: string;
    limit: number;
    offset: number;
  }): Promise<Paginated<AdminOrderDTO>> {
    const conditions: SQL[] = [];
    if (params.status) conditions.push(eq(orders.status, params.status));

    const q = params.q?.trim();
    if (q) {
      const or_: SQL[] = [];
      const numeric = q.replace(/^[#№]/, '');
      if (/^\d{1,9}$/.test(numeric)) or_.push(eq(orders.id, Number(numeric)));
      const digits = q.replace(/\D/g, '');
      if (digits.length >= 3) or_.push(sql`${orders.phone} LIKE ${`%${digits}%`}`);
      const text = `%${escapeLike(q.replace(/^@/, ''))}%`;
      or_.push(ilike(orders.customerName, text), ilike(orders.telegramUsername, text), ilike(users.username, text));
      conditions.push(or(...or_)!);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ order: orders, user: users })
        .from(orders)
        .innerJoin(users, eq(users.id, orders.userId))
        .where(where)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(params.limit)
        .offset(params.offset),
      this.db.select({ n: count() }).from(orders).innerJoin(users, eq(users.id, orders.userId)).where(where),
    ]);
    const items = await this.itemsFor(rows.map((r) => r.order.id));
    return {
      items: rows.map((r) => toAdminOrderDTO(r.order, items.get(r.order.id) ?? [], r.user)),
      total: totalRow?.n ?? 0,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async adminGet(id: number): Promise<AdminOrderDTO> {
    const [row] = await this.db
      .select({ order: orders, user: users })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(orders.id, id));
    if (!row) throw notFound('Заказ не найден');
    const items = (await this.itemsFor([id])).get(id) ?? [];
    return toAdminOrderDTO(row.order, items, row.user);
  }

  /**
   * Смена статуса. Отмена возвращает товары на склад; восстановление отменённого заказа
   * списывает их снова (409, если товара уже не хватает).
   */
  async updateStatus(id: number, status: OrderStatus): Promise<AdminOrderDTO> {
    await this.db.transaction(async (tx) => {
      const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, id)).for('update');
      if (!order) throw notFound('Заказ не найден');
      const wasCancelled = order.status === 'cancelled';
      const willBeCancelled = status === 'cancelled';
      if (wasCancelled !== willBeCancelled) {
        const items = await tx
          .select({ productId: orderItems.productId, size: orderItems.sizeSnapshot, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, id));
        const sign = willBeCancelled ? 1 : -1;
        const shortages = await applyStockChanges(
          tx,
          items.map((i) => ({ productId: i.productId, size: i.size, delta: sign * i.quantity })),
        );
        if (shortages.length) {
          throw conflict('OUT_OF_STOCK', `Нельзя восстановить заказ — не хватает товара: ${describeShortages(shortages)}`);
        }
      }
      await tx.update(orders).set({ status }).where(eq(orders.id, id));
    });
    return this.adminGet(id);
  }
}
