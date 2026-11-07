import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { createTelegramBot, type TelegramBot } from './bot/bot.js';
import { DashboardService } from './modules/admin/dashboard.service.js';
import { BroadcastService } from './modules/broadcast/broadcast.service.js';
import { CartService } from './modules/cart/cart.service.js';
import { OrderNotifier } from './modules/orders/order-notifier.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { ProductsService } from './modules/products/products.service.js';
import { UsersService } from './modules/users/users.service.js';
import { createAuthHooks } from './plugins/auth.js';
import type { StorageDriver } from './storage/index.js';

/** Композиция зависимостей приложения (простой DI без фреймворка). */
export function createContext(config: AppConfig, db: Database, storage: StorageDriver, log: FastifyBaseLogger) {
  const users = new UsersService(db);
  const products = new ProductsService(db, storage, log);
  const cart = new CartService(db, products);
  const orders = new OrdersService(db);
  const bot: TelegramBot = createTelegramBot(config, users, log);
  const notifier = new OrderNotifier(db, bot.api, config, log);
  const broadcast = new BroadcastService(db, bot.api, config, log);
  const dashboard = new DashboardService(db, config.shop.timezone);
  const auth = createAuthHooks(config, users);

  return { config, db, storage, log, bot, auth, users, products, cart, orders, notifier, broadcast, dashboard };
}

export type AppContext = ReturnType<typeof createContext>;
