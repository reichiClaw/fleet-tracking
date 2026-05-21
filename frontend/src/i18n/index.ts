import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import deCommon from './locales/de/common.json';
import enCommon from './locales/en/common.json';

export const LANGUAGE_STORAGE_KEY = 'fleet-language';
export const supportedLanguages = ['de', 'en'] as const;

function updateDocumentLanguage(language: string) {
  document.documentElement.lang = language.startsWith('en') ? 'en' : 'de';
}

i18n.on('languageChanged', updateDocumentLanguage);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: deCommon },
      en: { translation: enCommon },
    },
    fallbackLng: 'de',
    supportedLngs: supportedLanguages,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  })
  .then(() => updateDocumentLanguage(i18n.resolvedLanguage ?? i18n.language));

export default i18n;
