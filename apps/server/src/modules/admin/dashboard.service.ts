import { sql } from 'drizzle-orm';
import type { DashboardDTO } from '@wag/shared';
import type { Database } from '../../db/client.js';
import { orders, products, users } from '../../db/schema.js';

export class DashboardService {
  constructor(
    private readonly db: Database,
    private readonly timezone: string,
  ) {}

  async get(): Promise<DashboardDTO> {
    // «Сегодня» считается в часовом поясе магазина, а не сервера.
    const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${this.timezone}) AT TIME ZONE ${this.timezone})`;
    const result = await this.db.execute<{
      products_total: number;
      products_active: number;
      orders_new: number;
      users_total: number;
      orders_today: number;
      revenue_today: number;
    }>(sql`
      SELECT
        (SELECT count(*)::int FROM ${products}) AS products_total,
        (SELECT count(*)::int FROM ${products} WHERE ${products.isActive}) AS products_active,
        (SELECT count(*)::int FROM ${orders} WHERE ${orders.status} = 'new') AS orders_new,
        (SELECT count(*)::int FROM ${users}) AS users_total,
        (SELECT count(*)::int FROM ${orders} WHERE ${orders.createdAt} >= ${todayStart}) AS orders_today,
        (SELECT coalesce(sum(${orders.totalAmount}), 0)::bigint FROM ${orders}
          WHERE ${orders.createdAt} >= ${todayStart} AND ${orders.status} <> 'cancelled') AS revenue_today
    `);
    const r = result.rows[0]!;
    return {
      productsTotal: r.products_total,
      productsActive: r.products_active,
      ordersNew: r.orders_new,
      usersTotal: r.users_total,
      ordersToday: r.orders_today,
      revenueToday: Number(r.revenue_today),
      timezone: this.timezone,
    };
  }
}
