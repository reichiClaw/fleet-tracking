import { useTranslation } from 'react-i18next';

export function ErrorState({ message }: { message?: string }) {
  const { t } = useTranslation();

  return (
    <section className="state-card state-card--error" role="alert">
      <h2>{t('states.error.title')}</h2>
      <p>{message ?? t('states.error.defaultMessage')}</p>
    </section>
  );
}
