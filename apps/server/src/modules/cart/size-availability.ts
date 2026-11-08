import { availableStock, sizeKey } from '@wag/shared';
import type { Product } from '../../db/schema.js';

/** '' в cart_items.size означает «без размера». */
export const NO_SIZE = '';

export type UnavailableReason = 'hidden' | 'size' | 'soldout' | 'stock';

/**
 * Каноничное написание размера из списка товара или null, если такого размера нет.
 * Для товара без размеров допустим только NO_SIZE.
 */
export function resolveSize(product: Pick<Product, 'sizes'>, size: string | null | undefined): string | null {
  const requested = size?.trim() ?? NO_SIZE;
  if (!product.sizes.length) return requested === NO_SIZE ? NO_SIZE : null;
  if (requested === NO_SIZE) return null;
  return product.sizes.find((s) => sizeKey(s) === sizeKey(requested)) ?? null;
}

/** Сколько штук размера можно купить; null — остатки не учитываются. */
export function maxQuantityFor(product: Pick<Product, 'sizes' | 'stock'>, size: string): number | null {
  const resolved = resolveSize(product, size);
  if (resolved === null) return 0;
  return availableStock(product.stock, resolved || null);
}

/** Почему позицию корзины нельзя оформить (null — можно). */
export function unavailableReason(
  product: Pick<Product, 'isActive' | 'sizes' | 'stock'>,
  size: string,
  quantity: number,
): UnavailableReason | null {
  if (!product.isActive) return 'hidden';
  if (resolveSize(product, size) === null) return 'size';
  const max = maxQuantityFor(product, size);
  if (max === null) return null;
  if (max === 0) return 'soldout';
  return quantity > max ? 'stock' : null;
}

/** Текст ошибки, когда запрошено больше, чем есть в наличии. */
export function stockLimitMessage(title: string, size: string, max: number): string {
  const name = size ? `${title}, размер ${size}` : title;
  return max === 0 ? `${name}: товар закончился` : `${name}: в наличии только ${max} шт.`;
}
