import { ArrowUpDown, SearchX, Shirt, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  CATALOG_SORT_LABELS,
  colorByKey,
  GENDER_LABELS,
  materialByKey,
  SEASON_LABELS,
  type CatalogSort,
  type CategoryDTO,
} from '@wag/shared';
import { ColorSwatch, EmptyState, ErrorState, errorMessage, haptic, plural, Spinner } from '@wag/web';
import { useCatalog, useCategories, useFacets } from '../api/queries';
import {
  activeFiltersCount,
  attributesToUrl,
  EMPTY_ATTRIBUTES,
  readAttributes,
  readSort,
  type AttributeFilters,
} from '../catalog-filters';
import { CatalogSearch } from '../components/CatalogSearch';
import { FilterSheet } from '../components/FilterSheet';
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard';
import { SortSheet } from '../components/SortSheet';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';

const nf = new Intl.NumberFormat('ru-RU');

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

/**
 * Фильтры каталога хранятся в адресе (?c=&q=&sort=&pmin=&brand=…): «Назад» из карточки
 * возвращает их как были, а ссылкой с фильтрами можно поделиться.
 */
function useCatalogParams(categories: CategoryDTO[] | undefined) {
  const [params, setParams] = useSearchParams();

  const raw = Number(params.get('c'));
  const requested = Number.isInteger(raw) && raw > 0 ? raw : null;
  // Категория из ссылки, которой больше нет (опустела или удалена) — показываем весь каталог.
  const categoryId = requested != null && categories && !categories.some((c) => c.id === requested) ? null : requested;
  const sort = readSort(params);
  const q = params.get('q') ?? '';
  const paramsKey = params.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const attributes = useMemo(() => readAttributes(params), [paramsKey]);

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

  return { categoryId, sort, q, attributes, update };
}

interface ActiveChip {
  key: string;
  label: ReactNode;
  remove: () => void;
}

