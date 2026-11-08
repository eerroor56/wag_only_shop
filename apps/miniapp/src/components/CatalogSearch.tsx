import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatPrice, titleSearchKey } from '@wag/shared';
import { haptic, Spinner } from '@wag/web';
import { useSearchSuggestions } from '../api/queries';
import { ProductImage } from './ProductImage';

/** Выделяет совпадение в названии (без учёта регистра и ё/е). */
function Highlight({ text, query }: { text: string; query: string }) {
  const key = titleSearchKey(query);
  const index = key ? titleSearchKey(text).indexOf(key) : -1;
  // titleSearchKey схлопывает пробелы — выделяем, только если длина строки не изменилась.
  if (index < 0 || titleSearchKey(text).length !== text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + key.length)}</mark>
      {text.slice(index + key.length)}
    </>
  );
}

/**
 * Поиск по названию: сетка каталога фильтруется по мере ввода, а под полем — подсказки
 * из названий товаров (закончившиеся показываются неактивными).
 */
export function CatalogSearch({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const query = draft.trim().replace(/\s+/g, ' ');

  // Значение сменилось извне (сброс фильтров, ссылка) — синхронизируем поле.
  useEffect(() => {
    setDraft((d) => (d.trim().replace(/\s+/g, ' ') === value ? d : value));
  }, [value]);

  useEffect(() => {
    if (query === value) return;
    const t = setTimeout(() => onChange(query), 300);
    return () => clearTimeout(t);
  }, [query, value, onChange]);

  const suggestions = useSearchSuggestions(focused ? query : '');
  const items = suggestions.data?.items ?? [];
  const open = focused && query.length > 0;

  const close = () => input.current?.blur();

  return (
    <div className={`search-box ${open ? 'is-open' : ''}`}>
      <div className="search-field">
        <Search size={17} strokeWidth={1.9} className="search-field-icon" />
        <input
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Поиск по названию"
          aria-label="Поиск по названию"
          aria-expanded={open}
          aria-controls="search-suggestions"
          autoComplete="off"
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onChange(query);
              close();
            } else if (e.key === 'Escape') {
              close();
            }
          }}
        />
        {draft && (
          <button
            type="button"
            className="search-field-clear"
            aria-label="Очистить поиск"
            // mousedown + preventDefault: фокус остаётся в поле, клавиатура не прячется
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft('');
              onChange('');
            }}
          >
            <X size={13} strokeWidth={2.8} />
          </button>
        )}
      </div>

      {open && (
        <div className="search-suggestions" id="search-suggestions" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {suggestions.isPending ? (
            <div className="search-suggestions-state">
              <Spinner size={18} />
            </div>
          ) : items.length === 0 ? (
            <div className="search-suggestions-state">Ничего не нашлось по запросу «{query}»</div>
          ) : (
            <>
              {items.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={`suggestion ${p.soldOut ? 'is-soldout' : ''}`}
                  onClick={() => {
                    haptic.selection();
                    close();
                    navigate(`/product/${p.id}`);
                  }}
                >
                  <span className="suggestion-thumb">
                    <ProductImage src={p.image?.thumbUrl} alt="" />
                  </span>
                  <span className="suggestion-text">
                    <span className="suggestion-title">
                      <Highlight text={p.title} query={query} />
                    </span>
                    <span className="suggestion-meta">{p.soldOut ? 'Нет в наличии' : formatPrice(p.price)}</span>
                  </span>
                </button>
              ))}
              {(suggestions.data?.total ?? 0) > items.length && (
                <button type="button" className="suggestion-all" onClick={close}>
                  Показать все результаты · {suggestions.data!.total}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
