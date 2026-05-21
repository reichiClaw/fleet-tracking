import { useTranslation } from 'react-i18next';

export function PlaceholderPage({ translationKey }: { translationKey: string }) {
  const { t } = useTranslation();

  return (
    <section className="placeholder-card">
      <h2>{t(`${translationKey}.title`)}</h2>
      <p>{t(`${translationKey}.body`)}</p>
    </section>
  );
}
