import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { webhookCallback } from 'grammy';
import { LIMITS, type ApiErrorBody } from '@wag/shared';
import type { AppConfig } from './config.js';
import { createContext, type AppContext } from './context.js';
import type { Database } from './db/client.js';
import { AppError } from './lib/errors.js';
import { extractInitData } from './plugins/auth.js';
import { adminRoutes } from './routes/admin.routes.js';
import { publicRoutes } from './routes/public.routes.js';
import { shopRoutes } from './routes/shop.routes.js';
import type { StorageDriver } from './storage/index.js';

/** Ключ rate limit: IP + заявленный Telegram ID (подпись проверяется позже, в auth). */
function rateLimitKey(req: FastifyRequest): string {
  let claimed = '';
  const initData = extractInitData(req);
  if (initData) {
    try {
      const user = JSON.parse(new URLSearchParams(initData).get('user') ?? '{}') as { id?: unknown };
      if (typeof user.id === 'number') claimed = String(user.id);
    } catch {
      /* невалидная initData будет отклонена в auth */
    }
  }
  return `${req.ip}:${claimed}`;
}

function errorBody(code: string, message: string, details?: ApiErrorBody['error']['details']): ApiErrorBody {
  return { error: details ? { code, message, details } : { code, message } };
}

export async function buildApp(
  config: AppConfig,
  deps: { db: Database; storage: StorageDriver },
): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers["x-telegram-bot-api-secret-token"]'],
      ...(config.isProduction || config.env === 'test'
        ? {}
        : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
    },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  const ctx = createContext(config, deps.db, deps.storage, app.log);

  // ---------------------------------------------------------------- security

  const imgSources = ["'self'", 'data:', 'blob:'];
  if (config.storage.s3) imgSources.push(new URL(config.storage.s3.publicUrl).origin);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: imgSources,
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Mini App открывается во фрейме Telegram Web (web.telegram.org).
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: false } : false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKey,
    allowList: (req) => !req.url.startsWith('/api/') || req.url.startsWith(config.bot.webhookPath),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      ...errorBody('RATE_LIMITED', `Слишком много запросов. Повторите через ${Math.ceil(ctx.ttl / 1000)} с.`),
    }),
  });

  await app.register(multipart, {
    limits: { fileSize: LIMITS.imageMaxBytes, files: 1, fields: 5, parts: 6 },
  });

  // ---------------------------------------------------------------- errors

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send(errorBody(err.code, err.message, err.details));
    }
    const status = err.statusCode ?? 500;
    if (status === 429) return reply.code(429).send(err);
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(413)
        .send(errorBody('FILE_TOO_LARGE', `Файл слишком большой. Максимум ${LIMITS.imageMaxBytes / 1024 / 1024} МБ`));
    }
    if (status >= 400 && status < 500) {
      return reply.code(status).send(errorBody('BAD_REQUEST', 'Некорректный запрос'));
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Внутренняя ошибка сервера. Попробуйте позже.'));
  });

  // ---------------------------------------------------------------- telegram webhook

  if (config.bot.mode === 'webhook' && config.bot.webhookSecret) {
    const handleUpdate = webhookCallback(ctx.bot.bot, 'fastify', {
      secretToken: config.bot.webhookSecret,
      onTimeout: 'return',
      timeoutMilliseconds: 9_000,
    });
    app.post(config.bot.webhookPath, handleUpdate);
  }

  // ---------------------------------------------------------------- api

  await app.register(async (scope) => publicRoutes(scope, ctx));
  await app.register(async (scope) => shopRoutes(scope, ctx));
  await app.register(async (scope) => adminRoutes(scope, ctx));

  // ---------------------------------------------------------------- static

  let staticRegistered = false;
  if (config.storage.driver === 'local') {
    await mkdir(config.storage.uploadDir, { recursive: true });
    await app.register(fastifyStatic, {
      root: config.storage.uploadDir,
      prefix: '/uploads/',
      index: false,
      list: false,
      dotfiles: 'deny',
      decorateReply: !staticRegistered,
      // Загруженные файлы — только изображения; запрещаем интерпретацию как HTML/скрипт.
      setHeaders: (res) => {
        void res.header('X-Content-Type-Options', 'nosniff');
        void res.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
        void res.header('Cache-Control', 'public, max-age=31536000, immutable');
        void res.header('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    });
    staticRegistered = true;
  }

  const spaRoots: { prefix: string; dir: string }[] = [];
  if (config.static.enabled) {
    for (const [prefix, dir] of [
      ['/admin/', config.static.adminDir],
      ['/', config.static.miniAppDir],
    ] as const) {
      if (!existsSync(path.join(dir, 'index.html'))) {
        app.log.warn({ dir }, 'Сборка frontend не найдена — выполните npm run build');
        continue;
      }
      await app.register(fastifyStatic, {
        root: dir,
        prefix,
        index: ['index.html'],
        // /admin → /admin/
        redirect: true,
        wildcard: true,
        dotfiles: 'deny',
        decorateReply: !staticRegistered,
        setHeaders: (res, filePath) => {
          void res.header(
            'Cache-Control',
            /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      });
      staticRegistered = true;
      spaRoots.push({ prefix, dir });
    }
  }

  // SPA fallback: клиентские маршруты (/catalog, /admin/orders/15 …) отдают index.html приложения.
  // Запросы файлов (с расширением) и API получают честный 404.
  app.setNotFoundHandler((req, reply) => {
    const url = req.url.split('?')[0] ?? '/';
    const isFile = /\.[a-z0-9]{1,8}$/i.test(url);
    if ((req.method === 'GET' || req.method === 'HEAD') && !isFile && !url.startsWith('/api/') && !url.startsWith('/uploads/')) {
      const root = spaRoots.find((r) => url.startsWith(r.prefix) || `${url}/` === r.prefix);
      if (root) {
        void reply.header('Cache-Control', 'no-cache');
        return reply.sendFile('index.html', root.dir);
      }
    }
    return reply.code(404).send(errorBody('NOT_FOUND', 'Не найдено'));
  });

  return { app, ctx };
}
