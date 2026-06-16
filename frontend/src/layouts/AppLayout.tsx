import { type ReactNode, useEffect, useState } from 'react';
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
  { key: 'loanWorkflows', to: '/app/workflows/loans', translationKey: 'navigation.loanWorkflows', roles: ['admin', 'operations'] },
  { key: 'qr', to: '/app/qr', translationKey: 'navigation.qrAccess', roles: ['admin', 'operations', 'readonly'] },
  { key: 'drivers', to: '/app/drivers', translationKey: 'navigation.drivers', roles: ['admin', 'operations', 'readonly'] },
  { key: 'companies', to: '/app/companies', translationKey: 'navigation.companies', roles: ['admin', 'operations', 'readonly'] },
  { key: 'users', to: '/app/users', translationKey: 'navigation.users', roles: ['admin'] },
  {
    key: 'manufacturerWorkflows',
    to: '/app/workflows/manufacturer',
    translationKey: 'navigation.manufacturerWorkflows',
    roles: ['admin', 'operations'],
  },
  { key: 'history', to: '/app/history', translationKey: 'navigation.history', roles: ['admin', 'operations', 'readonly'] },
  { key: 'reports', to: '/app/reports', translationKey: 'navigation.reports', roles: ['admin', 'operations', 'readonly'] },
  { key: 'imports', to: '/app/imports', translationKey: 'navigation.imports', roles: ['admin'] },
];

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <path d="M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z" />,
    vehiclePool: (
      <>
        <path d="M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5" />
        <path d="M5 13h14v5H5z" />
        <circle cx="7.5" cy="18" r="1.4" />
        <circle cx="16.5" cy="18" r="1.4" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    qr: (
      <>
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
        <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />
      </>
    ),
    loanWorkflows: (
      <>
        <path d="M4 7h11l-2-2M20 17H9l2 2" />
        <path d="M4 7l3 3M20 17l-3-3" />
      </>
    ),
    manufacturerWorkflows: (
      <>
        <path d="M3 21h18M5 21V9l5 3V9l5 3V6l4 2v13" />
      </>
    ),
    drivers: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </>
    ),
    companies: (
      <>
        <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
        <path d="M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3" />
      </>
    ),
    imports: (
      <>
        <path d="M12 3v12" />
        <path d="M8 11l4 4 4-4" />
        <path d="M4 21h16" />
      </>
    ),
    reports: (
      <>
        <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M14 3v4h4M9 13h6M9 17h6M9 9h2" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M2 20a7 7 0 0 1 14 0" />
        <path d="M16 5a3 3 0 0 1 0 6M22 20a6.5 6.5 0 0 0-4-6" />
      </>
    ),
  };

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name] ?? null}
    </svg>
  );
}

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
        <div className="top-bar__right">
          <div className="top-bar__identity">
            <span>{t('layout.signedInAs')}</span>
            <strong>{user?.name}</strong>
            <small>{roleLabel}</small>
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
              <svg className="top-bar__menu-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div className={`top-bar__menu${isQuickActionsOpen ? ' is-open' : ''}`}>
              <LanguageSelector />
              <button className="secondary-button" type="button" onClick={() => void logout()}>
                {t('navigation.logout')}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="shell-body">
        <aside className="side-nav" aria-label={t('navigation.primaryLabel')}>
          <nav>
            {visibleItems.map((item) => (
              <NavLink key={item.key} to={item.to} end={item.to === '/app'}>
                <NavIcon name={item.key} />
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
