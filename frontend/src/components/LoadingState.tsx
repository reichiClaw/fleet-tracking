import { useTranslation } from 'react-i18next';

/**
 * Loading indicator.
 *
 * Defaults to a centered spinner (used widely, including in tests). Pass
 * `variant="skeleton"` to render shimmering placeholder cards for list-heavy
 * screens, which feels faster than a bare spinner.
 */
export function LoadingState({ variant = 'spinner', rows = 3 }: { variant?: 'spinner' | 'skeleton'; rows?: number }) {
  const { t } = useTranslation();

  if (variant === 'skeleton') {
    return (
      <div className="skeleton-grid" role="status" aria-live="polite" aria-label={t('states.loading')}>
        {Array.from({ length: rows }).map((_, index) => (
          <div className="skeleton-card" key={index} aria-hidden="true" />
        ))}
      </div>
    );
  }

  return (
    <section className="state-card" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{t('states.loading')}</p>
    </section>
  );
}
