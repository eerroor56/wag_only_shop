import { autoRetry } from '@grammyjs/auto-retry';
import { Bot, GrammyError, HttpError, InlineKeyboard, type Api } from 'grammy';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config.js';
import type { UsersService } from '../modules/users/users.service.js';
import { welcomeText } from './texts.js';

export interface TelegramBot {
  bot: Bot;
  api: Api;
  /** Регистрация команд, кнопки меню и webhook / запуск polling. Ошибки Telegram не роняют сервер. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

const ALLOWED_UPDATES = ['message', 'my_chat_member'] as const;

export function shopKeyboard(config: AppConfig): InlineKeyboard {
  return new InlineKeyboard().webApp('Открыть магазин', config.miniAppUrl);
}

export function createTelegramBot(config: AppConfig, usersService: UsersService, log: FastifyBaseLogger): TelegramBot {
  const bot = new Bot(config.bot.token, { client: { apiRoot: config.bot.apiRoot } });
  // Автоматические повторы при 429 (retry_after) и сетевых сбоях.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60, rethrowHttpErrors: false }));

  const isAdmin = (id: number | undefined) => id !== undefined && config.adminTelegramIds.has(id);

  // Каждый, кто пишет боту, сохраняется в users (для рассылки).
  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot && ctx.chat?.type === 'private') {
      await usersService
        .upsertFromTelegram(ctx.from, { unblock: Boolean(ctx.message) })
        .catch((err: unknown) => log.error({ err }, 'Не удалось сохранить пользователя бота'));
    }
    await next();
  });

  // Кнопки web_app работают только в личных чатах с ботом — в группах бот молчит.
  const pm = bot.chatType('private');

  /**
   * Чат с ботом остаётся чистым: Telegram не позволяет запретить ввод сообщений,
   * поэтому любые входящие сообщения пользователя (текст, контакт, стикеры, /start)
   * удаляются сразу после обработки, а бот на них не отвечает.
   */
  pm.on('message', async (ctx, next) => {
    try {
      await next();
    } finally {
      await ctx.deleteMessage().catch(() => undefined);
    }
  });

  /** Последнее служебное сообщение бота в чате (приветствие / админ-панель) — при повторе заменяем его. */
  const lastServiceMessage = new Map<number, number>();
  async function replaceServiceMessage(chatId: number, send: () => Promise<{ message_id: number }>) {
    const previous = lastServiceMessage.get(chatId);
    const sent = await send();
    if (lastServiceMessage.size > 50_000) lastServiceMessage.clear();
    lastServiceMessage.set(chatId, sent.message_id);
    if (previous) await bot.api.deleteMessage(chatId, previous).catch(() => undefined);
  }

  pm.command('start', async (ctx) => {
    await replaceServiceMessage(ctx.chat.id, () =>
      ctx.reply(welcomeText(config), { parse_mode: 'HTML', reply_markup: shopKeyboard(config) }),
    );
  });

  // Основной вход в админку — кнопка в Mini App; команда оставлена для администраторов как запасной путь.
  pm.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await replaceServiceMessage(ctx.chat.id, () =>
      ctx.reply('Админ-панель WAG Shop', {
        reply_markup: new InlineKeyboard().webApp('Открыть админ-панель', config.adminUrl),
      }),
    );
  });

  // Пользователь заблокировал / разблокировал бота.
  bot.on('my_chat_member', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === 'kicked') await usersService.setBlocked(ctx.myChatMember.from.id, true);
    if (status === 'member') await usersService.setBlocked(ctx.myChatMember.from.id, false);
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) log.warn({ description: e.description }, 'Ошибка Telegram API в обработчике');
    else if (e instanceof HttpError) log.warn({ err: e.error }, 'Сетевая ошибка Telegram');
    else log.error({ err: e }, 'Ошибка в обработчике бота');
  });

  async function configureBot(): Promise<void> {
    const results = await Promise.allSettled([
      bot.api.setMyCommands([{ command: 'start', description: 'Открыть магазин' }]),
      bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: 'Магазин', web_app: { url: config.miniAppUrl } },
      }),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') log.warn({ err: String(r.reason) }, 'Не удалось настроить бота (команды/кнопку меню)');
    }
    // Команда /admin видна только администраторам.
    for (const adminId of config.adminTelegramIds) {
      await bot.api
        .setMyCommands(
          [
            { command: 'start', description: 'Открыть магазин' },
            { command: 'admin', description: 'Админ-панель' },
          ],
          { scope: { type: 'chat', chat_id: adminId } },
        )
        .catch(() => log.warn({ adminId }, 'Администратор ещё не запускал бота — команда /admin недоступна в меню'));
    }
  }

  let polling = false;

  return {
    bot,
    api: bot.api,
    async start() {
      if (config.bot.mode === 'disabled') {
        log.info('Бот: режим disabled — только отправка сообщений');
        return;
      }
      try {
        await bot.init();
        log.info({ username: bot.botInfo.username }, 'Бот подключён');
        await configureBot();
        if (config.bot.mode === 'webhook') {
          const url = `${config.publicUrl}${config.bot.webhookPath}`;
          await bot.api.setWebhook(url, {
            secret_token: config.bot.webhookSecret!,
            allowed_updates: [...ALLOWED_UPDATES],
            drop_pending_updates: false,
          });
          log.info({ url }, 'Webhook установлен');
        } else {
          polling = true;
          void bot
            .start({ allowed_updates: [...ALLOWED_UPDATES], onStart: () => log.info('Бот запущен (long polling)') })
            .catch((err: unknown) => {
              polling = false;
              log.error({ err }, 'Long polling остановлен с ошибкой');
            });
        }
      } catch (err) {
        log.error({ err }, 'Не удалось запустить бота. API магазина продолжит работу; проверьте BOT_TOKEN и доступ к Telegram.');
      }
    },
    async stop() {
      if (polling) await bot.stop();
    },
  };
}

/** Ошибки, означающие, что пользователю больше нельзя писать (заблокировал бота, удалил аккаунт и т.п.). */
export function isUnreachableUserError(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  if (err.error_code === 403) return true;
  return (
    err.error_code === 400 &&
    /chat not found|user is deactivated|bot can't initiate|PEER_ID_INVALID|USER_IS_BLOCKED/i.test(err.description)
  );
}
