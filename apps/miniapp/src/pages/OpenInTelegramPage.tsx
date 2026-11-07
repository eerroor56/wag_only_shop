import { Send } from 'lucide-react';
import { EmptyState } from '@wag/web';
import { useShopConfig } from '../api/queries';

/** Показывается, если приложение открыто в обычном браузере, а не в Telegram. */
export function OpenInTelegramPage() {
  const { data: config } = useShopConfig();
  const botLink = config?.botUsername ? `https://t.me/${config.botUsername}` : null;
  return (
    <div className="container gate">
      <div className="wordmark">{config?.shopName ?? 'WAG Shop'}</div>
      <EmptyState
        icon={<Send size={26} strokeWidth={1.6} />}
        title="Откройте магазин в Telegram"
        text="Каталог и оформление заказа доступны внутри Telegram через бота магазина."
        action={
          botLink && (
            <a href={botLink} className="btn btn-primary">
              Открыть бота
            </a>
          )
        }
      />
    </div>
  );
}
