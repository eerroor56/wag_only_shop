import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { AppConfig } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { InitDataError, validateInitData, type TelegramWebAppUser } from '../lib/telegram-init-data.js';
import type { UsersService } from '../modules/users/users.service.js';

export interface AuthContext {
  /** id пользователя в БД. */
  userId: number;
  telegramId: number;
  tgUser: TelegramWebAppUser;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** Достаёт initData из заголовка `Authorization: tma <initData>`. */
export function extractInitData(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'tma') return null;
  return rest.join(' ').trim() || null;
}

const FAILURE_MESSAGES: Record<InitDataError['reason'], string> = {
  missing: 'Откройте магазин через Telegram',
  malformed: 'Некорректные данные авторизации Telegram',
  bad_signature: 'Не удалось подтвердить авторизацию Telegram',
  expired: 'Сессия устарела. Закройте и снова откройте приложение',
  no_user: 'Не удалось определить пользователя Telegram',
};

export function createAuthHooks(config: AppConfig, usersService: UsersService) {
  /**
   * Пользователь определяется ТОЛЬКО по проверенной подписи initData.
   * Любые telegram_id / user_id в теле запроса игнорируются.
   */
  const requireUser: preHandlerAsyncHookHandler = async (req: FastifyRequest, _reply: FastifyReply) => {
    let validated;
    try {
      validated = validateInitData(extractInitData(req), config.bot.token, config.initDataMaxAgeSeconds);
    } catch (err) {
      if (err instanceof InitDataError) {
        req.log.info({ reason: err.reason }, 'initData rejected');
        throw unauthorized(FAILURE_MESSAGES[err.reason]);
      }
      throw err;
    }
    const { user } = validated;
    const userId = await usersService.upsertFromTelegram(user);
    req.auth = { userId, telegramId: user.id, tgUser: user, isAdmin: config.adminTelegramIds.has(user.id) };
  };

  /** Доступ к admin API — только Telegram ID из whitelist ADMIN_TELEGRAM_IDS. */
  const requireAdmin: preHandlerAsyncHookHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) await requireUser.call(req.server, req, reply);
    if (!req.auth?.isAdmin) {
      req.log.warn({ telegramId: req.auth?.telegramId }, 'Попытка доступа к admin API без прав');
      throw forbidden('Доступ только для администраторов магазина');
    }
  };

  return { requireUser, requireAdmin };
}

export function getAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
