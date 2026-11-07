import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { MeDTO, PublicConfigDTO } from '@wag/shared';
import type { AppContext } from '../context.js';
import { getAuth } from '../plugins/auth.js';

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/health', async (_req, reply) => {
    try {
      await ctx.db.execute(sql`SELECT 1`);
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'db_unavailable' });
    }
  });

  app.get('/api/config', async (): Promise<PublicConfigDTO> => ({
    shopName: ctx.config.shop.name,
    shopDescription: ctx.config.shop.description,
    managerUsername: ctx.config.shop.managerUsername,
    botUsername: ctx.bot.bot.isInited() ? ctx.bot.bot.botInfo.username : null,
  }));

  app.get('/api/me', { preHandler: ctx.auth.requireUser }, async (req): Promise<MeDTO> => {
    const auth = getAuth(req);
    return {
      id: auth.userId,
      telegramId: auth.telegramId,
      firstName: auth.tgUser.first_name ?? '',
      username: auth.tgUser.username ?? null,
      isAdmin: auth.isAdmin,
    };
  });
}
