import { useTranslation } from 'react-i18next';

/**
 * Error panel with an optional retry affordance. Title/message default to
 * translated copy so existing call sites keep working unchanged.
 */
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();

  return (
    <section className="state-card state-card--error" role="alert">
      <h2>{t('states.error.title')}</h2>
      <p>{message ?? t('states.error.defaultMessage')}</p>
      {onRetry ? (
        <button type="button" className="secondary-button" onClick={onRetry}>
          {t('states.error.retry')}
        </button>
      ) : null}
    </section>
  );
}
