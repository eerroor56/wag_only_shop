import { ArrowDown, ArrowUp, Eye, EyeOff, FolderCog, ImageOff, Package, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatPrice, type AdminProductDTO } from '@wag/shared';
import { EmptyState, ErrorState, errorMessage, haptic, useToast } from '@wag/web';
import { useAdminCategories, useAdminProducts, usePatchProduct, useReorderProducts } from '../api/queries';
import { CategorySheet } from '../components/CategoryPicker';
import { ListSkeleton, PageHeader } from '../components/common';

type Filter = 'all' | 'active' | 'hidden';
/** all — все товары, none — без категории, число — id категории. */
type CategoryFilter = 'all' | 'none' | number;

function ProductRow({
  product,
  categoryName,
  sorting,
  index,
  total,
  onMove,
}: {
  product: AdminProductDTO;
  categoryName: string | null;
  sorting: boolean;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
}) {
  const toast = useToast();
  const patch = usePatchProduct();
  const thumb = product.images.find((i) => i.isMain) ?? product.images[0];

  const toggle = () => {
    haptic.impact('light');
    patch.mutate(
      { id: product.id, patch: { isActive: !product.isActive } },
      {
        onSuccess: (p) => toast.success(p.isActive ? 'Товар возвращён в каталог' : 'Товар скрыт из каталога'),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <div className={`list-row ${product.isActive ? '' : 'is-muted'}`}>
      <Link to={`/products/${product.id}`} className="list-row-main">
        <div className="thumb">
          {thumb ? <img src={thumb.thumbUrl} alt="" loading="lazy" /> : <ImageOff size={18} strokeWidth={1.5} />}
        </div>
        <div className="list-row-text">
          <div className="list-row-title line-clamp-2">{product.title}</div>
          <div className="list-row-meta">
            {categoryName && <span className="list-row-category">{categoryName}</span>}
            <span>{formatPrice(product.price)}</span>
            {product.oldPrice != null && <s>{formatPrice(product.oldPrice)}</s>}
            {product.effectiveDiscountPercent != null && <span>−{product.effectiveDiscountPercent}%</span>}
            <span>· {product.images.length} фото</span>
            {product.sizes.length > 0 && <span>· {product.sizes.join(', ')}</span>}
          </div>
          {!product.isActive && <span className="pill">Скрыт</span>}
        </div>
      </Link>
      {sorting ? (
        <div className="row-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Выше"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
          >
            <ArrowUp size={17} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Ниже"
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowDown size={17} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="icon-btn"
          aria-label={product.isActive ? 'Скрыть из каталога' : 'Вернуть в каталог'}
          title={product.isActive ? 'Скрыть из каталога' : 'Вернуть в каталог'}
          onClick={toggle}
        >
          {product.isActive ? <Eye size={17} /> : <EyeOff size={17} />}
        </button>
      )}
    </div>
  );
}

export function ProductsPage() {
  const toast = useToast();
  const { data, isPending, isError, error, refetch } = useAdminProducts();
  const reorder = useReorderProducts();
  const [filter, setFilter] = useState<Filter>('all');
  const [sorting, setSorting] = useState(false);
  const { data: categories } = useAdminCategories();
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [manageCategories, setManageCategories] = useState(false);

  const all = data?.items ?? [];
  const categoryNames = new Map((categories ?? []).map((c) => [c.id, c.name]));
  // Выбранную категорию удалили — показываем все товары.
  const activeCategory = typeof category === 'number' && !categoryNames.has(category) ? 'all' : category;
  const withoutCategory = all.filter((p) => p.categoryId == null).length;
  const items = all.filter(
    (p) =>
      (filter === 'all' || (filter === 'active' ? p.isActive : !p.isActive)) &&
      (activeCategory === 'all' || (activeCategory === 'none' ? p.categoryId == null : p.categoryId === activeCategory)),
  );
  const canSort = filter === 'all' && activeCategory === 'all';

  const move = (from: number, to: number) => {
    const ids = all.map((p) => p.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    haptic.selection();
    reorder.mutate(ids, { onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <div className="container">
      <PageHeader
        title="Товары"
        subtitle={data && `Всего ${data.counts.total} · в каталоге ${data.counts.active} · скрыто ${data.counts.hidden}`}
        action={
          <Link to="/products/new" className="btn btn-primary btn-sm">
            <Plus size={16} strokeWidth={2.2} />
            Добавить
          </Link>
        }
      />

      <div className="toolbar">
        <div className="chips">
          {(
            [
              ['all', 'Все'],
              ['active', 'В каталоге'],
              ['hidden', 'Скрытые'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                if (value !== 'all') setSorting(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {canSort && all.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSorting((s) => !s)}>
            {sorting ? 'Готово' : 'Порядок'}
          </button>
        )}
      </div>

      <div className="chips category-chips" role="group" aria-label="Категории">
        <button
          type="button"
          className="chip"
          aria-pressed={activeCategory === 'all'}
          onClick={() => setCategory('all')}
        >
          Все категории
        </button>
        {(categories ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip"
            aria-pressed={activeCategory === c.id}
            onClick={() => {
              setCategory(c.id);
              setSorting(false);
            }}
          >
            {c.name}
            <span className="chip-count">{c.productsCount}</span>
          </button>
        ))}
        {withoutCategory > 0 && (categories?.length ?? 0) > 0 && (
          <button
            type="button"
            className="chip"
            aria-pressed={activeCategory === 'none'}
            onClick={() => {
              setCategory('none');
              setSorting(false);
            }}
          >
            Без категории
            <span className="chip-count">{withoutCategory}</span>
          </button>
        )}
        <button type="button" className="chip chip-action" onClick={() => setManageCategories(true)}>
          <FolderCog size={15} strokeWidth={1.8} />
          {categories?.length ? 'Категории' : 'Создать категории'}
        </button>
      </div>
      <CategorySheet open={manageCategories} onClose={() => setManageCategories(false)} mode="manage" />

      {sorting && <p className="caption hint-line">Порядок сохраняется сразу и совпадает с порядком в каталоге.</p>}

      {isPending ? (
        <ListSkeleton />
      ) : isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Package size={26} strokeWidth={1.5} />}
          title={all.length ? 'Нет товаров в этом разделе' : 'Товаров пока нет'}
          action={
            !all.length && (
              <Link to="/products/new" className="btn btn-primary">
                Добавить первый товар
              </Link>
            )
          }
        />
      ) : (
        <div className="list">
          {items.map((p, i) => (
            <ProductRow
              key={p.id}
              product={p}
              categoryName={activeCategory === 'all' && p.categoryId != null ? (categoryNames.get(p.categoryId) ?? null) : null}
              sorting={sorting}
              index={i}
              total={items.length}
              onMove={move}
            />
          ))}
        </div>
      )}
    </div>
  );
}
