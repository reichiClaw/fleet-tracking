import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { listDocuments, mediaDownloadUrl, type GeneratedDocument } from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';

const REPORT_TYPES = [
  'check_in_protocol_pdf',
  'loan_checkout_pdf',
  'loan_return_pdf',
  'manufacturer_checkout_protocol_pdf',
] as const;

const LANGUAGES = ['', 'de', 'en'] as const;

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [type, setType] = useState('');
  const [language, setLanguage] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }), [i18n.language]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const nextDocuments = await listDocuments({ search, type, language });
        if (isMounted) {
          setDocuments(nextDocuments);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getApiErrorMessage(loadError, t, t('reports.loadError')));
          setDocuments([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [language, search, type, t]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  function reportTypeLabel(relatedType: string) {
    const key = `reports.types.${relatedType}`;
    return i18n.exists(key) ? t(key) : relatedType;
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow={t('reports.eyebrow')} title={t('reports.title')} description={t('reports.description')} />

      <form className="filter-panel" onSubmit={handleSearch}>
        <label>
          <span>{t('reports.filters.search')}</span>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('reports.filters.searchPlaceholder')} />
        </label>
        <label>
          <span>{t('reports.filters.type')}</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">{t('reports.filters.allTypes')}</option>
            {REPORT_TYPES.map((reportType) => (
              <option key={reportType} value={reportType}>
                {reportTypeLabel(reportType)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('reports.filters.language')}</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            {LANGUAGES.map((code) => (
              <option key={code || 'all'} value={code}>
                {code ? t(`language.options.${code}`) : t('reports.filters.allLanguages')}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{t('reports.filters.apply')}</button>
      </form>

      {isLoading ? <LoadingState variant="skeleton" rows={4} /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!isLoading && !error ? (
        documents.length ? (
          <section className="content-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('reports.columns.type')}</th>
                    <th>{t('reports.columns.vehicle')}</th>
                    <th>{t('reports.columns.language')}</th>
                    <th>{t('reports.columns.created')}</th>
                    <th>{t('reports.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id}>
                      <td>{reportTypeLabel(document.related_type)}</td>
                      <td>{document.vehicle_label || t('common.notAvailable')}</td>
                      <td>{document.language ? t(`language.options.${document.language}`) : t('common.notAvailable')}</td>
                      <td>{document.created_at ? dateFormatter.format(new Date(document.created_at)) : t('common.notAvailable')}</td>
                      <td>
                        <a className="button-link secondary-button" href={mediaDownloadUrl(document)}>
                          {t('reports.download')}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <EmptyState title={t('reports.empty.title')} description={t('reports.empty.body')} />
        )
      ) : null}
    </section>
  );
}
