import { and, asc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { InlineKeyboard, type Api } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { orderItems, orders, users } from '../../db/schema.js';
import { newOrderMessage } from '../../bot/texts.js';

const MAX_ATTEMPTS = 5;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Уведомляет администраторов о новых заказах.
 * Если Telegram недоступен, заказ остаётся с owner_notified_at = NULL и уведомление
 * повторяется фоновой задачей (до MAX_ATTEMPTS раз в течение суток).
 */
export class OrderNotifier {
  private readonly inFlight = new Set<number>();

  constructor(
    private readonly db: Database,
    private readonly api: Api,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  async notify(orderId: number): Promise<boolean> {
    if (this.inFlight.has(orderId)) return false;
    this.inFlight.add(orderId);
    try {
      return await this.send(orderId);
    } finally {
      this.inFlight.delete(orderId);
    }
  }

  private async send(orderId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ order: orders, user: users })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(orders.id, orderId));
    if (!row || row.order.ownerNotifiedAt) return true;

    const adminIds = [...this.config.adminTelegramIds];
    if (!adminIds.length) {
      this.log.warn({ orderId }, 'ADMIN_TELEGRAM_IDS не задан — уведомление о заказе некому отправить');
      return false;
    }

    const items = await this.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.id));

    const { order, user } = row;
    const username = order.telegramUsername ?? user.username;
    const text = newOrderMessage(
      {
        id: order.id,
        customerName: order.customerName,
        phone: order.phone,
        telegramId: user.telegramId,
        telegramUsername: username,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        items: items.map((i) => ({
          title: i.productTitleSnapshot,
          size: i.sizeSnapshot,
          price: i.priceSnapshot,
          quantity: i.quantity,
          total: i.total,
        })),
      },
      this.config.shop.timezone,
    );

    const keyboard = new InlineKeyboard().webApp('Открыть заказ', `${this.config.adminUrl}orders/${order.id}`);
    if (username) keyboard.url('Связаться с клиентом', `https://t.me/${encodeURIComponent(username)}`);

    let delivered = 0;
    for (const chatId of adminIds) {
      try {
        await this.api.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
        delivered++;
      } catch (err) {
        this.log.error({ err: String(err), chatId, orderId }, 'Не удалось отправить уведомление о заказе администратору');
      }
    }

    await this.db
      .update(orders)
      .set({
        notifyAttempts: sql`${orders.notifyAttempts} + 1`,
        ...(delivered > 0 ? { ownerNotifiedAt: new Date() } : {}),
      })
      .where(eq(orders.id, orderId));
    return delivered > 0;
  }

  /** Повторная отправка уведомлений, которые не удалось доставить. */
  async retryPending(): Promise<void> {
    if (this.config.adminTelegramIds.size === 0) return;
    const pending = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          isNull(orders.ownerNotifiedAt),
          lt(orders.notifyAttempts, MAX_ATTEMPTS),
          gt(orders.createdAt, new Date(Date.now() - RETRY_WINDOW_MS)),
          // не мешаем первой попытке, которая идёт сразу после оформления
          lt(orders.createdAt, new Date(Date.now() - 30_000)),
        ),
      )
      .orderBy(asc(orders.id))
      .limit(20);
    for (const { id } of pending) await this.notify(id);
  }
}
