import { and, asc, count, eq, sql } from 'drizzle-orm';
import { categoryNameKey, LIMITS, type AdminCategoryDTO, type CategoryDTO } from '@wag/shared';
import type { Database, DbExecutor } from '../../db/client.js';
import { categories, products } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === UNIQUE_VIOLATION || e?.cause?.code === UNIQUE_VIOLATION;
}

const duplicate = () => conflict('CATEGORY_EXISTS', 'Категория с таким названием уже есть');

/** Категории (группы) товаров: Кроссовки, Худи… Порядок задаёт администратор, он же — порядок фильтров в каталоге. */
export class CategoriesService {
  constructor(private readonly db: Database) {}

  /** Для покупателя: только категории, в которых есть товары в продаже (inner join отсекает пустые). */
  async listPublic(): Promise<CategoryDTO[]> {
    const productsCount = count(products.id);
    return this.db
      .select({ id: categories.id, name: categories.name, productsCount })
      .from(categories)
      .innerJoin(products, and(eq(products.categoryId, categories.id), eq(products.isActive, true)))
      .groupBy(categories.id)
      .orderBy(asc(categories.sortOrder), asc(categories.id));
  }

  async adminList(): Promise<AdminCategoryDTO[]> {
    return this.db
      .select({
        id: categories.id,
        name: categories.name,
        productsCount: sql<number>`count(${products.id})::int`,
        activeCount: sql<number>`count(${products.id}) FILTER (WHERE ${products.isActive})::int`,
      })
      .from(categories)
      .leftJoin(products, eq(products.categoryId, categories.id))
      .groupBy(categories.id)
      .orderBy(asc(categories.sortOrder), asc(categories.id));
  }

  private async adminGet(id: number): Promise<AdminCategoryDTO> {
    const found = (await this.adminList()).find((c) => c.id === id);
    if (!found) throw notFound('Категория не найдена');
    return found;
  }

  async create(name: string): Promise<AdminCategoryDTO> {
    const id = await this.db.transaction(async (tx) => {
      // Блокировка от гонки при одновременном создании: лимит и порядок считаются атомарно.
      await tx.execute(sql`LOCK TABLE ${categories} IN SHARE ROW EXCLUSIVE MODE`);
      const [stats] = await tx
        .select({ n: count(), maxOrder: sql<number | null>`max(${categories.sortOrder})` })
        .from(categories);
      if ((stats?.n ?? 0) >= LIMITS.categoriesMax) {
        throw badRequest(`Можно создать не более ${LIMITS.categoriesMax} категорий`);
      }
      try {
        const [row] = await tx
          .insert(categories)
          .values({ name, nameKey: categoryNameKey(name), sortOrder: (stats?.maxOrder ?? 0) + 1 })
          .returning({ id: categories.id });
        return row!.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicate();
        throw err;
      }
    });
    return this.adminGet(id);
  }

  async rename(id: number, name: string): Promise<AdminCategoryDTO> {
    try {
      const updated = await this.db
        .update(categories)
        .set({ name, nameKey: categoryNameKey(name) })
        .where(eq(categories.id, id))
        .returning({ id: categories.id });
      if (!updated.length) throw notFound('Категория не найдена');
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate();
      throw err;
    }
    return this.adminGet(id);
  }

  /** Товары категории остаются в каталоге без категории (FK ON DELETE SET NULL). */
  async delete(id: number): Promise<void> {
    const deleted = await this.db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id });
    if (!deleted.length) throw notFound('Категория не найдена');
  }

  /** Полный порядок категорий: ids в нужной последовательности, неуказанные — после них. */
  async reorder(ids: number[]): Promise<void> {
    if (new Set(ids).size !== ids.length) throw badRequest('Категории в списке повторяются');
    await this.db.transaction(async (tx) => {
      const all = await tx
        .select({ id: categories.id })
        .from(categories)
        .orderBy(asc(categories.sortOrder), asc(categories.id))
        .for('update');
      const known = new Set(all.map((r) => r.id));
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length) throw badRequest(`Категории не найдены: ${unknown.join(', ')}`);
      const listed = new Set(ids);
      const finalOrder = [...ids, ...all.map((r) => r.id).filter((id) => !listed.has(id))];
      for (const [index, id] of finalOrder.entries()) {
        await tx.update(categories).set({ sortOrder: index + 1 }).where(eq(categories.id, id));
      }
    });
  }

  /** Проверка, что категория существует (при сохранении товара). */
  async assertExists(db: DbExecutor, id: number | null): Promise<void> {
    if (id == null) return;
    const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).for('share');
    if (!row) {
      throw badRequest('Категория не найдена — возможно, её удалили. Выберите другую.', [
        { path: 'categoryId', message: 'Категория не найдена' },
      ]);
    }
  }
}
