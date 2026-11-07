import { Home, LayoutGrid, ShoppingBag } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { haptic } from '@wag/web';
import { useCart } from '../api/queries';

export function TabBar() {
  const { data: cart } = useCart();
  const count = cart?.totalQuantity ?? 0;
  const location = useLocation();
  // Карточка товара относится к разделу, из которого её открыли.
  const onProduct = location.pathname.startsWith('/product/');
  const fromCart = new URLSearchParams(location.search).get('from') === 'cart';
  const sectionActive = (to: string) =>
    onProduct && ((to === '/catalog' && !fromCart) || (to === '/cart' && fromCart));

  const tabs = [
    { to: '/', label: 'Главная', icon: Home, end: true },
    { to: '/catalog', label: 'Каталог', icon: LayoutGrid, end: false },
    { to: '/cart', label: 'Корзина', icon: ShoppingBag, end: false, badge: count },
  ];

  return (
    <nav className="tabbar" aria-label="Основная навигация">
      {tabs.map(({ to, label, icon: Icon, end, badge }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `tab ${isActive || sectionActive(to) ? 'tab-active' : ''}`}
          onClick={() => haptic.selection()}
        >
          <span className="tab-icon">
            <Icon size={23} strokeWidth={1.7} />
            {badge ? (
              <span className="tab-badge" aria-label={`${badge} в корзине`}>
                {badge > 99 ? '99+' : badge}
              </span>
            ) : null}
          </span>
          <span className="tab-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
