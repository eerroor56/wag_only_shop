import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useShopConfig } from '../api/queries';

export function HomePage() {
  const { data: config } = useShopConfig();
  const manager = config?.managerUsername ?? 'wag_on';

  return (
    <div className="home">
      <div className="home-hero">
        <div className="wordmark home-wordmark">{config?.shopName ?? 'WAG Shop'}</div>
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
