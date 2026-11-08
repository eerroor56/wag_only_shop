import type { FastifyInstance } from 'fastify';
import { cartAddSchema, cartUpdateSchema, checkoutSchema, idParamSchema, productsQuerySchema } from '@wag/shared';
import type { AppContext } from '../context.js';
import { notFound, parseInput } from '../lib/errors.js';
import { getAuth } from '../plugins/auth.js';

/** API покупателя. Все маршруты требуют проверенную Telegram initData. */
export async function shopRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', ctx.auth.requireUser);

  // ---------------- каталог

  app.get('/api/products', async (req) => {
    const q = parseInput(productsQuerySchema, req.query);
    return ctx.products.listCatalog(q);
  });

  app.get('/api/categories', async () => ctx.categories.listPublic());

  app.get('/api/products/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return ctx.products.getCatalogProduct(id);
  });

  // ---------------- корзина (хранится на сервере)

  app.get('/api/cart', async (req) => ctx.cart.getCart(getAuth(req).userId));

  app.post('/api/cart/items', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const body = parseInput(cartAddSchema, req.body);
    return ctx.cart.addItem(getAuth(req).userId, body.productId, body.quantity, body.size);
  });

  app.patch('/api/cart/items/:id', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const body = parseInput(cartUpdateSchema, req.body);
    return ctx.cart.updateItem(getAuth(req).userId, id, body.quantity);
  });

  app.delete('/api/cart/items/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    return ctx.cart.removeItem(getAuth(req).userId, id);
  });

  // ---------------- заказы

  app.post('/api/orders', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const auth = getAuth(req);
    const body = parseInput(checkoutSchema, req.body);
    const result = await ctx.orders.createFromCart(auth.userId, body, auth.tgUser.username ?? null);
    if (result.created) {
      // Уведомление не блокирует ответ клиенту; при сбое повторится фоновой задачей.
      void ctx.notifier
        .notify(result.order.id)
        .catch((err: unknown) => req.log.error({ err, orderId: result.order.id }, 'Ошибка уведомления о заказе'));
    }
    return reply.code(result.created ? 201 : 200).send(result.order);
  });

  app.get('/api/orders', async (req) => ctx.orders.listForUser(getAuth(req).userId));

  app.get('/api/orders/:id', async (req) => {
    const { id } = parseInput(idParamSchema, req.params);
    const order = await ctx.orders.getForUser(getAuth(req).userId, id);
    if (!order) throw notFound('Заказ не найден');
    return order;
  });
}
