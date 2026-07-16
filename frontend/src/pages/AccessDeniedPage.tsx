import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ErrorState } from '../components/ErrorState';

export function AccessDeniedPage() {
  const { t } = useTranslation();
  return (
    <div className="page-stack">
      <ErrorState message={t('errors.roleDenied')} />
      <Link className="button-link secondary-button" to="/app">{t('notFound.action')}</Link>
    </div>
  );
}
