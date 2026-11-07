import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { AdminUserDTO, Paginated } from '@wag/shared';
import type { Database } from '../../db/client.js';
import { orders, users, type User } from '../../db/schema.js';
import { escapeLike } from '../../lib/format.js';

export interface TelegramProfile {
  id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export class UsersService {
  /** Кэш: telegramId → (id в БД, время последнего обновления). Избавляет от записи в БД на каждый запрос. */
  private readonly touched = new Map<number, { userId: number; at: number; fingerprint: string }>();

  constructor(private readonly db: Database) {}

  /**
   * Создаёт пользователя при первом обращении и обновляет профиль / last_seen_at.
   * Telegram ID берётся только из проверенной initData или update бота — никогда из тела запроса.
   */
  async upsertFromTelegram(profile: TelegramProfile, opts: { unblock?: boolean } = {}): Promise<number> {
    const username = profile.username?.slice(0, 64) || null;
    const firstName = (profile.first_name ?? '').slice(0, 128);
    const lastName = profile.last_name?.slice(0, 128) || null;
    const fingerprint = `${username}|${firstName}|${lastName}`;

    const cached = this.touched.get(profile.id);
    const now = Date.now();
    if (!opts.unblock && cached && cached.fingerprint === fingerprint && now - cached.at < TOUCH_INTERVAL_MS) {
      return cached.userId;
    }

    const [row] = await this.db
      .insert(users)
      .values({ telegramId: profile.id, username, firstName, lastName })
      .onConflictDoUpdate({
        target: users.telegramId,
        set: {
          username,
          firstName,
          lastName,
          lastSeenAt: sql`now()`,
          ...(opts.unblock ? { isBlocked: false, blockedAt: null } : {}),
        },
      })
      .returning({ id: users.id });

    const userId = row!.id;
    if (this.touched.size > 50_000) this.touched.clear();
    this.touched.set(profile.id, { userId, at: now, fingerprint });
    return userId;
  }

  async setBlocked(telegramId: number, blocked: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ isBlocked: blocked, blockedAt: blocked ? new Date() : null })
      .where(eq(users.telegramId, telegramId));
  }

  async getById(id: number): Promise<User | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  async list(params: { q?: string; limit: number; offset: number }): Promise<Paginated<AdminUserDTO>> {
    const conditions: SQL[] = [];
    const q = params.q?.replace(/^@/, '').trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      const byText = or(ilike(users.username, like), ilike(users.firstName, like), ilike(users.lastName, like))!;
      conditions.push(/^\d+$/.test(q) ? or(byText, eq(users.telegramId, Number(q)))! : byText);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const ordersCount = this.db
      .select({ userId: orders.userId, n: count().as('n') })
      .from(orders)
      .groupBy(orders.userId)
      .as('oc');

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ user: users, ordersCount: sql<number>`coalesce(${ordersCount.n}, 0)::int` })
        .from(users)
        .leftJoin(ordersCount, eq(ordersCount.userId, users.id))
        .where(where)
        .orderBy(desc(users.lastSeenAt), desc(users.id))
        .limit(params.limit)
        .offset(params.offset),
      this.db.select({ n: count() }).from(users).where(where),
    ]);

    return {
      items: rows.map(({ user, ordersCount }) => ({
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isBlocked: user.isBlocked,
        ordersCount,
        createdAt: user.createdAt.toISOString(),
        lastSeenAt: user.lastSeenAt.toISOString(),
      })),
      total: totalRow?.n ?? 0,
      limit: params.limit,
      offset: params.offset,
    };
  }
}