export function CatalogPage() {
  const { data: categories } = useCategories();
  const { categoryId, sort, q, attributes, update } = useCatalogParams(categories);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { data: facets } = useFacets(categoryId);

  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isPlaceholderData } =
    useCatalog({ categoryId, sort, q, ...attributes });
  const sentinel = useInfiniteScroll(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, Boolean(hasNextPage));

  const products = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  const current = categories?.find((c) => c.id === categoryId);
  const filtersCount = activeFiltersCount(attributes);

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const onSearch = useCallback((value: string) => update({ q: value || null }), [update]);
  const setAttributes = (next: AttributeFilters) => {
    update(attributesToUrl(next));
    scrollTop();
  };
  const without = (p: Partial<AttributeFilters>) => () => {
    haptic.selection();
    setAttributes({ ...attributes, ...p });
  };
  const resetAll = () => {
    haptic.selection();
    update({ ...attributesToUrl(EMPTY_ATTRIBUTES), sort: null });
  };

  // Включённые фильтры — строкой «чипов» под поиском, каждый снимается крестиком.
  const chips: ActiveChip[] = [];
  if (sort !== 'default') {
    chips.push({ key: 'sort', label: CATALOG_SORT_LABELS[sort], remove: () => update({ sort: null }) });
  }
  const { priceMin, priceMax } = attributes;
  if (priceMin != null || priceMax != null) {
    chips.push({
      key: 'price',
      label:
        priceMin != null && priceMax != null
          ? `${nf.format(priceMin)} – ${nf.format(priceMax)} ₽`
          : priceMin != null
            ? `от ${nf.format(priceMin)} ₽`
            : `до ${nf.format(priceMax!)} ₽`,
      remove: without({ priceMin: null, priceMax: null }),
    });
  }
  if (attributes.gender) {
    chips.push({ key: 'gender', label: GENDER_LABELS[attributes.gender], remove: without({ gender: null }) });
  }
  for (const b of attributes.brands) {
    chips.push({
      key: `brand-${b}`,
      label: facets?.brands.find((f) => f.value === b)?.label ?? b,
      remove: without({ brands: attributes.brands.filter((x) => x !== b) }),
    });
  }
  for (const s of attributes.sizes) {
    chips.push({ key: `size-${s}`, label: `Размер ${s}`, remove: without({ sizes: attributes.sizes.filter((x) => x !== s) }) });
  }
  for (const c of attributes.colors) {
    chips.push({
      key: `color-${c}`,
      label: (
        <>
          <ColorSwatch colorKey={c} size={14} />
          {colorByKey(c)?.label}
        </>
      ),
      remove: without({ colors: attributes.colors.filter((x) => x !== c) }),
    });
  }
  for (const m of attributes.materials) {
    chips.push({
      key: `mat-${m}`,
      label: materialByKey(m)?.label,
      remove: without({ materials: attributes.materials.filter((x) => x !== m) }),
    });
  }
  for (const s of attributes.seasons) {
    chips.push({ key: `season-${s}`, label: SEASON_LABELS[s], remove: without({ seasons: attributes.seasons.filter((x) => x !== s) }) });
  }
  if (attributes.inStock) chips.push({ key: 'stock', label: 'В наличии', remove: without({ inStock: false }) });

  const narrowed = categoryId != null || filtersCount > 0;

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
            className={`tool-button ${filtersCount ? 'is-active' : ''}`}
            aria-label={filtersCount ? `Фильтры: включено ${filtersCount}` : 'Фильтры'}
            onClick={() => {
              haptic.impact('light');
              setFiltersOpen(true);
            }}
          >
            <SlidersHorizontal size={18} strokeWidth={2} />
            {filtersCount > 0 && <span className="tool-button-badge">{filtersCount}</span>}
          </button>
          <button
            type="button"
            className={`tool-button ${sort !== 'default' ? 'is-active' : ''}`}
            aria-label={`Сортировка: ${CATALOG_SORT_LABELS[sort]}`}
            onClick={() => {
              haptic.impact('light');
              setSortOpen(true);
            }}
          >
            <ArrowUpDown size={18} strokeWidth={2} />
          </button>
        </div>
        {chips.length > 0 && (
          <div className="active-filters" role="group" aria-label="Включённые фильтры">
            {chips.length > 1 && (
              <button type="button" className="active-filter-reset" onClick={resetAll}>
                Сбросить
              </button>
            )}
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="active-filter"
                onClick={() => {
                  chip.remove();
                  scrollTop();
                }}
              >
                {chip.label}
                <X size={13} strokeWidth={2.4} aria-label="убрать" />
              </button>
            ))}
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
        onSort={(value: CatalogSort) => {
          update({ sort: value === 'default' ? null : value });
          scrollTop();
        }}
      />
      <FilterSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        categoryId={categoryId}
        q={q}
        value={attributes}
        onApply={setAttributes}
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
            text={`По запросу «${q}» товаров нет${narrowed ? ' с выбранными фильтрами' : ''}.`}
            action={
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => update({ q: null, c: null, ...attributesToUrl(EMPTY_ATTRIBUTES) })}
              >
                Сбросить поиск
              </button>
            }
          />
        ) : filtersCount > 0 ? (
          <EmptyState
            icon={<SlidersHorizontal size={28} strokeWidth={1.5} />}
            title="Под фильтры ничего не подошло"
            text="Попробуйте убрать часть фильтров или расширить диапазон цены."
            action={
              <button type="button" className="btn btn-secondary" onClick={resetAll}>
                Сбросить фильтры
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<Shirt size={28} strokeWidth={1.5} />}
            title={categoryId != null ? 'Здесь пока пусто' : 'Каталог пока пуст'}
            text="Новые вещи скоро появятся — загляните позже."
            action={
              categoryId != null && (
                <button type="button" className="btn btn-secondary" onClick={() => update({ c: null })}>
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
            key={`${categoryId ?? 'all'}-${sort}-${JSON.stringify(attributes)}`}
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
