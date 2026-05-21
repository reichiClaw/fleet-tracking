import { useTranslation } from 'react-i18next';

export function LoadingState() {
  const { t } = useTranslation();

  return (
    <section className="state-card" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{t('states.loading')}</p>
    </section>
  );
}
