import { and, asc, count, eq, sql } from 'drizzle-orm';
import { LIMITS, type CartDTO } from '@wag/shared';
import type { Database, DbExecutor } from '../../db/client.js';
import { cartItems, carts, products } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { ProductsService } from '../products/products.service.js';

export class CartService {
  constructor(
    private readonly db: Database,
    private readonly productsService: ProductsService,
  ) {}

  async getOrCreateCartId(db: DbExecutor, userId: number): Promise<number> {
    const [inserted] = await db
      .insert(carts)
      .values({ userId })
      .onConflictDoNothing({ target: carts.userId })
      .returning({ id: carts.id });
    if (inserted) return inserted.id;
    const [existing] = await db.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId));
    return existing!.id;
  }

  /** Корзина с актуальными ценами из БД. Скрытые товары помечаются как недоступные и не входят в сумму. */
  async getCart(userId: number, db: DbExecutor = this.db): Promise<CartDTO> {
    const rows = await db
      .select({ item: cartItems, product: products })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .innerJoin(products, eq(products.id, cartItems.productId))
      .where(eq(carts.userId, userId))
      .orderBy(asc(cartItems.createdAt), asc(cartItems.id));

    const images = await this.productsService.mainImagesFor(db, rows.map((r) => r.product.id));
    let totalQuantity = 0;
    let totalAmount = 0;
    let hasUnavailable = false;

    const items = rows.map(({ item, product }) => {
      const available = product.isActive;
      const lineTotal = product.price * item.quantity;
      if (available) {
        totalQuantity += item.quantity;
        totalAmount += lineTotal;
      } else {
        hasUnavailable = true;
      }
      return {
        id: item.id,
        productId: product.id,
        quantity: item.quantity,
        available,
        lineTotal,
        product: this.productsService.toCard(product, images.get(product.id)),
      };
    });

    return { items, totalQuantity, totalAmount, hasUnavailable };
  }

  async addItem(userId: number, productId: number, quantity: number): Promise<CartDTO> {
    await this.db.transaction(async (tx) => {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, productId), eq(products.isActive, true)));
      if (!product) throw notFound('Товар не найден или снят с продажи');

      const cartId = await this.getOrCreateCartId(tx, userId);
      const [positions] = await tx.select({ n: count() }).from(cartItems).where(eq(cartItems.cartId, cartId));
      const [already] = await tx
        .select({ id: cartItems.id })
        .from(cartItems)
        .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
      if (!already && (positions?.n ?? 0) >= LIMITS.cartMaxPositions) {
        throw badRequest(`В корзине может быть не более ${LIMITS.cartMaxPositions} разных товаров`);
      }

      await tx
        .insert(cartItems)
        .values({ cartId, productId, quantity })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productId],
          set: { quantity: sql`least(${cartItems.quantity} + ${quantity}, ${LIMITS.cartItemMaxQuantity})` },
        });
      await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
    });
    return this.getCart(userId);
  }

  async updateItem(userId: number, itemId: number, quantity: number): Promise<CartDTO> {
    const updated = await this.db
      .update(cartItems)
      .set({ quantity })
      .where(
        and(
          eq(cartItems.id, itemId),
          sql`${cartItems.cartId} = (SELECT id FROM ${carts} WHERE ${carts.userId} = ${userId})`,
        ),
      )
      .returning({ id: cartItems.id });
    if (!updated.length) throw notFound('Позиция корзины не найдена');
    return this.getCart(userId);
  }

  async removeItem(userId: number, itemId: number): Promise<CartDTO> {
    const deleted = await this.db
      .delete(cartItems)
      .where(
        and(
          eq(cartItems.id, itemId),
          sql`${cartItems.cartId} = (SELECT id FROM ${carts} WHERE ${carts.userId} = ${userId})`,
        ),
      )
      .returning({ id: cartItems.id });
    if (!deleted.length) throw notFound('Позиция корзины не найдена');
    return this.getCart(userId);
  }
}
