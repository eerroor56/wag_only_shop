import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { createDb, type DbHandle } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { buildInitData, type TelegramWebAppUser } from '../src/lib/telegram-init-data.js';
import { createStorage } from '../src/storage/index.js';

export const BOT_TOKEN = '1234567890:AAH_test_token_for_integration_tests_0';
export const ADMIN_ID = 777000111;

export interface SentMessage {
  method: string;
  payload: Record<string, unknown>;
}

/** Минимальный фейковый Bot API: записывает вызовы, «заблокированным» chat_id отвечает 403. */
export async function startFakeTelegram() {
  const calls: SentMessage[] = [];
  const blocked = new Set<number>();
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('latin1');
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const method = req.url?.split('/').pop() ?? '';
      let payload: Record<string, unknown> = {};
      if (String(req.headers['content-type']).startsWith('multipart/form-data')) {
        // Загрузка файла (sendPhoto с InputFile): разбираем текстовые поля, файл помечаем флагом.
        const parts = body.split(/--[^\r\n]+\r\n/);
        for (const part of parts) {
          const name = /name="([^"]+)"/.exec(part)?.[1];
          if (!name) continue;
          const headerEnd = part.indexOf('\r\n\r\n');
          const headers = part.slice(0, headerEnd);
          const value = part.slice(headerEnd + 4).replace(/\r\n(--)?$/, '');
          if (/filename=|content-type:/i.test(headers)) payload[name] = { uploaded: true, bytes: value.length };
          else payload[name] = Buffer.from(value, 'latin1').toString('utf8');
        }
      } else {
        try {
          payload = body ? JSON.parse(Buffer.from(body, 'latin1').toString('utf8')) : {};
        } catch {
          /* пустое тело */
        }
      }
      // Подпись к фото считаем текстом сообщения, клавиатуру из multipart — разбираем.
      if (typeof payload.reply_markup === 'string') payload.reply_markup = JSON.parse(payload.reply_markup);
      if (payload.caption !== undefined && payload.text === undefined) payload.text = payload.caption;
      calls.push({ method, payload });
      if (method === 'sendPhoto') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ok: true,
            result: {
              message_id: calls.length,
              date: 0,
              chat: { id: Number(payload.chat_id), type: 'private' },
              photo: [{ file_id: 'BANNER_FILE_ID', file_unique_id: 'u1', width: 640, height: 640 }],
            },
          }),
        );
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (method === 'getMe') {
        res.end(JSON.stringify({ ok: true, result: { id: 1234567890, is_bot: true, first_name: 'WAG Shop', username: 'wag_shop_bot' } }));
        return;
      }
      if (method === 'sendMessage' && blocked.has(Number(payload.chat_id))) {
        res.end(JSON.stringify({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }));
        return;
      }
      res.end(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: calls.length, date: 0, chat: { id: payload.chat_id, type: 'private' } } : true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    blocked,
    messagesTo: (chatId: number) =>
      calls.filter((c) => (c.method === 'sendMessage' || c.method === 'sendPhoto') && Number(c.payload.chat_id) === chatId),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  config: AppConfig;
  db: DbHandle;
  telegram: Awaited<ReturnType<typeof startFakeTelegram>>;
  close(): Promise<void>;
}

export async function createTestEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? 'postgres://wag:wag_password@localhost:5432/wag_shop_test';
  const telegram = await startFakeTelegram();
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'wag-uploads-'));

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    PUBLIC_URL: 'https://shop.test',
    BOT_TOKEN,
    BOT_MODE: 'disabled',
    TELEGRAM_API_ROOT: telegram.url,
    ADMIN_TELEGRAM_IDS: String(ADMIN_ID),
    UPLOAD_DIR: uploadDir,
    SERVE_STATIC: 'false',
    BROADCAST_RATE_PER_SECOND: '30',
    ...overrides,
  });

  const db = createDb(databaseUrl);
  await db.db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.db.execute(sql`CREATE SCHEMA public`);
  await runMigrations(db.db);

  const storage = await createStorage(config.storage);
  const { app, ctx } = await buildApp(config, { db: db.db, storage });
  await app.ready();

  return {
    app,
    ctx,
    config,
    db,
    telegram,
    async close() {
      await ctx.broadcast.stop();
      await app.close();
      await db.close();
      await telegram.close();
      await rm(uploadDir, { recursive: true, force: true });
    },
  };
}

export function tma(user: Partial<TelegramWebAppUser> & { id: number }): Record<string, string> {
  return {
    authorization: `tma ${buildInitData({ first_name: 'Test', ...user }, BOT_TOKEN)}`,
  };
}

export const adminHeaders = () => tma({ id: ADMIN_ID, first_name: 'Admin', username: 'shop_admin' });

/** Ожидание условия (для фоновых задач). */
export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('waitFor: timeout');
}
