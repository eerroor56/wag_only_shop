import { LayoutDashboard, Package, ReceiptText, Send, Users } from 'lucide-react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router';
import { haptic } from '@wag/web';
import { useDashboard } from '../api/queries';

const TABS = [
  { to: '/', label: 'Обзор', icon: LayoutDashboard, end: true },
  { to: '/products', label: 'Товары', icon: Package, end: false },
  { to: '/orders', label: 'Заказы', icon: ReceiptText, end: false },
  { to: '/users', label: 'Клиенты', icon: Users, end: false },
  { to: '/broadcast', label: 'Рассылка', icon: Send, end: false },
];

/** Редактор товара — полноэкранная форма без нижней навигации. */
const FULLSCREEN = [/^\/products\/(new|\d+)/];

export function AdminLayout() {
  const location = useLocation();
  const { data: dashboard } = useDashboard();
  const fullscreen = FULLSCREEN.some((r) => r.test(location.pathname));

  return (
    <div className={`app ${fullscreen ? '' : 'has-tabbar'}`}>
      <main className="page-enter" key={location.pathname}>
        <Outlet />
      </main>
      {!fullscreen && (
        <nav className="tabbar" aria-label="Разделы админ-панели">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `tab ${isActive ? 'tab-active' : ''}`}
              onClick={() => haptic.selection()}
            >
              <span className="tab-icon">
                <Icon size={22} strokeWidth={1.7} />
                {to === '/orders' && dashboard?.ordersNew ? <span className="tab-badge">{dashboard.ordersNew}</span> : null}
              </span>
              <span className="tab-label">{label}</span>
            </NavLink>
          ))}
        </nav>
      )}
      <ScrollRestoration getKey={(loc) => loc.pathname} />
    </div>
  );
}
