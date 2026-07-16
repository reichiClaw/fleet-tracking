import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  listDocumentPage,
  mediaDownloadUrl,
  type GeneratedDocument,
  type PageResult,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';

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
  const [documentPage, setDocumentPage] = useState<PageResult<GeneratedDocument> | null>(null);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
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
        const nextPage = await listDocumentPage({ search, type, language }, page);
        if (isMounted) {
          setDocuments(nextPage.results);
          setDocumentPage(nextPage);
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
  }, [language, page, reloadToken, search, type, t]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
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
          <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
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
          <select value={language} onChange={(event) => { setLanguage(event.target.value); setPage(1); }}>
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
      {!isLoading && error ? <ErrorState message={error} onRetry={() => setReloadToken((token) => token + 1)} /> : null}

      {!isLoading && !error ? (
        documents.length ? (
          <section className="content-card">
            <div className="table-scroll">
              <table>
                <caption>{t('reports.tableCaption')}</caption>
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
            {documentPage ? <PaginationControls page={documentPage} onPageChange={setPage} /> : null}
          </section>
        ) : (
          <EmptyState title={t('reports.empty.title')} description={t('reports.empty.body')} />
        )
      ) : null}
    </section>
  );
}
