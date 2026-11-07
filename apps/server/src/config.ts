import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** apps/server — одинаково для src/*.ts (dev) и dist/*.js (prod). */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const telegramIdList = z
  .string()
  .default('')
  .transform((s, ctx) => {
    const ids = s
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((x) => Number(x));
    if (ids.some((n) => !Number.isSafeInteger(n) || n <= 0)) {
      ctx.addIssue({ code: 'custom', message: 'ADMIN_TELEGRAM_IDS: ожидается список числовых Telegram ID через запятую' });
      return z.NEVER;
    }
    return ids;
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool.default(false),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),

    PUBLIC_URL: z
      .url('PUBLIC_URL должен быть полным URL, например https://shop.example.com')
      .transform((u) => u.replace(/\/+$/, '')),

    BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/, 'BOT_TOKEN имеет неверный формат (получите его у @BotFather)'),
    BOT_MODE: z.enum(['webhook', 'polling', 'disabled']).optional(),
    WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{16,256}$/, 'WEBHOOK_SECRET: 16–256 символов A-Z, a-z, 0-9, _ и -')
      .optional(),
    TELEGRAM_API_ROOT: z.url().default('https://api.telegram.org'),
    ADMIN_TELEGRAM_IDS: telegramIdList,
    INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).default(86400),

    SHOP_NAME: z.string().default('WAG Shop'),
    SHOP_DESCRIPTION: z.string().default('Wag shop. Магазин брендовых вещей.'),
    MANAGER_USERNAME: z
      .string()
      .default('wag_on')
      .transform((s) => s.replace(/^@/, '')),
    SHOP_TIMEZONE: z
      .string()
      .default('Europe/Moscow')
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'SHOP_TIMEZONE: неизвестная временная зона'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().default(path.join(SERVER_ROOT, 'uploads')),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_URL: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(true),

    SERVE_STATIC: bool.default(true),
    MINIAPP_DIST: z.string().default(path.resolve(SERVER_ROOT, '../miniapp/dist')),
    ADMIN_DIST: z.string().default(path.resolve(SERVER_ROOT, '../admin/dist')),

    BROADCAST_RATE_PER_SECOND: z.coerce.number().min(1).max(30).default(25),
  })
  .superRefine((env, ctx) => {
    const mode = env.BOT_MODE ?? (env.NODE_ENV === 'production' ? 'webhook' : 'polling');
    if (mode === 'webhook' && !env.WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['WEBHOOK_SECRET'], message: 'WEBHOOK_SECRET обязателен при BOT_MODE=webhook' });
    }
    if (env.NODE_ENV === 'production' && !env.PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'В production Telegram требует HTTPS' });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} обязателен при STORAGE_DRIVER=s3` });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  trustProxy: boolean;
  databaseUrl: string;
  publicUrl: string;
  miniAppUrl: string;
  adminUrl: string;
  bot: {
    token: string;
    mode: 'webhook' | 'polling' | 'disabled';
    webhookSecret: string | null;
    webhookPath: string;
    apiRoot: string;
  };
  adminTelegramIds: ReadonlySet<number>;
  initDataMaxAgeSeconds: number;
  shop: { name: string; description: string; managerUsername: string; timezone: string };
  storage: {
    driver: 'local' | 's3';
    uploadDir: string;
    s3: {
      bucket: string;
      region: string;
      endpoint?: string;
      accessKeyId: string;
      secretAccessKey: string;
      publicUrl: string;
      forcePathStyle: boolean;
    } | null;
  };
  static: { enabled: boolean; miniAppDir: string; adminDir: string };
  broadcastRatePerSecond: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // Пустые строки в .env трактуем как «не задано».
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  • ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Некорректная конфигурация окружения:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const mode = e.BOT_MODE ?? (e.NODE_ENV === 'production' ? 'webhook' : 'polling');

  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    publicUrl: e.PUBLIC_URL,
    miniAppUrl: `${e.PUBLIC_URL}/`,
    adminUrl: `${e.PUBLIC_URL}/admin/`,
    bot: {
      token: e.BOT_TOKEN,
      mode,
      webhookSecret: e.WEBHOOK_SECRET ?? null,
      webhookPath: '/api/telegram/webhook',
      apiRoot: e.TELEGRAM_API_ROOT.replace(/\/+$/, ''),
    },
    adminTelegramIds: new Set(e.ADMIN_TELEGRAM_IDS),
    initDataMaxAgeSeconds: e.INIT_DATA_MAX_AGE_SECONDS,
    shop: {
      name: e.SHOP_NAME,
      description: e.SHOP_DESCRIPTION,
      managerUsername: e.MANAGER_USERNAME,
      timezone: e.SHOP_TIMEZONE,
    },
    storage: {
      driver: e.STORAGE_DRIVER,
      uploadDir: path.resolve(e.UPLOAD_DIR),
      s3:
        e.STORAGE_DRIVER === 's3'
          ? {
              bucket: e.S3_BUCKET!,
              region: e.S3_REGION,
              endpoint: e.S3_ENDPOINT,
              accessKeyId: e.S3_ACCESS_KEY_ID!,
              secretAccessKey: e.S3_SECRET_ACCESS_KEY!,
              publicUrl: e.S3_PUBLIC_URL!.replace(/\/+$/, ''),
              forcePathStyle: e.S3_FORCE_PATH_STYLE,
            }
          : null,
    },
    static: { enabled: e.SERVE_STATIC, miniAppDir: e.MINIAPP_DIST, adminDir: e.ADMIN_DIST },
    broadcastRatePerSecond: e.BROADCAST_RATE_PER_SECOND,
  };
}
