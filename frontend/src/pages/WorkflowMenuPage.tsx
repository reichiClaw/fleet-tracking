import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type WorkflowMenuType = 'loan' | 'manufacturer';

export function WorkflowMenuPage({ type }: { type: WorkflowMenuType }) {
  const { t } = useTranslation();
  const prefix = `workflowMenus.${type}`;
  const actions =
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
            key: 'checkIn',
            to: '/app/workflows/check-in',
          },
        ];

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t(`${prefix}.eyebrow`)}</p>
        <h2>{t(`${prefix}.title`)}</h2>
        <p>{t(`${prefix}.description`)}</p>
      </div>
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
