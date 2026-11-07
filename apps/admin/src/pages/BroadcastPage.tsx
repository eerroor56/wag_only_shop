import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BROADCAST_STATUS_LABELS, broadcastCreateSchema, LIMITS, type BroadcastDTO } from '@wag/shared';
import {
  confirmDialog,
  ErrorState,
  errorMessage,
  formatDateTime,
  haptic,
  plural,
  Skeleton,
  Spinner,
  useToast,
} from '@wag/web';
import { useBroadcasts, useCancelBroadcast, useCreateBroadcast, useTestBroadcast } from '../api/queries';
import { PageHeader } from '../components/common';

function BroadcastProgress({ b }: { b: BroadcastDTO }) {
  const cancel = useCancelBroadcast();
  const toast = useToast();
  const done = b.sentCount + b.failedCount;
  const pct = b.totalRecipients ? Math.round((done / b.totalRecipients) * 100) : 100;
  const active = b.status === 'pending' || b.status === 'running';

  return (
    <div className="card broadcast-card">
      <div className="broadcast-card-top">
        <span className={`status-badge broadcast-${b.status}`}>{BROADCAST_STATUS_LABELS[b.status]}</span>
        <span className="caption">{formatDateTime(b.createdAt)}</span>
      </div>
      <p className="broadcast-text line-clamp-2">{b.text}</p>
      {active && (
        <div className="progress" aria-label={`Прогресс ${pct}%`}>
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="broadcast-stats">
        <span>
          Отправлено: <b>{b.sentCount}</b>
        </span>
        <span>
          Ошибок: <b>{b.failedCount}</b>
        </span>
        <span className="muted">из {b.totalRecipients}</span>
      </div>
      {active && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={cancel.isPending}
          onClick={async () => {
            if (!(await confirmDialog('Остановить рассылку? Уже отправленные сообщения не отменить.'))) return;
            cancel.mutate(b.id, { onError: (err) => toast.error(errorMessage(err)) });
          }}
        >
          Остановить
        </button>
      )}
    </div>
  );
}

export function BroadcastPage() {
  const toast = useToast();
  const { data, isPending, isError, error, refetch } = useBroadcasts();
  const create = useCreateBroadcast();
  const test = useTestBroadcast();
  const [text, setText] = useState('');
  const [withShopButton, setWithShopButton] = useState(true);
  const [textError, setTextError] = useState('');

  const active = data?.items.find((b) => b.status === 'pending' || b.status === 'running');
  const recipients = data?.recipients ?? 0;

  const validated = () => {
    const parsed = broadcastCreateSchema.safeParse({ text, withShopButton });
    if (!parsed.success) {
      setTextError(parsed.error.issues[0]?.message ?? 'Проверьте текст');
      haptic.notify('error');
      return null;
    }
    setTextError('');
    return parsed.data;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const input = validated();
    if (!input) return;
    const ok = await confirmDialog(
      `Отправить сообщение ${recipients} ${plural(recipients, 'пользователю', 'пользователям', 'пользователям')}? Отменить отправленные сообщения будет нельзя.`,
    );
    if (!ok) return;
    create.mutate(input, {
      onSuccess: () => {
        haptic.notify('success');
        toast.success('Рассылка запущена');
        setText('');
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const onTest = () => {
    const input = validated();
    if (!input) return;
    test.mutate(input, {
      onSuccess: () => toast.success('Тестовое сообщение отправлено вам в Telegram'),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <div className="container">
      <PageHeader title="Рассылка" subtitle="Сообщение от имени бота всем пользователям" />

      {isError ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <>
          {active && <BroadcastProgress b={active} />}

          <form className="broadcast-form" onSubmit={onSubmit} noValidate>
            <label className="field">
              <span className="field-label">Текст сообщения</span>
              <textarea
                className="textarea"
                rows={7}
                placeholder="Например: Новая коллекция уже в каталоге!"
                maxLength={LIMITS.broadcastTextMax}
                value={text}
                aria-invalid={Boolean(textError)}
                onChange={(e) => {
                  setText(e.target.value);
                  setTextError('');
                }}
              />
              <span className="field-hint">
                {text.length}/{LIMITS.broadcastTextMax} · отправляется как обычный текст
              </span>
              {textError && <span className="field-error">{textError}</span>}
            </label>

            <label className="switch-row card">
              <span>
                <span className="switch-title">Кнопка «Открыть магазин»</span>
                <span className="caption">Под сообщением будет кнопка запуска Mini App</span>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={withShopButton}
                onChange={(e) => setWithShopButton(e.target.checked)}
              />
            </label>

            <div className="recipients">
              {isPending ? (
                <Skeleton style={{ height: 20, width: 160 }} />
              ) : (
                <>
                  Получателей: <b>{recipients}</b>
                </>
              )}
            </div>
            <p className="field-hint">
              Пользователи, заблокировавшие бота, исключаются автоматически. Отправка идёт с учётом лимитов Telegram —
              большая рассылка может занять несколько минут.
            </p>

            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              disabled={create.isPending || Boolean(active) || recipients === 0}
            >
              {create.isPending ? (
                <Spinner size={18} />
              ) : (
                <>
                  <Send size={17} /> Отправить всем
                </>
              )}
            </button>
            {active && <p className="field-hint center">Дождитесь завершения текущей рассылки</p>}
            <button type="button" className="btn btn-secondary btn-block" onClick={onTest} disabled={test.isPending}>
              {test.isPending ? <Spinner size={18} /> : 'Отправить тест себе'}
            </button>
          </form>

          {data && data.items.filter((b) => b.id !== active?.id).length > 0 && (
            <section className="history">
              <div className="section-label">История</div>
              {data.items
                .filter((b) => b.id !== active?.id)
                .map((b) => (
                  <BroadcastProgress key={b.id} b={b} />
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
