import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '../components/PageHeader';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section className="state-card">
      <PageHeader title={t('notFound.title')} description={t('notFound.body')} />
      <Link className="button-link" to="/app">
        {t('notFound.action')}
      </Link>
    </section>
  );
}
