import { Check, ChevronDown, ChevronsUpDown, ChevronUp, FolderOpen, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { categoryNameKey, categoryNameSchema, LIMITS, type AdminCategoryDTO } from '@wag/shared';
import { BottomSheet, confirmDialog, errorMessage, haptic, plural, Spinner, useToast } from '@wag/web';
import { useAdminCategories, useCategoryMutations } from '../api/queries';

function countCaption(c: AdminCategoryDTO): string {
  if (c.productsCount === 0) return 'Нет товаров';
  const hidden = c.productsCount - c.activeCount;
  const total = `${c.productsCount} ${plural(c.productsCount, 'товар', 'товара', 'товаров')}`;
  return hidden > 0 ? `${total} · ${hidden} ${plural(hidden, 'скрыт', 'скрыто', 'скрыто')}` : total;
}

function CategoryAvatar({ name }: { name: string }) {
  return (
    <span className="cat-avatar" aria-hidden>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Панель категорий. mode = pick — выбор категории товара (с поиском и созданием новой),
 * manage — управление: переименование, порядок, удаление.
 */
export function CategorySheet({
  open,
  onClose,
  mode,
  value = null,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'pick' | 'manage';
  value?: number | null;
  onChange?: (id: number | null) => void;
}) {
  const toast = useToast();
  const { data: categories, isPending, isError, error, refetch } = useAdminCategories();
  const { create, rename, remove, reorder } = useCategoryMutations();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(mode === 'manage');
  const [renaming, setRenaming] = useState<{ id: number; draft: string } | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);

  // Каждое открытие — с чистого листа.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setEditing(mode === 'manage');
    setRenaming(null);
  }, [open, mode]);

  useEffect(() => {
    if (renaming) renameInput.current?.focus();
  }, [renaming?.id]);

  const list = categories ?? [];
  const key = categoryNameKey(query);
  const filtered = key ? list.filter((c) => categoryNameKey(c.name).includes(key)) : list;
  const exact = key ? list.find((c) => categoryNameKey(c.name) === key) : undefined;
  const canCreate = Boolean(key) && !exact && list.length < LIMITS.categoriesMax;

  const pick = (id: number | null) => {
    haptic.selection();
    onChange?.(id);
    onClose();
  };

  const onCreate = () => {
    const parsed = categoryNameSchema.safeParse(query);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Некорректное название');
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: (created) => {
        haptic.notify('success');
        if (mode === 'pick' && !editing) {
          toast.success(`Категория «${created.name}» создана`);
          pick(created.id);
        } else {
          setQuery('');
          toast.success('Категория создана');
        }
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (exact && mode === 'pick' && !editing) pick(exact.id);
    else if (canCreate && !create.isPending) onCreate();
  };

  const saveRename = () => {
    if (!renaming) return;
    const current = list.find((c) => c.id === renaming.id);
    const parsed = categoryNameSchema.safeParse(renaming.draft);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Некорректное название');
      return;
    }
    if (current?.name === parsed.data) {
      setRenaming(null);
      return;
    }
    rename.mutate(
      { id: renaming.id, name: parsed.data },
      {
        onSuccess: () => {
          setRenaming(null);
          haptic.notify('success');
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const onDelete = async (c: AdminCategoryDTO) => {
    const ok = await confirmDialog(
      c.productsCount
        ? `Удалить категорию «${c.name}»? ${c.productsCount} ${plural(c.productsCount, 'товар останется', 'товара останутся', 'товаров останутся')} в каталоге без категории.`
        : `Удалить категорию «${c.name}»?`,
    );
    if (!ok) return;
    remove.mutate(c.id, {
      onSuccess: () => {
        if (value === c.id) onChange?.(null);
        toast.success('Категория удалена');
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const move = (index: number, delta: number) => {
    const ids = list.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    haptic.selection();
    reorder.mutate(ids, { onError: (err) => toast.error(errorMessage(err)) });
  };

  const title = mode === 'manage' ? 'Категории' : editing ? 'Редактирование' : 'Категория';

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      headerStart={
        mode === 'pick' &&
        list.length > 0 && (
          <button
            type="button"
            className="sheet-text-btn"
            onClick={() => {
              setEditing((e) => !e);
              setRenaming(null);
            }}
          >
            {editing ? 'Готово' : 'Изменить'}
          </button>
        )
      }
    >
      <div className="cat-search">
        <Search size={17} strokeWidth={1.8} className="cat-search-icon" />
        <input
          className="cat-search-input"
          type="search"
          enterKeyHint={canCreate ? 'done' : 'search'}
          placeholder={list.length ? 'Найти или создать категорию' : 'Название новой категории'}
          maxLength={LIMITS.categoryNameMax}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
        {query && (
          <button type="button" className="cat-search-clear" aria-label="Очистить" onClick={() => setQuery('')}>
            <X size={14} strokeWidth={2.6} />
          </button>
        )}
      </div>

      {isPending ? (
        <div className="cat-state">
          <Spinner />
        </div>
      ) : isError ? (
        <div className="cat-state">
          <span className="caption">{errorMessage(error)}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refetch()}>
            Повторить
          </button>
        </div>
      ) : (
        <div className="cat-list" role={editing ? undefined : 'listbox'} aria-label="Категории">
          {canCreate && (
            <button type="button" className="cat-row cat-row-create" onClick={onCreate} disabled={create.isPending}>
              <span className="cat-avatar cat-avatar-accent" aria-hidden>
                {create.isPending ? <Spinner size={16} /> : <Plus size={18} strokeWidth={2.4} />}
              </span>
              <span className="cat-row-text">
                <span className="cat-row-title">Создать «{query.trim().replace(/\s+/g, ' ')}»</span>
                <span className="cat-row-caption">Новая категория</span>
              </span>
            </button>
          )}

          {mode === 'pick' && !editing && !key && (
            <button
              type="button"
              role="option"
              aria-selected={value == null}
              className="cat-row"
              onClick={() => pick(null)}
            >
              <span className="cat-avatar cat-avatar-muted" aria-hidden>
                <FolderOpen size={17} strokeWidth={1.8} />
              </span>
              <span className="cat-row-text">
                <span className="cat-row-title">Без категории</span>
                <span className="cat-row-caption">Товар виден только во вкладке «Все»</span>
              </span>
              <span className="cat-radio" aria-hidden>
                <Check size={14} strokeWidth={3} />
              </span>
            </button>
          )}

          {filtered.map((c) => {
            if (!editing) {
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={value === c.id}
                  className="cat-row"
                  onClick={() => pick(c.id)}
                >
                  <CategoryAvatar name={c.name} />
                  <span className="cat-row-text">
                    <span className="cat-row-title">{c.name}</span>
                    <span className="cat-row-caption">{countCaption(c)}</span>
                  </span>
                  <span className="cat-radio" aria-hidden>
                    <Check size={14} strokeWidth={3} />
                  </span>
                </button>
              );
            }
            const index = list.indexOf(c);
            const isRenaming = renaming?.id === c.id;
            return (
              <div key={c.id} className="cat-row is-editing">
                <CategoryAvatar name={isRenaming ? renaming.draft || c.name : c.name} />
                {isRenaming ? (
                  <form
                    className="cat-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveRename();
                    }}
                  >
                    <input
                      ref={renameInput}
                      className="cat-rename-input"
                      value={renaming.draft}
                      maxLength={LIMITS.categoryNameMax}
                      enterKeyHint="done"
                      aria-label="Новое название"
                      onChange={(e) => setRenaming({ id: c.id, draft: e.target.value })}
                      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setRenaming(null))}
                    />
                    <button type="submit" className="cat-action cat-action-accent" aria-label="Сохранить" disabled={rename.isPending}>
                      {rename.isPending ? <Spinner size={14} /> : <Check size={16} strokeWidth={2.6} />}
                    </button>
                    <button type="button" className="cat-action" aria-label="Отменить" onClick={() => setRenaming(null)}>
                      <X size={16} />
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="cat-row-text">
                      <span className="cat-row-title">{c.name}</span>
                      <span className="cat-row-caption">{countCaption(c)}</span>
                    </span>
                    <span className="cat-actions">
                      {!key && (
                        <>
                          <button
                            type="button"
                            className="cat-action"
                            aria-label="Выше"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ChevronUp size={17} />
                          </button>
                          <button
                            type="button"
                            className="cat-action"
                            aria-label="Ниже"
                            disabled={index === list.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ChevronDown size={17} />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="cat-action"
                        aria-label={`Переименовать «${c.name}»`}
                        onClick={() => setRenaming({ id: c.id, draft: c.name })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="cat-action cat-action-danger"
                        aria-label={`Удалить «${c.name}»`}
                        disabled={remove.isPending}
                        onClick={() => void onDelete(c)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </>
                )}
              </div>
            );
          })}

          {list.length === 0 && !canCreate && (
            <div className="cat-empty">
              <span className="cat-empty-title">Категорий пока нет</span>
              <span className="caption">Введите название — например, «Кроссовки» — и нажмите «Создать».</span>
            </div>
          )}
          {list.length > 0 && key && filtered.length === 0 && !canCreate && (
            <div className="cat-empty">
              <span className="caption">Ничего не найдено</span>
            </div>
          )}
        </div>
      )}

      {editing && list.length > 1 && (
        <p className="cat-hint">Порядок категорий совпадает с порядком фильтров в каталоге магазина.</p>
      )}
    </BottomSheet>
  );
}

/** Поле «Категория» в карточке товара: открывает панель выбора. */
export function CategoryPicker({
  value,
  onChange,
  error,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: categories, isPending } = useAdminCategories();
  const current = categories?.find((c) => c.id === value);

  // Категорию удалили (в другой вкладке или другим администратором) — товар остаётся без неё.
  useEffect(() => {
    if (categories && value != null && !current) onChange(null);
  }, [categories, value, current, onChange]);

  return (
    <div className="field">
      <span className="field-label">Категория</span>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={Boolean(error)}
        onClick={() => {
          haptic.impact('light');
          setOpen(true);
        }}
      >
        {current ? (
          <CategoryAvatar name={current.name} />
        ) : (
          <span className="cat-avatar cat-avatar-muted" aria-hidden>
            <FolderOpen size={17} strokeWidth={1.8} />
          </span>
        )}
        <span className="select-trigger-text">
          <span className={current ? 'select-trigger-value' : 'select-trigger-placeholder'}>
            {current?.name ?? (value != null && isPending ? 'Загрузка…' : 'Без категории')}
          </span>
          {current && <span className="cat-row-caption">{countCaption(current)}</span>}
        </span>
        <ChevronsUpDown size={18} className="select-trigger-chevron" />
      </button>
      {error && <span className="field-error">{error}</span>}
      <span className="field-hint">По категориям покупатели фильтруют каталог: Кроссовки, Худи, Аксессуары…</span>
      <CategorySheet open={open} onClose={() => setOpen(false)} mode="pick" value={value} onChange={onChange} />
    </div>
  );
}
