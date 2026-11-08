import { ArrowRight, ChevronRight, Settings } from 'lucide-react';
import { Link } from 'react-router';
import { haptic } from '@wag/web';
import { useMe, useShopConfig } from '../api/queries';

/** Вход в админ-панель. Кнопку видят только администраторы; доступ всё равно проверяет сервер. */
function AdminEntry() {
  const { data: me } = useMe();
  if (!me?.isAdmin) return null;
  return (
    // Админка — отдельное приложение на том же домене; Telegram SDK сохраняет авторизацию при переходе.
    <a href="/admin/" className="admin-entry" onClick={() => haptic.impact('light')}>
      <span className="admin-entry-icon">
        <Settings size={20} strokeWidth={1.8} />
      </span>
      <span className="admin-entry-text">
        <span className="admin-entry-title">Админ-панель</span>
        <span className="admin-entry-subtitle">Товары, заказы, клиенты и рассылка</span>
      </span>
      <ChevronRight size={18} className="admin-entry-chevron" />
    </a>
  );
}

export function HomePage() {
  const { data: config } = useShopConfig();
  const manager = config?.managerUsername ?? 'wag_on';

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-banner">
          <img src="/banner.jpg" alt={config?.shopName ?? 'WAG Shop'} width={640} height={640} decoding="async" />
        </div>
        <h1 className="home-title">
          Wag shop.
          <br />
          Магазин брендовых вещей.
        </h1>
        <p className="home-text">
          Каталог актуальных вещей.
          <br />
          Для оформления покупки свяжитесь с нами через Telegram.
        </p>
        <Link to="/catalog" className="btn btn-primary btn-lg btn-block">
          Открыть каталог
          <ArrowRight size={18} strokeWidth={2} />
        </Link>
        <AdminEntry />
      </div>

      <section className="home-steps" aria-label="Как сделать заказ">
        <div className="section-label">Как сделать заказ</div>
        <ol className="steps">
          <li>
            <span className="step-num">1</span>
            <span>Выберите вещи в каталоге и добавьте их в корзину</span>
          </li>
          <li>
            <span className="step-num">2</span>
            <span>Оформите заказ — укажите имя и телефон</span>
          </li>
          <li>
            <span className="step-num">3</span>
            <span>
              Менеджер <span className="manager-tag">@{manager}</span> свяжется с вами, чтобы согласовать оплату и
              получение
            </span>
          </li>
        </ol>
      </section>
    </div>
  );
}
