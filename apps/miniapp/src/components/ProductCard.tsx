import { Link } from 'react-router';
import type { ProductCardDTO } from '@wag/shared';
import { PriceView, Skeleton } from '@wag/web';
import { ProductImage } from './ProductImage';

export function ProductCard({ product, eager = false }: { product: ProductCardDTO; eager?: boolean }) {
  return (
    <Link to={`/product/${product.id}`} className="product-card">
      <div className="product-card-media">
        <ProductImage src={product.image?.thumbUrl} alt={product.title} eager={eager} />
        {product.discountPercent != null && <span className="product-card-badge">−{product.discountPercent}%</span>}
      </div>
      <div className="product-card-body">
        <div className="product-card-title line-clamp-2">{product.title}</div>
        <PriceView price={product.price} oldPrice={product.oldPrice} discountPercent={null} size="sm" />
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
