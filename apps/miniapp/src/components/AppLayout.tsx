import { Outlet, ScrollRestoration, useLocation } from 'react-router';
import { TabBar } from './TabBar';

/** Страницы без нижней навигации (форма заказа — чтобы клавиатура не перекрывала контент). */
const NO_TABBAR = [/^\/checkout/, /^\/order\//];

export function AppLayout() {
  const location = useLocation();
  const showTabBar = !NO_TABBAR.some((r) => r.test(location.pathname));

  return (
    <div className={`app ${showTabBar ? 'has-tabbar' : ''}`}>
      <main className="page-enter" key={location.pathname}>
        <Outlet />
      </main>
      {showTabBar && <TabBar />}
      <ScrollRestoration getKey={(loc) => loc.pathname} />
    </div>
  );
}
