import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}

const handle = createDb(url);
try {
  await runMigrations(handle.db);
  console.log('✓ Миграции применены');
} catch (err) {
  console.error('✗ Ошибка миграции:', err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
