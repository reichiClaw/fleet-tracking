import { useTranslation } from 'react-i18next';

const supportedLanguages = ['de', 'en'] as const;

export function LanguageSelector() {
  const { i18n, t } = useTranslation();

  return (
    <label className="language-selector">
      <span>{t('language.label')}</span>
      <select value={i18n.resolvedLanguage ?? i18n.language} onChange={(event) => void i18n.changeLanguage(event.target.value)}>
        {supportedLanguages.map((language) => (
          <option key={language} value={language}>
            {t(`language.options.${language}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
