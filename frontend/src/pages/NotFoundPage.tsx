import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section className="state-card">
      <h2>{t('notFound.title')}</h2>
      <p>{t('notFound.body')}</p>
      <Link className="button-link" to="/app">
        {t('notFound.action')}
      </Link>
    </section>
  );
}
