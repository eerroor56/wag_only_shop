import type { FastifyInstance } from 'fastify';
import {
  adminOrdersQuerySchema,
  adminProductsQuerySchema,
  adminUsersQuerySchema,
  ALLOWED_IMAGE_MIME,
  broadcastCreateSchema,
  idParamSchema,
  orderUpdateSchema,
  productCreateSchema,
  productPatchSchema,
  productReorderSchema,
} from '@wag/shared';
import type { AppContext } from '../context.js';
import { badRequest, parseInput } from '../lib/errors.js';
import { getAuth } from '../plugins/auth.js';

/** Admin API. Доступ только для Telegram ID из ADMIN_TELEGRAM_IDS (проверка на сервере). */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', ctx.auth.requireAdmin);

  app.get('/api/admin/dashboard', async () => ctx.dashboard.get());

  // ---------------- товары

  app.get('/api/admin/products', async (req) => {
    const q = parseInput(adminProductsQuerySchema, req.query);
    return ctx.products.adminList(q.status);
  });

  app.get('/api/admin/products/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return ctx.products.adminGet(id);
  });

  app.post('/api/admin/products', async (req, reply) => {
    const body = parseInput(productCreateSchema, req.body);
    return reply.code(201).send(await ctx.products.create(body));
  });

  app.patch('/api/admin/products/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const body = parseInput(productPatchSchema, req.body);
    return ctx.products.update(id, body);
  });

  app.delete('/api/admin/products/:id', async (req, reply) => {
    const { id } = parseInput(idParamSchema, req.params);
    await ctx.products.delete(id);
    return reply.code(204).send();
  });

  app.put('/api/admin/products/order', async (req, reply) => {
    const body = parseInput(productReorderSchema, req.body);
    await ctx.products.reorder(body.ids);
    return reply.code(204).send();
  });

  // ---------------- загрузка изображений

  app.post(
    '/api/admin/images',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!req.isMultipart()) throw badRequest('Ожидается multipart/form-data');
      const file = await req.file();
      if (!file) throw badRequest('Файл не передан');
      // Заявленный MIME — только первичный фильтр; реальный формат проверяется по содержимому в sharp.
      if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.mimetype) && !/^image\/hei[cf]$/.test(file.mimetype)) {
        throw badRequest('Поддерживаются JPEG, PNG, WebP, AVIF и GIF');
      }
      const buffer = await file.toBuffer();
      return reply.code(201).send(await ctx.products.uploadImage(buffer));
    },
  );

  // ---------------- заказы

  app.get('/api/admin/orders', async (req) => {
    const q = parseInput(adminOrdersQuerySchema, req.query);
    return ctx.orders.adminList(q);
  });

  app.get('/api/admin/orders/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return ctx.orders.adminGet(id);
  });

  app.patch('/api/admin/orders/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const body = parseInput(orderUpdateSchema, req.body);
    return ctx.orders.updateStatus(id, body.status);
  });

  // ---------------- пользователи

  app.get('/api/admin/users', async (req) => {
    const q = parseInput(adminUsersQuerySchema, req.query);
    return ctx.users.list(q);
  });

  // ---------------- рассылка

  app.get('/api/admin/broadcasts', async () => ({
    recipients: await ctx.broadcast.recipientsCount(),
    items: await ctx.broadcast.list(),
  }));

  app.get('/api/admin/broadcasts/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return ctx.broadcast.get(id);
  });

  app.post('/api/admin/broadcasts', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseInput(broadcastCreateSchema, req.body);
    return reply.code(201).send(await ctx.broadcast.create(body, getAuth(req).telegramId));
  });

  app.post('/api/admin/broadcasts/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parseInput(broadcastCreateSchema, req.body);
    try {
      await ctx.broadcast.sendTest(body, getAuth(req).telegramId);
    } catch {
      throw badRequest('Не удалось отправить тестовое сообщение. Убедитесь, что вы запускали бота (/start).');
    }
    return reply.code(204).send();
  });

  app.post('/api/admin/broadcasts/:id/cancel', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return ctx.broadcast.cancel(id);
  });
}
