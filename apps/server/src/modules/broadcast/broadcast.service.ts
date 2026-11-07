import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { GrammyError, InlineKeyboard, type Api } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { BroadcastCreateInput, BroadcastDTO } from '@wag/shared';
import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/client.js';
import { broadcastRecipients, broadcasts, users, type Broadcast } from '../../db/schema.js';
import { isUnreachableUserError } from '../../bot/bot.js';
import { conflict, notFound } from '../../lib/errors.js';
import { sleep } from '../../lib/format.js';

const BATCH_SIZE = 100;
/** Ключ advisory-lock: гарантирует, что рассылку обрабатывает только один процесс. */
const WORKER_LOCK_KEY = 0x5a6_b0a;

function toDTO(b: Broadcast): BroadcastDTO {
  return {
    id: b.id,
    text: b.text,
    withShopButton: b.withShopButton,
    status: b.status,
    totalRecipients: b.totalRecipients,
    sentCount: b.sentCount,
    failedCount: b.failedCount,
    createdAt: b.createdAt.toISOString(),
    startedAt: b.startedAt?.toISOString() ?? null,
    finishedAt: b.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Массовая рассылка.
 *  - При создании формируется snapshot получателей в broadcast_recipients (очередь в PostgreSQL —
 *    не нужен Redis, отправка продолжается после перезапуска сервера).
 *  - Воркер отправляет сообщения с ограничением скорости (по умолчанию 25 сообщений/с при лимите Telegram ~30/с),
 *    ответы 429 обрабатываются автоматически (retry_after).
 *  - Пользователи, заблокировавшие бота / удалившие аккаунт, помечаются is_blocked и не ломают рассылку.
 */
export class BroadcastService {
  private running = false;
  private stopRequested = false;
  private wakeUp: (() => void) | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    private readonly api: Api,
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  async recipientsCount(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users).where(eq(users.isBlocked, false));
    return row?.n ?? 0;
  }

  async list(): Promise<BroadcastDTO[]> {
    const rows = await this.db.select().from(broadcasts).orderBy(desc(broadcasts.id)).limit(20);
    return rows.map(toDTO);
  }

  async get(id: number): Promise<BroadcastDTO> {
    const [row] = await this.db.select().from(broadcasts).where(eq(broadcasts.id, id));
    if (!row) throw notFound('Рассылка не найдена');
    return toDTO(row);
  }

  async create(input: BroadcastCreateInput, createdByTelegramId: number): Promise<BroadcastDTO> {
    const id = await this.db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: broadcasts.id })
        .from(broadcasts)
        .where(inArray(broadcasts.status, ['pending', 'running']));
      if (active) throw conflict('BROADCAST_IN_PROGRESS', 'Предыдущая рассылка ещё отправляется. Дождитесь её завершения.');

      const [b] = await tx
        .insert(broadcasts)
        .values({ text: input.text, withShopButton: input.withShopButton, createdByTelegramId })
        .returning({ id: broadcasts.id });
      const inserted = await tx.execute(sql`
        INSERT INTO ${broadcastRecipients} (broadcast_id, user_id)
        SELECT ${b!.id}, ${users.id} FROM ${users} WHERE ${users.isBlocked} = false
      `);
      await tx
        .update(broadcasts)
        .set({ totalRecipients: inserted.rowCount ?? 0 })
        .where(eq(broadcasts.id, b!.id));
      return b!.id;
    });
    this.kick();
    return this.get(id);
  }

  async cancel(id: number): Promise<BroadcastDTO> {
    const updated = await this.db
      .update(broadcasts)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(broadcasts.id, id), inArray(broadcasts.status, ['pending', 'running'])))
      .returning({ id: broadcasts.id });
    if (!updated.length) await this.get(id); // 404, если не существует
    return this.get(id);
  }

  /** Тестовая отправка администратору — посмотреть, как сообщение выглядит в Telegram. */
  async sendTest(input: BroadcastCreateInput, telegramId: number): Promise<void> {
    await this.deliver(telegramId, input.text, input.withShopButton);
  }

  private deliver(chatId: number, text: string, withShopButton: boolean) {
    return this.api.sendMessage(chatId, text, {
      link_preview_options: { is_disabled: true },
      ...(withShopButton
        ? { reply_markup: new InlineKeyboard().webApp('Открыть магазин', this.config.miniAppUrl) }
        : {}),
    });
  }

  // ------------------------------------------------------------------ worker

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.wakeUp?.();
    await this.loopPromise;
    this.running = false;
  }

  /** Разбудить воркер сразу после создания рассылки. */
  kick(): void {
    this.wakeUp?.();
  }

  private async idle(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.wakeUp = null;
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        const worked = await this.withWorkerLock(() => this.processNext());
        if (!worked) await this.idle(5_000);
      } catch (err) {
        this.log.error({ err }, 'Ошибка воркера рассылки');
        await this.idle(10_000);
      }
    }
  }

  /** Выполняет fn, только если удалось взять session-level advisory lock (один воркер на кластер). */
  private async withWorkerLock(fn: () => Promise<boolean>): Promise<boolean> {
    const client = await this.db.$client.connect();
    try {
      const res = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [WORKER_LOCK_KEY]);
      if (!res.rows[0]?.locked) return false;
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  }

  /** Обрабатывает одну пачку получателей активной рассылки. true — была работа. */
  private async processNext(): Promise<boolean> {
    const [b] = await this.db
      .select()
      .from(broadcasts)
      .where(inArray(broadcasts.status, ['pending', 'running']))
      .orderBy(asc(broadcasts.id))
      .limit(1);
    if (!b) return false;

    if (b.status === 'pending') {
      await this.db.update(broadcasts).set({ status: 'running', startedAt: new Date() }).where(eq(broadcasts.id, b.id));
      this.log.info({ broadcastId: b.id, total: b.totalRecipients }, 'Рассылка запущена');
    }

    const batch = await this.db
      .select({ userId: broadcastRecipients.userId, telegramId: users.telegramId })
      .from(broadcastRecipients)
      .innerJoin(users, eq(users.id, broadcastRecipients.userId))
      .where(and(eq(broadcastRecipients.broadcastId, b.id), eq(broadcastRecipients.status, 'pending')))
      .orderBy(asc(broadcastRecipients.userId))
      .limit(BATCH_SIZE);

    if (!batch.length) {
      await this.db
        .update(broadcasts)
        .set({ status: 'completed', finishedAt: new Date() })
        .where(and(eq(broadcasts.id, b.id), eq(broadcasts.status, 'running')));
      this.log.info({ broadcastId: b.id }, 'Рассылка завершена');
      return true;
    }

    const interval = 1000 / this.config.broadcastRatePerSecond;
    for (const [index, r] of batch.entries()) {
      if (this.stopRequested) return true;
      // Остановку из админки проверяем каждые 20 сообщений (~1 с), а не только между пачками.
      if (index > 0 && index % 20 === 0 && (await this.isCancelled(b.id))) return true;
      const started = Date.now();
      let status: 'sent' | 'failed' = 'sent';
      let error: string | null = null;
      try {
        await this.deliver(r.telegramId, b.text, b.withShopButton);
      } catch (err) {
        status = 'failed';
        error = (err instanceof GrammyError ? `${err.error_code}: ${err.description}` : String(err)).slice(0, 255);
        if (isUnreachableUserError(err)) {
          await this.db
            .update(users)
            .set({ isBlocked: true, blockedAt: new Date() })
            .where(eq(users.id, r.userId));
        }
      }

      // Статус получателя и счётчик обновляются атомарно: перезапуск не приведёт к двойному учёту.
      await this.db.transaction(async (tx) => {
        const changed = await tx
          .update(broadcastRecipients)
          .set({ status, error, processedAt: new Date() })
          .where(
            and(
              eq(broadcastRecipients.broadcastId, b.id),
              eq(broadcastRecipients.userId, r.userId),
              eq(broadcastRecipients.status, 'pending'),
            ),
          )
          .returning({ userId: broadcastRecipients.userId });
        if (changed.length) {
          await tx
            .update(broadcasts)
            .set(
              status === 'sent'
                ? { sentCount: sql`${broadcasts.sentCount} + 1` }
                : { failedCount: sql`${broadcasts.failedCount} + 1` },
            )
            .where(eq(broadcasts.id, b.id));
        }
      });

      const wait = interval - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }

    if (await this.isCancelled(b.id)) this.log.info({ broadcastId: b.id }, 'Рассылка остановлена администратором');
    return true;
  }

  private async isCancelled(id: number): Promise<boolean> {
    const [row] = await this.db.select({ status: broadcasts.status }).from(broadcasts).where(eq(broadcasts.id, id));
    return row?.status === 'cancelled';
  }
}
