import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';

type WorkflowMenuType = 'loan' | 'manufacturer';

type MenuAction = { key: string; to: string; adminOnly?: boolean };

export function WorkflowMenuPage({ type }: { type: WorkflowMenuType }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const prefix = `workflowMenus.${type}`;
  const allActions: MenuAction[] =
    type === 'loan'
      ? [
          {
            key: 'checkout',
            to: '/app/workflows/loan-checkout',
          },
          {
            key: 'return',
            to: '/app/workflows/loan-return',
          },
        ]
      : [
          {
            key: 'checkout',
            to: '/app/workflows/manufacturer-checkout',
          },
          {
            // Adding a brand-new vehicle is master-data work, so it is admin-only.
            key: 'checkIn',
            to: '/app/workflows/add-vehicle',
            adminOnly: true,
          },
        ];
  const actions = allActions.filter((action) => !action.adminOnly || isAdmin);

  return (
    <section className="page-stack">
      <PageHeader eyebrow={t(`${prefix}.eyebrow`)} title={t(`${prefix}.title`)} description={t(`${prefix}.description`)} />
      <div className="card-grid card-grid--two">
        {actions.map((action) => (
          <article className="content-card" key={action.key}>
            <h3>{t(`${prefix}.actions.${action.key}.title`)}</h3>
            <p className="hint-text">{t(`${prefix}.actions.${action.key}.description`)}</p>
            <div className="action-row">
              <Link className="button-link" to={action.to}>
                {t(`${prefix}.actions.${action.key}.open`)}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
