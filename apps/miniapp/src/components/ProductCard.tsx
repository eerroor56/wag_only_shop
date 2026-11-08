import { Link } from 'react-router';
import { LOW_STOCK_THRESHOLD, stockTotal, type ProductCardDTO } from '@wag/shared';
import { PriceView, Skeleton } from '@wag/web';
import { ProductImage } from './ProductImage';

export function ProductCard({ product, eager = false }: { product: ProductCardDTO; eager?: boolean }) {
  const total = stockTotal(product.stock);
  const low = total != null && total > 0 && total <= LOW_STOCK_THRESHOLD;
  const stock = product.stock;
  // Закончившиеся размеры в списке размеров не показываем.
  const sizes = stock ? product.sizes.filter((s) => (stock[s] ?? 0) > 0) : product.sizes;
  return (
    <Link to={`/product/${product.id}`} className={`product-card ${product.soldOut ? 'is-soldout' : ''}`}>
      <div className="product-card-media">
        <ProductImage src={product.image?.thumbUrl} alt={product.title} eager={eager} />
        {product.soldOut ? (
          <span className="product-card-soldout">Нет в наличии</span>
        ) : (
          product.discountPercent != null && <span className="product-card-badge">−{product.discountPercent}%</span>
        )}
      </div>
      <div className="product-card-body">
        <div className="product-card-title line-clamp-2">{product.title}</div>
        <PriceView price={product.price} oldPrice={product.oldPrice} discountPercent={null} size="sm" />
        {!product.soldOut && sizes.length > 0 && <div className="product-card-sizes">{sizes.join(' · ')}</div>}
        {low && <div className="product-card-low">Осталось {total} шт.</div>}
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="product-card" aria-hidden>
      <Skeleton className="product-card-media" style={{ borderRadius: 12 }} />
      <div className="product-card-body">
        <Skeleton style={{ height: 14, width: '85%' }} />
        <Skeleton style={{ height: 14, width: '45%', marginTop: 8 }} />
      </div>
    </div>
  );
}
