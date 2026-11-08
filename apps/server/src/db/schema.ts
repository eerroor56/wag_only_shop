/**
 * Схема БД WAG Shop.
 *
 * Соглашения:
 *  - деньги хранятся в копейках (integer);
 *  - все даты — timestamptz;
 *  - новые характеристики товара (бренд, размер, категория, артикул, наличие) добавляются
 *    отдельными nullable-колонками / таблицами через обычную миграцию drizzle-kit — существующие
 *    данные и API при этом не ломаются. Свободные характеристики уже доступны через `attributes`.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { BROADCAST_STATUSES, ORDER_STATUSES, type ProductAttribute } from '@wag/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const broadcastStatusEnum = pgEnum('broadcast_status', BROADCAST_STATUSES);
export const deliveryStatusEnum = pgEnum('delivery_status', ['pending', 'sent', 'failed']);

// ---------------------------------------------------------------- users

export const users = pgTable(
  'users',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    username: varchar('username', { length: 64 }),
    firstName: varchar('first_name', { length: 128 }).notNull().default(''),
    lastName: varchar('last_name', { length: 128 }),
    /** Пользователь заблокировал бота / удалил аккаунт — рассылка его пропускает. */
    isBlocked: boolean('is_blocked').notNull().default(false),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('users_created_at_idx').on(t.createdAt)],
);

// ---------------------------------------------------------------- categories

/** Группы товаров (Кроссовки, Худи…). Название уникально без учёта регистра. */
export const categories = pgTable(
  'categories',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    name: varchar('name', { length: 40 }).notNull(),
    /**
     * Ключ уникальности: название в нижнем регистре (categoryNameKey). Считается в приложении —
     * lower() в Postgres зависит от локали кластера и в локали C не понижает кириллицу.
     */
    nameKey: varchar('name_key', { length: 40 }).notNull().unique('categories_name_key_uq'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
);

// ---------------------------------------------------------------- products

export const products = pgTable(
  'products',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    /** Финальная цена продажи, копейки. Задаётся администратором. */
    price: integer('price').notNull(),
    /** Старая (зачёркнутая) цена, копейки. */
    oldPrice: integer('old_price'),
    /** Процент скидки, указанный вручную. null — вычисляется из old_price/price при отображении. */
    discountPercent: smallint('discount_percent'),
    /** Дополнительные характеристики [{name, value}]. */
    attributes: jsonb('attributes').$type<ProductAttribute[]>().notNull().default([]),
    /** Доступные размеры в порядке отображения (M, 48, 48-52, 52/54…). Пусто — товар без размера. */
    sizes: text('sizes').array().notNull().default(sql`'{}'::text[]`),
    /**
     * Остатки по размерам: { "M": 3, "L": 0 }; у товара без размеров — { "": 5 }.
     * null — остатки не учитываются (товар всегда в наличии).
     */
    stock: jsonb('stock').$type<Record<string, number>>(),
    /** Сумма остатков (для сортировки и фильтра «в наличии»); null — не учитываются. Пересчитывается вместе со stock. */
    stockTotal: integer('stock_total'),
    /**
     * Ключ сортировки и поиска по названию: нижний регистр, ё → е. Кириллица переводится явно через translate —
     * lower() зависит от локали кластера и в локали C её не понижает.
     */
    titleSort: text('title_sort').generatedAlwaysAs(
      sql`lower(translate(title, 'ЁёАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'ееабвгдежзийклмнопрстуфхцчшщъыьэюя'))`,
    ),
    /** Категория; при удалении категории товары остаются без неё. */
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('products_catalog_idx').on(t.isActive, t.sortOrder, t.id),
    index('products_category_idx').on(t.categoryId, t.isActive, t.sortOrder),
    check('products_price_check', sql`${t.price} >= 0`),
    check('products_stock_total_check', sql`${t.stockTotal} IS NULL OR ${t.stockTotal} >= 0`),
    check('products_old_price_check', sql`${t.oldPrice} IS NULL OR ${t.oldPrice} > ${t.price}`),
    check(
      'products_discount_check',
      sql`${t.discountPercent} IS NULL OR (${t.discountPercent} BETWEEN 1 AND 99 AND ${t.oldPrice} IS NOT NULL)`,
    ),
  ],
);

