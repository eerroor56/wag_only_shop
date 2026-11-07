/**
 * Сценарий 1 (часть бота): пользователь отправляет /start → бот отвечает кнопкой «Открыть магазин».
 * Обновления приходят через webhook с секретным токеном.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { ADMIN_ID, createTestEnv, waitFor, type TestEnv } from './helpers.js';

const SECRET = 'test_webhook_secret_0123456789';
let env: TestEnv;
let updateId = 1;

function update(payload: Record<string, unknown>, secret: string | null = SECRET) {
  return env.app.inject({
    method: 'POST',
    url: '/api/telegram/webhook',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    payload: { update_id: updateId++, ...payload },
  });
}

/** message_id сообщений, которые бот удалил в чате. */
const deletedIn = (chatId: number) =>
  env.telegram.calls
    .filter((c) => c.method === 'deleteMessage' && Number(c.payload.chat_id) === chatId)
    .map((c) => Number(c.payload.message_id));

const from = { id: 6001, is_bot: false, first_name: 'Мария', username: 'maria' };
const chat = { id: 6001, type: 'private', first_name: 'Мария' };

beforeAll(async () => {
  env = await createTestEnv({ BOT_MODE: 'webhook', WEBHOOK_SECRET: SECRET });
});

afterAll(async () => {
  await env?.close();
});

describe('Telegram-бот (webhook)', () => {
  it('отклоняет обновления без секретного токена', async () => {
    const res = await update({ message: { message_id: 1, date: 0, chat, from, text: '/start' } }, null);
    expect(res.statusCode).toBe(401);
    const wrong = await update({ message: { message_id: 1, date: 0, chat, from, text: '/start' } }, 'wrong_secret_value_123');
    expect(wrong.statusCode).toBe(401);
    expect(env.telegram.messagesTo(from.id)).toHaveLength(0);
  });

  it('/start: приветствие с кнопкой «Открыть магазин» и сохранение пользователя', async () => {
    const res = await update({
      message: { message_id: 2, date: 0, chat, from, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
    });
    expect(res.statusCode).toBe(200);
    await waitFor(() => env.telegram.messagesTo(from.id).length > 0);

    const msg = env.telegram.messagesTo(from.id)[0]!.payload;
    expect(String(msg.text)).toContain('Магазин брендовых вещей');
    expect(String(msg.text)).toContain('@wag_on');
    const button = (msg.reply_markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] }).inline_keyboard[0]![0]!;
    expect(button).toEqual({ text: 'Открыть магазин', web_app: { url: 'https://shop.test/' } });

    const [user] = await env.db.db.select().from(users).where(eq(users.telegramId, from.id));
    expect(user).toMatchObject({ username: 'maria', firstName: 'Мария', isBlocked: false });
    // сама команда /start удаляется из чата
    await waitFor(() => deletedIn(from.id).includes(2));
  });

  it('блокировка и разблокировка бота отражаются в users.is_blocked', async () => {
    const memberUpdate = (status: string) => ({
      my_chat_member: {
        chat,
        from,
        date: 0,
        old_chat_member: { status: 'member', user: { id: 1234567890, is_bot: true, first_name: 'WAG Shop' } },
        new_chat_member: { status, user: { id: 1234567890, is_bot: true, first_name: 'WAG Shop' }, until_date: 0 },
      },
    });
    await update(memberUpdate('kicked'));
    await waitFor(async () => {
      const [u] = await env.db.db.select().from(users).where(eq(users.telegramId, from.id));
      return u?.isBlocked === true;
    });
    await update(memberUpdate('member'));
    await waitFor(async () => {
      const [u] = await env.db.db.select().from(users).where(eq(users.telegramId, from.id));
      return u?.isBlocked === false;
    });
  });

  it('/admin: обычному пользователю бот не отвечает, администратору — кнопка админ-панели', async () => {
    const before = env.telegram.messagesTo(from.id).length;
    await update({
      message: { message_id: 3, date: 0, chat, from, text: '/admin', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
    });
    await waitFor(() => deletedIn(from.id).includes(3));
    expect(env.telegram.messagesTo(from.id).length).toBe(before);

    const admin = { id: ADMIN_ID, is_bot: false, first_name: 'Admin' };
    const adminChat = { id: ADMIN_ID, type: 'private', first_name: 'Admin' };
    await update({
      message: { message_id: 4, date: 0, chat: adminChat, from: admin, text: '/admin', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
    });
    await waitFor(() => env.telegram.messagesTo(ADMIN_ID).length > 0);
    const reply = env.telegram.messagesTo(ADMIN_ID).at(-1)!.payload;
    const button = (reply.reply_markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] }).inline_keyboard[0]![0]!;
    expect(button).toEqual({ text: 'Открыть админ-панель', web_app: { url: 'https://shop.test/admin/' } });
  });

  it('любые сообщения пользователя удаляются без ответа (чат остаётся чистым)', async () => {
    const before = env.telegram.messagesTo(from.id).length;
    await update({ message: { message_id: 10, date: 0, chat, from, text: 'привет, есть скидки?' } });
    await update({
      message: { message_id: 11, date: 0, chat, from, contact: { phone_number: '79870000000', first_name: 'Мария', user_id: from.id } },
    });
    await waitFor(() => deletedIn(from.id).includes(10) && deletedIn(from.id).includes(11));
    expect(env.telegram.messagesTo(from.id).length).toBe(before);
  });

  it('повторный /start заменяет предыдущее приветствие', async () => {
    const welcomes = () => env.telegram.messagesTo(from.id).filter((m) => String(m.payload.text).includes('Магазин брендовых'));
    const before = welcomes().length;
    await update({
      message: { message_id: 12, date: 0, chat, from, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
    });
    await waitFor(() => welcomes().length === before + 1 && deletedIn(from.id).includes(12));
    const previousId = env.telegram.calls.findIndex((c) => c === welcomes()[before - 1]) + 1;
    await waitFor(() => deletedIn(from.id).includes(previousId));
  });

  it('в группах бот не отвечает', async () => {
    const groupChat = { id: -100500, type: 'group', title: 'Чат' };
    await update({
      message: { message_id: 4, date: 0, chat: groupChat, from, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(env.telegram.messagesTo(-100500)).toHaveLength(0);
  });
});
