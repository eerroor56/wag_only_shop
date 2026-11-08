import { and, asc, count, desc, eq, inArray, isNull, lt, min, or, sql, type SQL } from 'drizzle-orm';
import {
  effectiveDiscountPercent,
  isSoldOut,
  normalizeStock,
  productRuleIssues,
  stockTotal,
  titleSearchKey,
  type CatalogSort,
  type AdminProductDTO,
  type AdminProductsDTO,
  type AdminImageDTO,
  type ProductCardDTO,
  type ProductDetailDTO,
  type ProductFields,
  type ProductPatch,
  type ProductsPageDTO,
} from '@wag/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Database, DbExecutor } from '../../db/client.js';
import { categories, productImages, products, type Product, type ProductImage } from '../../db/schema.js';
import { badRequest, notFound, validationError } from '../../lib/errors.js';
import { escapeLike } from '../../lib/format.js';
import { processProductImage } from '../../storage/image-processor.js';
import type { StorageDriver } from '../../storage/index.js';
import type { CategoriesService } from '../categories/categories.service.js';
import { galleryOrder, mainImage, sortImages, toAdminImageDTO, toImageDTO } from './product-images.js';

const ORPHAN_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

export class ProductsService {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageDriver,
    private readonly categories: CategoriesService,
    private readonly log: FastifyBaseLogger,
  ) {}

  // ------------------------------------------------------------------ serialization

  toCard(p: Product, image: ProductImage | undefined): ProductCardDTO {
    return {
      id: p.id,
      title: p.title,
      price: p.price,
      oldPrice: p.oldPrice != null && p.oldPrice > p.price ? p.oldPrice : null,
      discountPercent: effectiveDiscountPercent(p),
      image: image ? toImageDTO(image, this.storage) : null,
      sizes: p.sizes,
      stock: p.stock,
      soldOut: isSoldOut(p.stock),
    };
  }

  private toAdmin(p: Product, images: ProductImage[]): AdminProductDTO {
    const sorted = sortImages(images);
    const main = mainImage(sorted);
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      price: p.price,
      oldPrice: p.oldPrice,
      discountPercent: p.discountPercent,
      effectiveDiscountPercent: effectiveDiscountPercent(p),
      attributes: p.attributes,
      sizes: p.sizes,
      stock: p.stock,
      stockTotal: p.stockTotal,
      categoryId: p.categoryId,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
      images: sorted.map((i): AdminImageDTO => ({ ...toAdminImageDTO(i, this.storage), isMain: i.id === main?.id })),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  /** Главное фото для набора товаров одним запросом. */
  async mainImagesFor(db: DbExecutor, productIds: number[]): Promise<Map<number, ProductImage>> {
    if (!productIds.length) return new Map();
    const rows = await (db as Database)
      .selectDistinctOn([productImages.productId])
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(productImages.productId, desc(productImages.isMain), asc(productImages.sortOrder), asc(productImages.id));
    return new Map(rows.map((r) => [r.productId!, r]));
  }

  private async imagesFor(db: DbExecutor, productIds: number[]): Promise<Map<number, ProductImage[]>> {
    const map = new Map<number, ProductImage[]>();
    if (!productIds.length) return map;
    const rows = await db.select().from(productImages).where(inArray(productImages.productId, productIds));
    for (const r of rows) {
      const list = map.get(r.productId!) ?? [];
      list.push(r);
      map.set(r.productId!, list);
    }
    return map;
  }

  // ------------------------------------------------------------------ catalog (покупатель)

  async listCatalog(params: {
    limit: number;
    offset: number;
    categoryId?: number;
    sort?: CatalogSort;
    q?: string;
    inStock?: boolean;
  }): Promise<ProductsPageDTO> {
    const { limit, offset } = params;
    const search = params.q ? titleSearchKey(params.q) : '';
    const where = and(
      eq(products.isActive, true),
      params.categoryId !== undefined ? eq(products.categoryId, params.categoryId) : undefined,
      search ? sql`${products.titleSort} LIKE ${`%${escapeLike(search)}%`}` : undefined,
      params.inStock ? or(isNull(products.stockTotal), sql`${products.stockTotal} > 0`) : undefined,
    );
    // Закончившиеся товары — в конце списка при любой сортировке, как на маркетплейсах.
    const soldOutLast = sql`(coalesce(${products.stockTotal}, 1) = 0)`;
    const bySort: Record<CatalogSort, SQL[]> = {
      default: [asc(products.sortOrder)],
      price_asc: [asc(products.price)],
      price_desc: [desc(products.price)],
      title_asc: [sql`${products.titleSort} COLLATE "C" ASC`],
      title_desc: [sql`${products.titleSort} COLLATE "C" DESC`],
      new: [desc(products.createdAt)],
    };
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select()
        .from(products)
        .where(where)
        .orderBy(soldOutLast, ...bySort[params.sort ?? 'default'], desc(products.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ n: count() }).from(products).where(where),
    ]);
    const images = await this.mainImagesFor(this.db, rows.map((r) => r.id));
    const total = totalRow?.n ?? 0;
    return {
      items: rows.map((p) => this.toCard(p, images.get(p.id))),
      total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
    };
  }

  async getCatalogProduct(id: number): Promise<ProductDetailDTO> {
    const product = await this.db.query.products.findFirst({
      where: and(eq(products.id, id), eq(products.isActive, true)),
    });
    if (!product) throw notFound('Товар не найден или снят с продажи');
    const [images, category] = await Promise.all([
      this.imagesFor(this.db, [id]).then((m) => m.get(id) ?? []),
      product.categoryId != null
        ? this.db.query.categories.findFirst({
            where: eq(categories.id, product.categoryId),
            columns: { id: true, name: true },
          })
        : undefined,
    ]);
    const gallery = galleryOrder(images);
    return {
      ...this.toCard(product, gallery[0]),
      category: category ?? null,
      description: product.description,
      attributes: product.attributes,
      images: gallery.map((i) => toImageDTO(i, this.storage)),
    };
  }

  // ------------------------------------------------------------------ admin

  async adminList(status: 'all' | 'active' | 'hidden'): Promise<AdminProductsDTO> {
    const where = status === 'all' ? undefined : eq(products.isActive, status === 'active');
    const [rows, countRows] = await Promise.all([
      this.db.select().from(products).where(where).orderBy(asc(products.sortOrder), desc(products.id)),
      this.db.select({ isActive: products.isActive, n: count() }).from(products).groupBy(products.isActive),
    ]);
    const images = await this.imagesFor(this.db, rows.map((r) => r.id));
    const active = countRows.find((r) => r.isActive)?.n ?? 0;
    const hidden = countRows.find((r) => !r.isActive)?.n ?? 0;
    return {
      items: rows.map((p) => this.toAdmin(p, images.get(p.id) ?? [])),
      counts: { total: active + hidden, active, hidden },
    };
  }

  async adminGet(id: number): Promise<AdminProductDTO> {
    const product = await this.db.query.products.findFirst({ where: eq(products.id, id) });
    if (!product) throw notFound('Товар не найден');
    const images = (await this.imagesFor(this.db, [id])).get(id) ?? [];
    return this.toAdmin(product, images);
  }

  async create(input: ProductFields): Promise<AdminProductDTO> {
    const id = await this.db.transaction(async (tx) => {
      await this.categories.assertExists(tx, input.categoryId);
      const stock = normalizeStock(input.sizes, input.stock);
      // Новые товары появляются в начале каталога.
      const [{ minOrder } = { minOrder: null }] = await tx.select({ minOrder: min(products.sortOrder) }).from(products);
      const [created] = await tx
        .insert(products)
        .values({
          title: input.title,
          description: input.description,
          price: input.price,
          oldPrice: input.oldPrice,
          discountPercent: input.discountPercent,
          attributes: input.attributes,
          sizes: input.sizes,
          stock,
          stockTotal: stockTotal(stock),
          categoryId: input.categoryId,
          isActive: input.isActive,
          sortOrder: (minOrder ?? 1) - 1,
        })
        .returning({ id: products.id });
      await this.syncImages(tx, created!.id, input.imageIds, input.mainImageId);
      return created!.id;
    });
    return this.adminGet(id);
  }

  async update(id: number, patch: ProductPatch): Promise<AdminProductDTO> {
    const removedKeys = await this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(products).where(eq(products.id, id)).for('update');
      if (!current) throw notFound('Товар не найден');

      const currentImages = await tx.select().from(productImages).where(eq(productImages.productId, id));
      const sorted = sortImages(currentImages);
      const merged: ProductFields = {
        title: patch.title ?? current.title,
        description: patch.description ?? current.description,
        price: patch.price ?? current.price,
        oldPrice: patch.oldPrice !== undefined ? patch.oldPrice : current.oldPrice,
        discountPercent: patch.discountPercent !== undefined ? patch.discountPercent : current.discountPercent,
        attributes: patch.attributes ?? current.attributes,
        sizes: patch.sizes ?? current.sizes,
        stock: patch.stock !== undefined ? patch.stock : current.stock,
        categoryId: patch.categoryId !== undefined ? patch.categoryId : current.categoryId,
        isActive: patch.isActive ?? current.isActive,
        imageIds: patch.imageIds ?? sorted.map((i) => i.id),
        mainImageId: patch.mainImageId !== undefined ? patch.mainImageId : (mainImage(sorted)?.id ?? null),
      };
      const issues = productRuleIssues(merged);
      if (issues.length) throw validationError(issues);
      if (patch.categoryId !== undefined) await this.categories.assertExists(tx, merged.categoryId);
      // Остатки всегда приводятся к актуальному списку размеров (удалённый размер — удалённый остаток).
      const stock = normalizeStock(merged.sizes, merged.stock);

      await tx
        .update(products)
        .set({
          title: merged.title,
          description: merged.description,
          price: merged.price,
          oldPrice: merged.oldPrice,
          discountPercent: merged.discountPercent,
          attributes: merged.attributes,
          sizes: merged.sizes,
          stock,
          stockTotal: stockTotal(stock),
          categoryId: merged.categoryId,
          isActive: merged.isActive,
        })
        .where(eq(products.id, id));

      if (patch.imageIds !== undefined || patch.mainImageId !== undefined) {
        return this.syncImages(tx, id, merged.imageIds, merged.mainImageId);
      }
      return [];
    });
    await this.deleteFiles(removedKeys);
    return this.adminGet(id);
  }

  /**
   * Приводит набор фото товара к переданному списку: прикрепляет новые загрузки, задаёт порядок
   * и главное фото, удаляет исключённые. Возвращает ключи файлов для удаления после commit.
   */
  private async syncImages(
    tx: DbExecutor,
    productId: number,
    imageIds: number[],
    mainImageId: number | null,
  ): Promise<string[]> {
    if (imageIds.length) {
      const found = await (tx as Database)
        .select()
        .from(productImages)
        .where(inArray(productImages.id, imageIds))
        .for('update');
      const usable = new Set(
        found.filter((i) => i.productId === null || i.productId === productId).map((i) => i.id),
      );
      const missing = imageIds.filter((imageId) => !usable.has(imageId));
      if (missing.length) {
        throw badRequest('Некоторые фотографии не найдены. Загрузите их заново.', [
          { path: 'imageIds', message: `Не найдены фото: ${missing.join(', ')}` },
        ]);
      }
    }

    const existing = await tx.select().from(productImages).where(eq(productImages.productId, productId));
    const keep = new Set(imageIds);
    const removed = existing.filter((i) => !keep.has(i.id));
    if (removed.length) {
      await tx.delete(productImages).where(inArray(productImages.id, removed.map((i) => i.id)));
    }

    // Сначала снимаем флаг is_main у всех, затем ставим главному — иначе сработает уникальный индекс.
    await tx.update(productImages).set({ isMain: false }).where(eq(productImages.productId, productId));
    for (const [index, imageId] of imageIds.entries()) {
      await tx.update(productImages).set({ productId, sortOrder: index }).where(eq(productImages.id, imageId));
    }
    const main = mainImageId ?? imageIds[0];
    if (main != null) {
      await tx.update(productImages).set({ isMain: true }).where(eq(productImages.id, main));
    }

    return removed.flatMap((i) => [i.storageKey, i.thumbKey]);
  }

  async delete(id: number): Promise<void> {
    const keys = await this.db.transaction(async (tx) => {
      const images = await tx.select().from(productImages).where(eq(productImages.productId, id));
      // order_items.product_id → SET NULL: заказы сохраняют snapshot названия и цены.
      const deleted = await tx.delete(products).where(eq(products.id, id)).returning({ id: products.id });
      if (!deleted.length) throw notFound('Товар не найден');
      return images.flatMap((i) => [i.storageKey, i.thumbKey]);
    });
    await this.deleteFiles(keys);
  }

  /** Устанавливает порядок: ids в нужной последовательности. Неуказанные товары сохраняют порядок после них. */
  async reorder(ids: number[]): Promise<void> {
    if (new Set(ids).size !== ids.length) throw badRequest('Товары в списке повторяются');
    await this.db.transaction(async (tx) => {
      const all = await tx
        .select({ id: products.id })
        .from(products)
        .orderBy(asc(products.sortOrder), desc(products.id))
        .for('update');
      const known = new Set(all.map((r) => r.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length) throw badRequest(`Товары не найдены: ${unknown.join(', ')}`);
      const listed = new Set(ids);
      const finalOrder = [...ids, ...all.map((r) => r.id).filter((id) => !listed.has(id))];
      await tx.execute(sql`
        UPDATE ${products} AS p SET sort_order = v.ord
        FROM (SELECT * FROM unnest(${`{${finalOrder.join(',')}}`}::int[]) WITH ORDINALITY AS t(id, ord)) AS v
        WHERE p.id = v.id AND p.sort_order IS DISTINCT FROM v.ord
      `);
    });
  }

  async uploadImage(file: Buffer): Promise<AdminImageDTO> {
    const processed = await processProductImage(file);
    await this.storage.put(processed.key, processed.full, 'image/webp');
    await this.storage.put(processed.thumbKey, processed.thumb, 'image/webp');
    try {
      const [row] = await this.db
        .insert(productImages)
        .values({
          productId: null,
          storageKey: processed.key,
          thumbKey: processed.thumbKey,
          width: processed.width,
          height: processed.height,
        })
        .returning();
      return toAdminImageDTO(row!, this.storage);
    } catch (err) {
      await this.deleteFiles([processed.key, processed.thumbKey]);
      throw err;
    }
  }

  /** Удаляет фото, загруженные в админке, но так и не прикреплённые к товару. */
  async cleanupOrphanImages(): Promise<number> {
    const cutoff = new Date(Date.now() - ORPHAN_IMAGE_TTL_MS);
    const rows = await this.db
      .delete(productImages)
      .where(and(isNull(productImages.productId), lt(productImages.createdAt, cutoff)))
      .returning();
    await this.deleteFiles(rows.flatMap((i) => [i.storageKey, i.thumbKey]));
    return rows.length;
  }

  private async deleteFiles(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        this.storage.delete(key).catch((err: unknown) => this.log.warn({ err, key }, 'Не удалось удалить файл')),
      ),
    );
  }
}
