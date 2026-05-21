import { useTranslation } from 'react-i18next';

const statuses = ['available', 'loaned', 'maintenance', 'damaged'] as const;

export function VehiclePoolPage() {
  const { t } = useTranslation();

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('vehicles.eyebrow')}</p>
        <h2>{t('vehicles.title')}</h2>
        <p>{t('vehicles.description')}</p>
      </div>

      <div className="filter-row" aria-label={t('vehicles.filters.label')}>
        {statuses.map((status) => (
          <button className="chip" type="button" key={status}>
            {t(`status.${status}`)}
          </button>
        ))}
      </div>

      <section className="placeholder-card">
        <h3>{t('vehicles.placeholder.title')}</h3>
        <p>{t('vehicles.placeholder.body')}</p>
      </section>
    </section>
  );
}
