import { ArrowLeft, Search, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@wag/shared';

export function PageHeader({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="admin-header">
      {onBack && (
        <button type="button" className="icon-btn" aria-label="Назад" onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={2} />
        </button>
      )}
      <div className="admin-header-text">
        <h1 className="title">{title}</h1>
        {subtitle && <div className="caption">{subtitle}</div>}
      </div>
      {action && <div className="admin-header-action">{action}</div>}
    </header>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`status-badge status-${status}`}>{ORDER_STATUS_LABELS[status]}</span>;
}

/** Поле поиска с задержкой (debounce), чтобы не отправлять запрос на каждый символ. */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  // Значение изменилось извне (например, переход по ссылке) — синхронизируем поле.
  useEffect(() => {
    setDraft((d) => (d.trim() === value ? d : value));
  }, [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft.trim() !== value) onChange(draft.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);

  return (
    <div className="search">
      <Search size={17} strokeWidth={1.8} className="search-icon" />
      <input
        className="input search-input"
        type="search"
        inputMode="search"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={100}
      />
      {draft && (
        <button type="button" className="search-clear" aria-label="Очистить" onClick={() => setDraft('')}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="list">
      {Array.from({ length: rows }, (_, i) => (
        <div className="list-row" key={i} aria-hidden>
          <div className="skeleton" style={{ width: 52, height: 52, borderRadius: 10 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 14, width: '60%' }} />
            <div className="skeleton" style={{ height: 12, width: '35%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
