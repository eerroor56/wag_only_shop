import { Check } from 'lucide-react';
import { CATALOG_SORT_LABELS, CATALOG_SORTS, type CatalogSort } from '@wag/shared';
import { BottomSheet, haptic } from '@wag/web';

/** Сортировка каталога — нижняя панель, как на маркетплейсах. */
export function SortSheet({
  open,
  onClose,
  sort,
  onSort,
}: {
  open: boolean;
  onClose: () => void;
  sort: CatalogSort;
  onSort: (sort: CatalogSort) => void;
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
    </BottomSheet>
  );
}
