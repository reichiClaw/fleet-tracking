import { useTranslation } from 'react-i18next';

const summaryCards = [
  { key: 'available', value: '12' },
  { key: 'loaned', value: '4' },
  { key: 'maintenance', value: '2' },
  { key: 'damaged', value: '1' },
] as const;

export function DashboardPage() {
  const { t } = useTranslation();

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('dashboard.eyebrow')}</p>
        <h2>{t('dashboard.title')}</h2>
        <p>{t('dashboard.description')}</p>
      </div>

      <div className="summary-grid">
        {summaryCards.map((card) => (
          <article className="summary-card" key={card.key}>
            <span>{t(`dashboard.cards.${card.key}`)}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </div>

      <section className="placeholder-card">
        <h3>{t('dashboard.placeholder.title')}</h3>
        <p>{t('dashboard.placeholder.body')}</p>
      </section>
    </section>
  );
}
