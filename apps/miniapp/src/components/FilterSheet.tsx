import { useEffect, useState, type ReactNode } from 'react';
import {
  colorByKey,
  GENDER_LABELS,
  GENDERS,
  materialByKey,
  SEASON_LABELS,
  type CatalogFacetsDTO,
  type FacetValue,
} from '@wag/shared';
import { BottomSheet, ColorSwatch, haptic, plural, Spinner } from '@wag/web';
import { useCatalogCount, useFacets } from '../api/queries';
import { activeFiltersCount, EMPTY_ATTRIBUTES, type AttributeFilters } from '../catalog-filters';
import { PriceRange } from './PriceRange';

const BRANDS_COLLAPSED = 10;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Выбранные значения, которых нет в фасетах (например, из другой категории), тоже показываем — чтобы их можно было снять. */
function withSelected<T extends string>(facets: FacetValue<T>[], selected: readonly T[]): FacetValue<T>[] {
  const missing = selected.filter((v) => !facets.some((f) => f.value === v)).map((value) => ({ value, count: 0 }));
  return [...facets, ...missing];
}

const toggle = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="filter-section">
      <div className="filter-section-head">
        <h3 className="filter-section-title">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Панель фильтров каталога, как на маркетплейсах: цена (ползунок и поля), пол, бренд, размер, цвет,
 * материал, сезон, наличие. Изменения копятся в черновике; кнопка внизу показывает, сколько товаров найдётся.
 */
