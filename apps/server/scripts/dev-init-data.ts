/**
 * Локальная разработка без Telegram: генерирует ПОДПИСАННУЮ initData (тем же алгоритмом, что Telegram)
 * и записывает её в .env.development.local фронтендов. Backend проверяет её обычным способом —
 * никаких «обходов» авторизации в коде нет.
 *
 *   npm run dev:init-data
 *       Mini App  → тестовый покупатель (Telegram ID 100000001)
 *       Админка   → первый ID из ADMIN_TELEGRAM_IDS
 *   npm run dev:init-data -- --id 123 --username ivan --name Иван   — другой покупатель
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, SERVER_ROOT } from '../src/config.js';
import { buildInitData, type TelegramWebAppUser } from '../src/lib/telegram-init-data.js';

const config = loadConfig();
if (config.isProduction) {
  console.error('Скрипт предназначен только для локальной разработки.');
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    username: { type: 'string' },
    name: { type: 'string' },
  },
});

function write(app: 'miniapp' | 'admin', user: TelegramWebAppUser) {
  const initData = buildInitData(user, config.bot.token);
  const file = path.resolve(SERVER_ROOT, '..', app, '.env.development.local');
  writeFileSync(file, `# Сгенерировано npm run dev:init-data — не коммитить\nVITE_DEV_INIT_DATA=${initData}\n`);
  console.log(`✓ ${app}: Telegram ID ${user.id} → ${path.relative(process.cwd(), file)}`);
}

write('miniapp', {
  id: values.id ? Number(values.id) : 100000001,
  first_name: values.name ?? 'Тестовый',
  username: values.username ?? 'test_buyer',
  language_code: 'ru',
});

const adminId = [...config.adminTelegramIds][0];
if (adminId) {
  write('admin', { id: adminId, first_name: 'Admin', username: 'shop_admin', language_code: 'ru' });
} else {
  console.warn('! ADMIN_TELEGRAM_IDS не задан — админка будет недоступна');
}

console.log(`initData действует ${Math.round(config.initDataMaxAgeSeconds / 3600)} ч. Перезапустите Vite.`);
