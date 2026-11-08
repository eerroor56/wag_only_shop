import { Check } from 'lucide-react';
import { CATALOG_SORT_LABELS, CATALOG_SORTS, type CatalogSort } from '@wag/shared';
import { BottomSheet, haptic } from '@wag/web';

/** Сортировка каталога и фильтр «Только в наличии» — нижняя панель, как на маркетплейсах. */
export function SortSheet({
  open,
  onClose,
  sort,
  inStock,
  onSort,
  onInStock,
}: {
  open: boolean;
  onClose: () => void;
  sort: CatalogSort;
  inStock: boolean;
  onSort: (sort: CatalogSort) => void;
  onInStock: (value: boolean) => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Сортировка">
      <div className="option-list" role="radiogroup" aria-label="Сортировка">
        {CATALOG_SORTS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={sort === value}
            className="option-row"
            onClick={() => {
              haptic.selection();
              onSort(value);
              onClose();
            }}
          >
            <span className="option-row-title">{CATALOG_SORT_LABELS[value]}</span>
            <span className="option-radio" aria-hidden>
              <Check size={14} strokeWidth={3} />
            </span>
          </button>
        ))}
      </div>

      <div className="option-list option-list-separated">
        <button
          type="button"
          role="switch"
          aria-checked={inStock}
          className="option-row"
          onClick={() => {
            haptic.selection();
            onInStock(!inStock);
          }}
        >
          <span className="option-row-text">
            <span className="option-row-title">Только в наличии</span>
            <span className="option-row-caption">Скрыть товары, которые закончились</span>
          </span>
          <span className="option-switch" aria-hidden />
        </button>
      </div>
    </BottomSheet>
  );
}
