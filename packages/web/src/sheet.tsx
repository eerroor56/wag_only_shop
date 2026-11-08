import { X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTelegramBackButton } from './components.js';

const CLOSE_MS = 220;
/** Насколько нужно потянуть панель вниз, чтобы она закрылась. */
const DRAG_CLOSE_PX = 90;

/**
 * Нижняя панель в стиле Telegram: затемнение, «ручка», закрытие свайпом вниз,
 * по тапу на фон, Escape и системной кнопкой «Назад».
 */
export function BottomSheet({
  open,
  onClose,
  title,
  headerStart,
  children,
  footer,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Кнопка слева от заголовка (например, «Изменить»). */
  headerStart?: ReactNode;
  children: ReactNode;
  /** Закреплённая нижняя часть (не прокручивается вместе со списком). */
  footer?: ReactNode;
  label?: string;
}) {
  // mounted держит панель в DOM на время анимации закрытия.
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      setDrag(0);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(t);
  }, [open, mounted]);

  // Пока панель открыта, страница под ней не прокручивается.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useTelegramBackButton(open ? onClose : null);

  if (!mounted) return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current == null) return;
    setDrag(Math.max(0, e.clientY - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragStart.current == null) return;
    dragStart.current = null;
    if (drag > DRAG_CLOSE_PX) onClose();
    else setDrag(0);
  };

  return createPortal(
    <div className={`sheet-root ${closing ? 'is-closing' : ''}`}>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div
        className={`sheet ${drag ? 'is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        <div
          className="sheet-head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sheet-grabber" aria-hidden />
          <div className="sheet-titlebar">
            <div className="sheet-titlebar-side">{headerStart}</div>
            <div className="sheet-title">{title}</div>
            <div className="sheet-titlebar-side sheet-titlebar-end">
              <button type="button" className="sheet-close" aria-label="Закрыть" onClick={onClose}>
                <X size={16} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