export function FilterSheet({
  open,
  onClose,
  categoryId,
  q,
  value,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  categoryId: number | null;
  q: string;
  value: AttributeFilters;
  onApply: (f: AttributeFilters) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [allBrands, setAllBrands] = useState(false);
  const { data: facets, isPending, isError, refetch } = useFacets(categoryId);

  // Каждое открытие — с текущих фильтров.
  useEffect(() => {
    if (open) {
      setDraft(value);
      setAllBrands(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const debounced = useDebounced(draft, 250);
  const count = useCatalogCount({ categoryId, q, ...debounced }, open);
  const settled = debounced === draft && !count.isPlaceholderData;

  const patch = (p: Partial<AttributeFilters>) => {
    haptic.selection();
    setDraft((d) => ({ ...d, ...p }));
  };

  const apply = () => {
    haptic.impact('light');
    onApply(draft);
    onClose();
  };

  const dirty = activeFiltersCount(draft) > 0;
  const total = count.data;
  const buttonText =
    total == null
      ? 'Показать товары'
      : total === 0
        ? 'Ничего не найдено'
        : `Показать ${total} ${plural(total, 'товар', 'товара', 'товаров')}`;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Фильтры"
      headerStart={
        dirty && (
          <button type="button" className="sheet-text-btn" onClick={() => patch(EMPTY_ATTRIBUTES)}>
            Сбросить
          </button>
        )
      }
      footer={
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={apply}>
          {!settled && count.isFetching ? <Spinner size={18} /> : buttonText}
        </button>
      }
    >
      {isPending ? (
        <div className="filter-state">
          <Spinner />
        </div>
      ) : isError || !facets ? (
        <div className="filter-state">
          <span className="caption">Не удалось загрузить фильтры</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refetch()}>
            Повторить
          </button>
        </div>
      ) : (
        <FilterBody
          facets={facets}
          draft={draft}
          patch={patch}
          // Ползунок сам даёт отклик на каждом шаге — без повторной вибрации.
          setPrice={(priceMin, priceMax) => setDraft((d) => ({ ...d, priceMin, priceMax }))}
          allBrands={allBrands}
          onAllBrands={() => setAllBrands(true)}
        />
      )}
    </BottomSheet>
  );
}

function FilterBody({
  facets,
  draft,
  patch,
  setPrice,
  allBrands,
  onAllBrands,
}: {
  facets: CatalogFacetsDTO;
  draft: AttributeFilters;
  patch: (p: Partial<AttributeFilters>) => void;
  setPrice: (min: number | null, max: number | null) => void;
  allBrands: boolean;
  onAllBrands: () => void;
}) {
  const brands = [
    ...facets.brands,
    ...draft.brands
      .filter((b) => !facets.brands.some((f) => f.value === b))
      .map((value) => ({ value, label: value, count: 0 })),
  ];
  const visibleBrands = allBrands || brands.length <= BRANDS_COLLAPSED + 2 ? brands : brands.slice(0, BRANDS_COLLAPSED);
  const sizes = withSelected(facets.sizes, draft.sizes);
  const colors = withSelected(facets.colors, draft.colors);
  const materials = withSelected(facets.materials, draft.materials);
  const seasons = withSelected(facets.seasons, draft.seasons);
  const reset = (shown: boolean, onReset: () => void) =>
    shown && (
      <button type="button" className="filter-section-reset" onClick={onReset}>
        Сбросить
      </button>
    );

  return (
    <div className="filter-body">
      {facets.priceMax > 0 && (
        <Section
          title="Цена"
          aside={reset(draft.priceMin != null || draft.priceMax != null, () => patch({ priceMin: null, priceMax: null }))}
        >
          <PriceRange
            max={Math.ceil(facets.priceMax / 100)}
            value={[draft.priceMin, draft.priceMax]}
            onChange={([priceMin, priceMax]) => setPrice(priceMin, priceMax)}
          />
        </Section>
      )}

      {(facets.genders.length > 0 || draft.gender) && (
        <Section title="Пол">
          <div className="filter-segmented" role="radiogroup" aria-label="Пол">
            {([null, ...GENDERS] as const).map((g) => (
              <button
                key={g ?? 'all'}
                type="button"
                role="radio"
                aria-checked={draft.gender === g}
                className="filter-segment"
                onClick={() => patch({ gender: g })}
              >
                {g ? GENDER_LABELS[g] : 'Все'}
              </button>
            ))}
          </div>
        </Section>
      )}

      {brands.length > 0 && (
        <Section title="Бренд" aside={reset(draft.brands.length > 0, () => patch({ brands: [] }))}>
          <div className="filter-chips">
            {visibleBrands.map((b) => (
              <button
                key={b.value}
                type="button"
                className="filter-chip"
                aria-pressed={draft.brands.includes(b.value)}
                onClick={() => patch({ brands: toggle(draft.brands, b.value) })}
              >
                {b.label}
                {b.count > 0 && <span className="filter-chip-count">{b.count}</span>}
              </button>
            ))}
            {visibleBrands.length < brands.length && (
              <button type="button" className="filter-chip filter-chip-more" onClick={onAllBrands}>
                Ещё {brands.length - visibleBrands.length}
              </button>
            )}
          </div>
        </Section>
      )}

      {sizes.length > 0 && (
        <Section title="Размер" aside={reset(draft.sizes.length > 0, () => patch({ sizes: [] }))}>
          <div className="filter-chips">
            {sizes.map((s) => (
              <button
                key={s.value}
                type="button"
                className="filter-chip filter-chip-size"
                aria-pressed={draft.sizes.includes(s.value)}
                onClick={() => patch({ sizes: toggle(draft.sizes, s.value) })}
              >
                {s.value}
              </button>
            ))}
          </div>
          <p className="filter-hint">Показываем товары, у которых этот размер есть в наличии.</p>
        </Section>
      )}

      {colors.length > 0 && (
        <Section title="Цвет" aside={reset(draft.colors.length > 0, () => patch({ colors: [] }))}>
          <div className="filter-colors">
            {colors.map((c) => {
              const on = draft.colors.includes(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  className="filter-color"
                  aria-pressed={on}
                  onClick={() => patch({ colors: toggle(draft.colors, c.value) })}
                >
                  <ColorSwatch colorKey={c.value} size={36} selected={on} />
                  <span>{colorByKey(c.value)?.label}</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {materials.length > 0 && (
        <Section title="Материал" aside={reset(draft.materials.length > 0, () => patch({ materials: [] }))}>
          <div className="filter-chips">
            {materials.map((m) => (
              <button
                key={m.value}
                type="button"
                className="filter-chip"
                aria-pressed={draft.materials.includes(m.value)}
                onClick={() => patch({ materials: toggle(draft.materials, m.value) })}
              >
                {materialByKey(m.value)?.label}
                {m.count > 0 && <span className="filter-chip-count">{m.count}</span>}
              </button>
            ))}
          </div>
        </Section>
      )}

      {seasons.length > 0 && (
        <Section title="Сезон" aside={reset(draft.seasons.length > 0, () => patch({ seasons: [] }))}>
          <div className="filter-chips">
            {seasons.map((s) => (
              <button
                key={s.value}
                type="button"
                className="filter-chip"
                aria-pressed={draft.seasons.includes(s.value)}
                onClick={() => patch({ seasons: toggle(draft.seasons, s.value) })}
              >
                {SEASON_LABELS[s.value]}
              </button>
            ))}
          </div>
        </Section>
      )}

      <div className="option-list option-list-separated">
        <button
          type="button"
          role="switch"
          aria-checked={draft.inStock}
          className="option-row"
          onClick={() => patch({ inStock: !draft.inStock })}
        >
          <span className="option-row-text">
            <span className="option-row-title">Только в наличии</span>
            <span className="option-row-caption">Скрыть товары, которые закончились</span>
          </span>
          <span className="option-switch" aria-hidden />
        </button>
      </div>
    </div>
  );
}
