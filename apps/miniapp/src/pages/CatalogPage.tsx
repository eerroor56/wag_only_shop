import { ArrowUpDown, SearchX, Shirt } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CATALOG_SORT_LABELS, CATALOG_SORTS, type CatalogSort, type CategoryDTO } from '@wag/shared';
import { EmptyState, ErrorState, errorMessage, haptic, plural, Spinner } from '@wag/web';
import { useCatalog, useCategories } from '../api/queries';
import { CatalogSearch } from '../components/CatalogSearch';
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard';
import { SortSheet } from '../components/SortSheet';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

/** Лента категорий. Выбранная категория прокручивается в зону видимости. */
function CategoryPills({
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
    <div className="category-bar-scroll" ref={scroller} role="group" aria-label="Категории">
      {item(null, 'Все', null)}
      {categories.map((c) => item(c.id, c.name, c.productsCount))}
    </div>
  );
}

/** Фильтры каталога хранятся в адресе (?c=&q=&sort=&stock=1): «Назад» из карточки возвращает их как были. */
function useCatalogParams(categories: CategoryDTO[] | undefined) {
  const [params, setParams] = useSearchParams();

  const raw = Number(params.get('c'));
  const requested = Number.isInteger(raw) && raw > 0 ? raw : null;
  // Категория из ссылки, которой больше нет (опустела или удалена) — показываем весь каталог.
  const categoryId = requested != null && categories && !categories.some((c) => c.id === requested) ? null : requested;
  const sortParam = params.get('sort') as CatalogSort | null;
  const sort: CatalogSort = sortParam && CATALOG_SORTS.includes(sortParam) ? sortParam : 'default';
  const q = params.get('q') ?? '';
  const inStock = params.get('stock') === '1';

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        // replace: смена фильтра не засоряет историю переходов.
        { replace: true },
      );
    },
    [setParams],
  );

  return { categoryId, sort, q, inStock, update };
}

export function CatalogPage() {
  const { data: categories } = useCategories();
  const { categoryId, sort, q, inStock, update } = useCatalogParams(categories);
  const [sortOpen, setSortOpen] = useState(false);

  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData } =
    useCatalog({ categoryId, sort, q, inStock });
  const sentinel = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, Boolean(hasNextPage));

  const products = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const current = categories?.find((c) => c.id === categoryId);
  const filtersActive = sort !== 'default' || inStock;

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const onSearch = useCallback((value: string) => update({ q: value || null }), [update]);

  return (
    <div className="container">
      <header className="page-header">
        <h1 className="title">{current?.name ?? 'Каталог'}</h1>
        {!isPending && !isError && (
          <span className="caption">
            {isPlaceholderData ? <Spinner size={14} /> : `${total} ${plural(total, 'товар', 'товара', 'товаров')}`}
          </span>
        )}
      </header>

      <div className="category-bar">
        <div className="catalog-tools">
          <CatalogSearch value={q} onChange={onSearch} />
          <button
            type="button"
            className={`sort-button ${filtersActive ? 'is-active' : ''}`}
            aria-label={`Сортировка: ${CATALOG_SORT_LABELS[sort]}${inStock ? ', только в наличии' : ''}`}
            onClick={() => {
              haptic.impact('light');
              setSortOpen(true);
            }}
          >
            <ArrowUpDown size={18} strokeWidth={2} />
          </button>
        </div>
        {filtersActive && (
          <div className="active-filters">
            {sort !== 'default' && <span>{CATALOG_SORT_LABELS[sort]}</span>}
            {inStock && <span>в наличии</span>}
            <button type="button" onClick={() => update({ sort: null, stock: null })}>
              Сбросить
            </button>
          </div>
        )}
        {categories && categories.length > 0 && (
          <CategoryPills
            categories={categories}
            selected={categoryId}
            onSelect={(id) => {
              update({ c: id == null ? null : String(id) });
              scrollTop();
            }}
          />
        )}
      </div>

      <SortSheet
        open={sortOpen}
        onClose={() => setSortOpen(false)}
        sort={sort}
        inStock={inStock}
        onSort={(value) => {
          update({ sort: value === 'default' ? null : value });
          scrollTop();
        }}
        onInStock={(value) => update({ stock: value ? '1' : null })}
      />

      {isPending ? (
        <div className="product-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : products.length === 0 ? (
        q ? (
          <EmptyState
            icon={<SearchX size={28} strokeWidth={1.5} />}
            title="Ничего не нашлось"
            text={`По запросу «${q}» товаров нет${categoryId != null ? ' в этой категории' : ''}.`}
            action={
              <button type="button" className="btn btn-secondary" onClick={() => update({ q: null, c: null })}>
                Сбросить поиск
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<Shirt size={28} strokeWidth={1.5} />}
            title={categoryId != null || inStock ? 'Здесь пока пусто' : 'Каталог пока пуст'}
            text="Новые вещи скоро появятся — загляните позже."
            action={
              (categoryId != null || inStock) && (
                <button type="button" className="btn btn-secondary" onClick={() => update({ c: null, stock: null })}>
                  Смотреть все товары
                </button>
              )
            }
          />
        )
      ) : (
        <>
          {/* key — сетка плавно появляется заново при смене фильтров */}
          <div
            className={`product-grid page-enter ${isPlaceholderData ? 'is-refreshing' : ''}`}
            key={`${categoryId ?? 'all'}-${sort}-${inStock}`}
          >
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
