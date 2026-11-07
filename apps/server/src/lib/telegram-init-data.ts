import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Проверка Telegram WebApp initData по официальному алгоритму:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 *
 * data_check_string — все поля кроме hash, отсортированные по ключу, в формате key=value через \n.
 */

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_bot?: boolean;
}

export interface ValidatedInitData {
  user: TelegramWebAppUser;
  authDate: Date;
}

export type InitDataFailure = 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'no_user';

export class InitDataError extends Error {
  constructor(public readonly reason: InitDataFailure) {
    super(`Invalid Telegram initData: ${reason}`);
  }
}

const secretKeyCache = new Map<string, Buffer>();
function secretKey(botToken: string): Buffer {
  let key = secretKeyCache.get(botToken);
  if (!key) {
    key = createHmac('sha256', 'WebAppData').update(botToken).digest();
    secretKeyCache.set(botToken, key);
  }
  return key;
}

export function signInitData(params: URLSearchParams, botToken: string): string {
  const dataCheckString = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  return createHmac('sha256', secretKey(botToken)).update(dataCheckString).digest('hex');
}

export function validateInitData(
  raw: string | undefined | null,
  botToken: string,
  maxAgeSeconds: number,
  now: Date = new Date(),
): ValidatedInitData {
  if (!raw) throw new InitDataError('missing');
  if (raw.length > 8192) throw new InitDataError('malformed');

  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new InitDataError('malformed');

  const expected = Buffer.from(signInitData(params, botToken), 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new InitDataError('bad_signature');
  }

  const authDateSec = Number(params.get('auth_date'));
  if (!Number.isFinite(authDateSec) || authDateSec <= 0) throw new InitDataError('malformed');
  const ageSec = now.getTime() / 1000 - authDateSec;
  // Небольшой допуск на рассинхронизацию часов в будущее.
  if (ageSec > maxAgeSeconds || ageSec < -300) throw new InitDataError('expired');

  const userRaw = params.get('user');
  if (!userRaw) throw new InitDataError('no_user');
  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(userRaw) as TelegramWebAppUser;
  } catch {
    throw new InitDataError('malformed');
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new InitDataError('no_user');

  return { user, authDate: new Date(authDateSec * 1000) };
}

/** Генерация валидной initData — для локальной разработки и тестов (требует BOT_TOKEN). */
export function buildInitData(
  user: TelegramWebAppUser,
  botToken: string,
  authDate: Date = new Date(),
): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(authDate.getTime() / 1000)));
  params.set('query_id', 'AAH-dev-query');
  params.set('user', JSON.stringify(user));
  params.set('hash', signInitData(params, botToken));
  return params.toString();
}
