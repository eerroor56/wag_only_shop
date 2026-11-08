import { Shirt } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import type { CategoryDTO } from '@wag/shared';
import { EmptyState, ErrorState, errorMessage, haptic, plural, Spinner } from '@wag/web';
import { useCatalog, useCategories } from '../api/queries';
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

/** Липкая лента категорий над сеткой товаров. Выбранная категория прокручивается в зону видимости. */
function CategoryBar({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryDTO[];
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = scroller.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const item = (id: number | null, name: string, count: number | null) => (
    <button
      key={id ?? 'all'}
      type="button"
      className="category-pill"
      aria-pressed={selected === id}
      onClick={() => {
        if (selected === id) return;
        haptic.selection();
        onSelect(id);
      }}
    >
      {name}
      {count != null && <span className="category-pill-count">{count}</span>}
    </button>
  );

  return (
    <div className="category-bar">
      <div className="category-bar-scroll" ref={scroller} role="group" aria-label="Категории">
        {item(null, 'Все', null)}
        {categories.map((c) => item(c.id, c.name, c.productsCount))}
      </div>
    </div>
  );
}

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const { data: categories } = useCategories();

  const raw = Number(params.get('c'));
  const requested = Number.isInteger(raw) && raw > 0 ? raw : null;
  // Категория из ссылки, которой больше нет (опустела или удалена) — показываем весь каталог.
  const categoryId = requested != null && categories && !categories.some((c) => c.id === requested) ? null : requested;

  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useCatalog(categoryId);
  const sentinel = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, Boolean(hasNextPage));

  const products = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const current = categories?.find((c) => c.id === categoryId);

  const selectCategory = (id: number | null) => {
    // replace: переключение фильтра не засоряет историю — «Назад» из карточки вернёт в каталог с тем же фильтром.
    setParams(id == null ? {} : { c: String(id) }, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="container">
      <header className="page-header">
        <h1 className="title">{current?.name ?? 'Каталог'}</h1>
        {!isPending && !isError && (
          <span className="caption">
            {total} {plural(total, 'товар', 'товара', 'товаров')}
          </span>
        )}
      </header>

      {categories && categories.length > 0 && (
        <CategoryBar categories={categories} selected={categoryId} onSelect={selectCategory} />
      )}

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
          title={categoryId != null ? 'В этой категории пока пусто' : 'Каталог пока пуст'}
          text="Новые вещи скоро появятся — загляните позже."
          action={
            categoryId != null && (
              <button type="button" className="btn btn-secondary" onClick={() => selectCategory(null)}>
                Смотреть все товары
              </button>
            )
          }
        />
      ) : (
        <>
          {/* key — сетка плавно появляется заново при смене категории */}
          <div className="product-grid page-enter" key={categoryId ?? 'all'}>
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
