import { asc, eq, inArray } from 'drizzle-orm';
import { NO_SIZE_STOCK_KEY, sizeKey, stockTotal, type ProductStock } from '@wag/shared';
import type { Database, DbExecutor } from '../../db/client.js';
import { products } from '../../db/schema.js';

export interface StockChange {
  productId: number | null;
  /** null / '' — товар без размеров. */
  size: string | null;
  /** Отрицательное — списание, положительное — возврат на склад. */
  delta: number;
}

export interface StockShortage {
  productId: number;
  title: string;
  size: string | null;
  available: number;
}

/**
 * Изменяет остатки под блокировкой строк товаров (FOR UPDATE, по возрастанию id — без взаимных блокировок).
 * Товары без учёта остатков и удалённые размеры пропускаются.
 * При нехватке хотя бы одной позиции ничего не меняет и возвращает список нехваток.
 */
export async function applyStockChanges(tx: DbExecutor, changes: StockChange[]): Promise<StockShortage[]> {
  const ids = [...new Set(changes.map((c) => c.productId).filter((id): id is number => id != null))];
  if (!ids.length) return [];

  const rows = await (tx as Database)
    .select({ id: products.id, title: products.title, stock: products.stock })
    .from(products)
    .where(inArray(products.id, ids))
    .orderBy(asc(products.id))
    .for('update');

  const next = new Map<number, ProductStock>();
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  for (const r of rows) if (r.stock) next.set(r.id, { ...r.stock });

  const shortages: StockShortage[] = [];
  for (const change of changes) {
    if (change.productId == null) continue;
    const stock = next.get(change.productId);
    if (!stock) continue;
    const wanted = change.size || NO_SIZE_STOCK_KEY;
    const key = Object.keys(stock).find((k) => sizeKey(k) === sizeKey(wanted));
    if (key === undefined) continue;
    const value = stock[key]! + change.delta;
    if (value < 0) {
      shortages.push({
        productId: change.productId,
        title: titles.get(change.productId) ?? '',
        size: key || null,
        available: stock[key]!,
      });
      continue;
    }
    stock[key] = value;
  }
  if (shortages.length) return shortages;

  for (const [id, stock] of next) {
    await tx.update(products).set({ stock, stockTotal: stockTotal(stock) }).where(eq(products.id, id));
  }
  return [];
}

/** Человекочитаемый список нехваток для сообщения об ошибке. */
export function describeShortages(list: StockShortage[]): string {
  return list
    .map((s) => {
      const name = s.size ? `${s.title} (${s.size})` : s.title;
      return s.available > 0 ? `${name} — осталось ${s.available} шт.` : `${name} — закончился`;
    })
    .join('; ');
}
