import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, type UserRole } from '../auth/AuthContext';
import { LanguageSelector } from '../components/LanguageSelector';

type NavigationItem = {
  key: string;
  to: string;
  translationKey: string;
  roles: UserRole[];
};

const navigationItems: NavigationItem[] = [
  { key: 'dashboard', to: '/app', translationKey: 'navigation.dashboard', roles: ['admin', 'operations', 'readonly'] },
  { key: 'vehiclePool', to: '/app/vehicles', translationKey: 'navigation.vehiclePool', roles: ['admin', 'operations', 'readonly'] },
  { key: 'qr', to: '/app/qr', translationKey: 'navigation.qrAccess', roles: ['admin', 'operations', 'readonly'] },
  { key: 'workflows', to: '/app/workflows/check-in', translationKey: 'navigation.workflows', roles: ['admin', 'operations'] },
  { key: 'drivers', to: '/app/drivers', translationKey: 'navigation.drivers', roles: ['admin', 'operations', 'readonly'] },
  { key: 'companies', to: '/app/companies', translationKey: 'navigation.companies', roles: ['admin', 'operations', 'readonly'] },
  { key: 'imports', to: '/app/imports', translationKey: 'navigation.imports', roles: ['admin'] },
  { key: 'users', to: '/app/users', translationKey: 'navigation.users', roles: ['admin'] },
];

export function AppLayout() {
  const { logout, user } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const visibleItems = navigationItems.filter((item) => user && item.roles.includes(user.role));
  const roleLabel = user ? t(`roles.${user.role}`) : '';

  useEffect(() => {
    setIsQuickActionsOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">{t('app.subtitle')}</p>
          <h1>{t('app.name')}</h1>
        </div>
        <div className="top-bar__actions">
          <div className="top-bar__actions-desktop">
            <LanguageSelector />
            <button className="secondary-button" type="button" onClick={() => void logout()}>
              {t('navigation.logout')}
            </button>
          </div>
          <button
            className="secondary-button top-bar__menu-trigger"
            type="button"
            aria-label={t('layout.quickActions')}
            aria-expanded={isQuickActionsOpen}
            onClick={() => setIsQuickActionsOpen((current) => !current)}
          >
            ⋮
          </button>
          <div className={`top-bar__menu${isQuickActionsOpen ? ' is-open' : ''}`}>
            <LanguageSelector />
            <button className="secondary-button" type="button" onClick={() => void logout()}>
              {t('navigation.logout')}
            </button>
          </div>
        </div>
      </header>

      <div className="shell-body">
        <aside className="side-nav" aria-label={t('navigation.primaryLabel')}>
          <div className="user-card">
            <span>{t('layout.signedInAs')}</span>
            <strong>{user?.name}</strong>
            <small>{roleLabel}</small>
          </div>
          <nav>
            {visibleItems.map((item) => (
              <NavLink key={item.key} to={item.to} end={item.to === '/app'}>
                {t(item.translationKey)}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="content-panel">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
