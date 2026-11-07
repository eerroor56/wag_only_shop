/**
 * Бизнес-правило цен:
 *  - price — ФИНАЛЬНАЯ цена продажи. Её всегда задаёт администратор, система её не пересчитывает.
 *  - oldPrice — необязательная «старая» (зачёркнутая) цена, должна быть больше price.
 *  - discountPercent — необязательный процент, который администратор может указать вручную.
 *    Если не указан, процент вычисляется из oldPrice/price только для отображения.
 */

export interface PriceInfo {
  price: number;
  oldPrice: number | null;
  discountPercent: number | null;
}

/** Процент скидки для отображения или null, если скидки нет. */
export function effectiveDiscountPercent(p: PriceInfo): number | null {
  if (p.oldPrice == null || p.oldPrice <= p.price) return null;
  if (p.discountPercent != null && p.discountPercent > 0) return p.discountPercent;
  const pct = Math.round((1 - p.price / p.oldPrice) * 100);
  return pct > 0 ? pct : null;
}

/** Подсказка для админки: цена после скидки, округлённая до рубля. Финальное значение администратор может изменить. */
export function suggestPriceFromDiscount(oldPrice: number, percent: number): number {
  const raw = (oldPrice * (100 - percent)) / 100;
  return Math.round(raw / 100) * 100;
}
