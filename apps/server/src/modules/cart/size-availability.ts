import { sizeKey } from '@wag/shared';
import type { Product } from '../../db/schema.js';

/** '' в cart_items.size означает «без размера». */
export const NO_SIZE = '';

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

/** Почему позицию корзины нельзя оформить (null — можно). */
export function unavailableReason(product: Pick<Product, 'isActive' | 'sizes'>, size: string): 'hidden' | 'size' | null {
  if (!product.isActive) return 'hidden';
  return resolveSize(product, size) === null ? 'size' : null;
}
