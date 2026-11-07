import { Shirt } from 'lucide-react';
import { EmptyState, ErrorState, errorMessage, plural, Spinner } from '@wag/web';
import { useCatalog } from '../api/queries';
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

export function CatalogPage() {
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useCatalog();
  const sentinel = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, Boolean(hasNextPage));

  const products = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="container">
      <header className="page-header">
        <h1 className="title">Каталог</h1>
        {!isPending && !isError && (
          <span className="caption">
            {total} {plural(total, 'товар', 'товара', 'товаров')}
          </span>
        )}
      </header>

      {isPending ? (
        <div className="product-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={<Shirt size={28} strokeWidth={1.5} />}
          title="Каталог пока пуст"
          text="Новые вещи скоро появятся — загляните позже."
        />
      ) : (
        <>
          <div className="product-grid">
            {products.map((p, i) => (
              <ProductCard key={p.id} product={p} eager={i < 4} />
            ))}
          </div>
          <div ref={sentinel} className="grid-sentinel">
            {isFetchingNextPage && <Spinner />}
          </div>
        </>
      )}
    </div>
  );
}
