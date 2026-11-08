import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, max, min, or, sql, type SQL } from 'drizzle-orm';
import {
  brandKey,
  COLOR_KEYS,
  GENDERS,
  MATERIAL_KEYS,
  SEASONS,
  sortSizes,
  type CatalogFacetsDTO,
  type ProductsQuery,
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

/** Массив text[] параметрами: ARRAY[$1, $2]::text[] (обычный параметр-массив drizzle развернул бы в список). */
const textArray = (values: readonly string[]) =>
  sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

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
      brand: p.brand,
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
      ...this.filterFields(p),
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

  private filterFields(p: Product) {
    return {
      brand: p.brand,
      colorName: p.colorName,
      colors: p.colors,
      materialName: p.materialName,
      materials: p.materials,
      gender: p.gender,
      seasons: p.seasons,
    };
  }

  /** Колонки фильтров для insert / update. */
  private filterColumns(f: ProductFields) {
    return {
      brand: f.brand,
      brandKey: f.brand ? brandKey(f.brand) : null,
      colorName: f.colorName,
      colors: f.colors,
      materialName: f.materialName,
      materials: f.materials,
      gender: f.gender,
      seasons: f.seasons,
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

  async listCatalog(
    params: { limit: number; offset: number } & Partial<Omit<ProductsQuery, 'limit' | 'offset'>>,
  ): Promise<ProductsPageDTO> {
    const { limit, offset } = params;
    const search = params.q ? titleSearchKey(params.q) : '';
    const sizes = params.sizes?.map((s) => s.toLowerCase()) ?? [];
    const where = and(
      eq(products.isActive, true),
      params.categoryId !== undefined ? eq(products.categoryId, params.categoryId) : undefined,
      search ? sql`${products.titleSort} LIKE ${`%${escapeLike(search)}%`}` : undefined,
      params.inStock ? or(isNull(products.stockTotal), sql`${products.stockTotal} > 0`) : undefined,
      params.priceMin != null ? gte(products.price, params.priceMin) : undefined,
      params.priceMax != null ? lte(products.price, params.priceMax) : undefined,
      params.brands?.length ? inArray(products.brandKey, params.brands) : undefined,
      params.colors?.length ? sql`${products.colors} && ${textArray(params.colors)}` : undefined,
      params.materials?.length ? sql`${products.materials} && ${textArray(params.materials)}` : undefined,
      // «Всесезонные» вещи подходят под любой выбранный сезон.
      params.seasons?.length ? sql`${products.seasons} && ${textArray([...params.seasons, 'all'])}` : undefined,
      // Мужское / женское включает унисекс.
      params.gender
        ? inArray(products.gender, params.gender === 'unisex' ? ['unisex'] : [params.gender, 'unisex'])
        : undefined,
      // Размер подходит, только если он есть в наличии (или остатки не учитываются).
      sizes.length
        ? sql`EXISTS (
            SELECT 1 FROM unnest(${products.sizes}) AS s(size)
            WHERE lower(s.size) = ANY(${textArray(sizes)})
              AND (${products.stock} IS NULL OR coalesce((${products.stock} ->> s.size)::int, 0) > 0)
          )`
        : undefined,
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

  /**
   * Значения фильтров каталога по товарам в продаже (в выбранной категории): бренды, размеры в наличии,
   * цвета, материалы, сезоны, пол и максимальная цена. Пустые группы фильтр не показывает.
   */
  async catalogFacets(categoryId?: number): Promise<CatalogFacetsDTO> {
    const scope = and(
      eq(products.isActive, true),
      categoryId !== undefined ? eq(products.categoryId, categoryId) : undefined,
    )!;
    const unnested = async (column: typeof products.colors | typeof products.materials | typeof products.seasons) => {
      const res = await this.db.execute<{ value: string; count: number }>(sql`
        SELECT v AS value, count(*)::int AS count
        FROM ${products}, unnest(${column}) AS v
        WHERE ${scope}
        GROUP BY v
      `);
      return res.rows;
    };
    const byOrder = <T extends string>(rows: { value: string; count: number }[], order: readonly T[]) =>
      order.flatMap((value) => {
        const row = rows.find((r) => r.value === value);
        return row ? [{ value, count: row.count }] : [];
      });

    const [[price], brands, genders, sizeRows, colorRows, materialRows, seasonRows] = await Promise.all([
      this.db.select({ max: max(products.price) }).from(products).where(scope),
      this.db
        .select({ value: products.brandKey, label: min(products.brand), count: count() })
        .from(products)
        .where(and(scope, isNotNull(products.brandKey)))
        .groupBy(products.brandKey)
        .orderBy(products.brandKey),
      this.db
        .select({ value: products.gender, count: count() })
        .from(products)
        .where(and(scope, isNotNull(products.gender)))
        .groupBy(products.gender),
      this.db.execute<{ value: string; count: number }>(sql`
        SELECT s AS value, count(*)::int AS count
        FROM ${products}, unnest(${products.sizes}) AS s
        WHERE ${scope} AND (${products.stock} IS NULL OR coalesce((${products.stock} ->> s)::int, 0) > 0)
        GROUP BY s
      `),
      unnested(products.colors),
      unnested(products.materials),
      unnested(products.seasons),
    ]);

    const sizeCounts = new Map(sizeRows.rows.map((r) => [r.value, r.count]));
    return {
      priceMax: price?.max ?? 0,
      brands: brands.map((b) => ({ value: b.value!, label: b.label ?? b.value!, count: b.count })),
      genders: byOrder(
        genders.map((g) => ({ value: g.value ?? '', count: g.count })),
        GENDERS,
      ),
      sizes: sortSizes([...sizeCounts.keys()]).map((value) => ({ value, count: sizeCounts.get(value)! })),
      colors: byOrder(colorRows, COLOR_KEYS),
      materials: byOrder(materialRows, MATERIAL_KEYS),
      seasons: byOrder(seasonRows, SEASONS),
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
      ...this.filterFields(product),
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
          ...this.filterColumns(input),
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
        brand: patch.brand !== undefined ? patch.brand : current.brand,
        colorName: patch.colorName !== undefined ? patch.colorName : current.colorName,
        colors: patch.colors ?? current.colors,
        materialName: patch.materialName !== undefined ? patch.materialName : current.materialName,
        materials: patch.materials ?? current.materials,
        gender: patch.gender !== undefined ? patch.gender : current.gender,
        seasons: patch.seasons ?? current.seasons,
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
          ...this.filterColumns(merged),
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