/**
 * Фото товара. product_id = NULL — фото загружено в админке, но товар ещё не сохранён
 * (такие записи периодически удаляются вместе с файлами).
 */
export const productImages = pgTable(
  'product_images',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
    /** Ключ полноразмерного изображения в хранилище. */
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    /** Ключ превью для каталога/корзины. */
    thumbKey: varchar('thumb_key', { length: 255 }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isMain: boolean('is_main').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('product_images_product_idx').on(t.productId, t.sortOrder),
    uniqueIndex('product_images_one_main_idx').on(t.productId).where(sql`${t.isMain}`),
    index('product_images_orphan_idx').on(t.createdAt).where(sql`${t.productId} IS NULL`),
  ],
);

// ---------------------------------------------------------------- cart

export const carts = pgTable('carts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const cartItems = pgTable(
  'cart_items',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    cartId: integer('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Выбранный размер; '' — товар без размера. */
    size: varchar('size', { length: 20 }).notNull().default(''),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('cart_items_cart_product_size_uq').on(t.cartId, t.productId, t.size),
    check('cart_items_quantity_check', sql`${t.quantity} BETWEEN 1 AND 99`),
  ],
);

// ---------------------------------------------------------------- orders

export const orders = pgTable(
  'orders',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity({ startWith: 1001 }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    customerName: varchar('customer_name', { length: 100 }).notNull(),
    /** E.164, например +79991234567. */
    phone: varchar('phone', { length: 32 }).notNull(),
    /** Username на момент заказа (username в Telegram может меняться). */
    telegramUsername: varchar('telegram_username', { length: 64 }),
    totalAmount: integer('total_amount').notNull(),
    itemsCount: integer('items_count').notNull(),
    status: orderStatusEnum('status').notNull().default('new'),
    idempotencyKey: uuid('idempotency_key'),
    ownerNotifiedAt: timestamp('owner_notified_at', { withTimezone: true }),
    notifyAttempts: smallint('notify_attempts').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('orders_user_idempotency_uq').on(t.userId, t.idempotencyKey),
    index('orders_created_at_idx').on(t.createdAt),
    index('orders_status_idx').on(t.status, t.createdAt),
    index('orders_user_idx').on(t.userId, t.createdAt),
    index('orders_unnotified_idx').on(t.createdAt).where(sql`${t.ownerNotifiedAt} IS NULL`),
    check('orders_total_check', sql`${t.totalAmount} >= 0`),
  ],
);

/** Позиции заказа хранят snapshot названия и цены: изменение/удаление товара не меняет старые заказы. */
export const orderItems = pgTable(
  'order_items',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    productTitleSnapshot: varchar('product_title_snapshot', { length: 200 }).notNull(),
    priceSnapshot: integer('price_snapshot').notNull(),
    /** Размер на момент заказа. */
    sizeSnapshot: varchar('size_snapshot', { length: 20 }),
    quantity: integer('quantity').notNull(),
    total: integer('total').notNull(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.productId),
    check('order_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);

// ---------------------------------------------------------------- broadcasts

export const broadcasts = pgTable('broadcasts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  text: text('text').notNull(),
  withShopButton: boolean('with_shop_button').notNull().default(true),
  status: broadcastStatusEnum('status').notNull().default('pending'),
  totalRecipients: integer('total_recipients').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  createdByTelegramId: bigint('created_by_telegram_id', { mode: 'number' }).notNull(),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/** Очередь доставки рассылки: переживает перезапуск сервера. */
export const broadcastRecipients = pgTable(
  'broadcast_recipients',
  {
    broadcastId: integer('broadcast_id')
      .notNull()
      .references(() => broadcasts.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    error: varchar('error', { length: 255 }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.broadcastId, t.userId] }),
    index('broadcast_recipients_pending_idx').on(t.broadcastId, t.status),
  ],
);

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;
