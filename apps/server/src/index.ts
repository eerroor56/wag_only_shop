import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createStorage } from './storage/index.js';

async function main() {
  const config = loadConfig();
  const dbHandle = createDb(config.databaseUrl);
  const storage = await createStorage(config.storage);
  const { app, ctx } = await buildApp(config, { db: dbHandle.db, storage });

  if (process.env.MIGRATE_ON_START === 'true') {
    await runMigrations(dbHandle.db);
    app.log.info('Миграции применены');
  }

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Mini App: ${config.miniAppUrl}  ·  Админка: ${config.adminUrl}`);
  if (config.adminTelegramIds.size === 0) {
    app.log.warn('ADMIN_TELEGRAM_IDS не задан: админ-панель недоступна, уведомления о заказах не отправляются');
  }

  await ctx.bot.start();
  ctx.broadcast.start();

  const timers = [
    setInterval(() => {
      ctx.notifier.retryPending().catch((err: unknown) => app.log.error({ err }, 'Ошибка повтора уведомлений'));
    }, 60_000),
    setInterval(() => {
      ctx.products
        .cleanupOrphanImages()
        .then((n) => n && app.log.info({ removed: n }, 'Удалены неиспользуемые загрузки'))
        .catch((err: unknown) => app.log.error({ err }, 'Ошибка очистки загрузок'));
    }, 60 * 60_000),
  ];

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'Остановка сервера…');
    timers.forEach(clearInterval);
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    try {
      await ctx.bot.stop();
      await ctx.broadcast.stop();
      await app.close();
      await dbHandle.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Ошибка при остановке');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
