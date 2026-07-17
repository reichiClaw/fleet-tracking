import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  listDocumentRegisterPage,
  retryDocuments,
  type DocumentRegisterFilters,
  type DocumentRegisterRow,
  type DocumentRegisterStatus,
  type PageResult,
} from '../api/fleet';
import { buildApiUrl } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
import { formatDateTime } from '../utils/format';

const REPORT_TYPES = [
  'check_in_protocol_pdf',
  'loan_checkout_pdf',
  'loan_return_pdf',
  'manufacturer_checkout_protocol_pdf',
] as const;

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<DocumentRegisterRow[]>([]);
  const [resultPage, setResultPage] = useState<PageResult<DocumentRegisterRow> | null>(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState(() => {
    const requested = params.get('type');
    return requested && REPORT_TYPES.includes(requested as typeof REPORT_TYPES[number]) ? requested : '';
  });
  const record = params.get('record') ?? '';
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState<DocumentRegisterFilters['status']>(() => {
    const requested = params.get('status');
    return requested && ['generated', 'missing', 'failed', 'attention'].includes(requested)
      ? requested as NonNullable<DocumentRegisterFilters['status']>
      : '';
  });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    listDocumentRegisterPage({ search, type, record, language, status }, page, controller.signal)
      .then((nextPage) => {
        if (!active) return;
        setRows(nextPage.results);
        setResultPage(nextPage);
        setSelected((current) => new Set([...current].filter((key) => nextPage.results.some((row) => rowKey(row) === key))));
      })
      .catch((loadError) => {
        if (active && !controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, t, t('reports.loadError')));
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [language, page, record, reload, search, status, t, type]);

  const retryable = rows.filter((row) => row.retry);
  const selectedRows = useMemo(() => retryable.filter((row) => selected.has(rowKey(row))), [retryable, selected]);
  const canRetry = user?.role === 'admin' || user?.role === 'operations';
  const canBulkRetry = user?.role === 'admin';
  const exportUrl = buildApiUrl('/documents/register-export-csv/', { search, type, record, language, status });

  function apply(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function toggle(row: DocumentRegisterRow) {
    const key = rowKey(row);
    setSelected((current) => {
      const next = canBulkRetry ? new Set(current) : new Set<string>();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function retrySelected() {
    if (!canRetry || !selectedRows.length || (!canBulkRetry && selectedRows.length > 1) || isRetrying) return;
    setConfirmRetry(false);
    setIsRetrying(true);
    setError(null);
    setNotice(null);
    try {
      const response = await retryDocuments(selectedRows.map((row) => ({
        document_type: row.document_type,
        record_id: row.record_id,
        language: row.language,
      })));
      setNotice(t('reports.retrySuccess', { count: response.count }));
      setSelected(new Set());
      setReload((value) => value + 1);
    } catch (retryError) {
      setError(getApiErrorMessage(retryError, t, t('reports.retryError')));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('reports.eyebrow')}
        title={t('reports.registerTitle')}
        description={t('reports.registerDescription')}
        actions={<a className="button-link secondary-button" href={exportUrl}>{t('reports.exportIndex')}</a>}
      />
      <p className="info-panel">{t('reports.completenessHint')}</p>
      <form className="filter-panel" onSubmit={apply}>
        <label>
          <span>{t('reports.filters.search')}</span>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('reports.filters.searchPlaceholder')} />
        </label>
        <label>
          <span>{t('reports.filters.status')}</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value as DocumentRegisterFilters['status']); setPage(1); }}>
            <option value="">{t('reports.filters.allStatuses')}</option>
            <option value="attention">{t('reports.filters.attention')}</option>
            {(['generated', 'missing', 'failed'] as const).map((value) => <option key={value} value={value}>{statusLabel(value, t)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('reports.filters.type')}</span>
          <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
            <option value="">{t('reports.filters.allTypes')}</option>
            {REPORT_TYPES.map((value) => <option key={value} value={value}>{reportTypeLabel(value, t, i18n.exists)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('reports.filters.language')}</span>
          <select value={language} onChange={(event) => { setLanguage(event.target.value); setPage(1); }}>
            <option value="">{t('reports.filters.allLanguages')}</option>
            <option value="de">{t('language.options.de')}</option>
            <option value="en">{t('language.options.en')}</option>
          </select>
        </label>
        <button type="submit">{t('reports.filters.apply')}</button>
      </form>

      {notice ? <p className="success-panel" role="status" aria-live="polite">{notice}</p> : null}
      {isRetrying ? <p className="info-panel" role="status">{t('reports.retryProgress', { count: selectedRows.length })}</p> : null}
      {isLoading ? <LoadingState variant="skeleton" rows={4} /> : null}
      {!isLoading && error ? <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /> : null}
      {!isLoading && !error && rows.length ? (
        <section className="content-card">
          {canRetry ? (
            <div className="bulk-toolbar">
              {canBulkRetry ? (
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={retryable.length > 0 && selectedRows.length === retryable.length}
                    onChange={(event) => setSelected(event.target.checked ? new Set(retryable.map(rowKey)) : new Set())}
                  />
                  <span>{t('reports.selectAttention')}</span>
                </label>
              ) : null}
              <strong>{t('reports.selectedCount', { count: selectedRows.length })}</strong>
              <button type="button" disabled={!selectedRows.length || isRetrying} onClick={() => setConfirmRetry(true)}>
                {t(selectedRows.length > 1 ? 'reports.retryBulk' : 'reports.retryOne')}
              </button>
            </div>
          ) : null}
          <div className="table-scroll desktop-data-table">
            <table>
              <caption>{t('reports.registerCaption')}</caption>
              <thead><tr>
                <th scope="col">{t('reports.columns.select')}</th>
                <th scope="col">{t('reports.columns.status')}</th>
                <th scope="col">{t('reports.columns.type')}</th>
                <th scope="col">{t('reports.columns.vehicle')}</th>
                <th scope="col">{t('reports.columns.language')}</th>
                <th scope="col">{t('reports.columns.created')}</th>
                <th scope="col">{t('reports.columns.creator')}</th>
                <th scope="col">{t('reports.columns.actions')}</th>
              </tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={rowKey(row)}>
                    <td>{canRetry && row.retry ? <input type="checkbox" aria-label={t('reports.selectRow', { vehicle: row.vehicle_label })} checked={selected.has(rowKey(row))} onChange={() => toggle(row)} /> : null}</td>
                    <td><span className={`status-badge status-badge--${row.status === 'generated' ? 'available' : row.status === 'failed' ? 'damaged' : 'announced'}`}>{statusLabel(row.status, t)}</span></td>
                    <td>{reportTypeLabel(row.document_type, t, i18n.exists)}</td>
                    <td>
                      <Link to={`/app/vehicles/${row.vehicle_id}`}>{row.vehicle_label}</Link>
                      <small className="table-secondary">{row.license_plate || t('common.notAvailable')}</small>
                      {row.failure_reason ? <small className="field-error">{row.failure_reason}</small> : null}
                    </td>
                    <td>{t(`language.options.${row.language}`)}</td>
                    <td>{formatDateTime(row.performed_at, i18n.language, t('common.notAvailable'))}</td>
                    <td>{row.creator_label || row.creator || t('common.notAvailable')}</td>
                    <td>
                      {row.media_id ? <a className="button-link secondary-button" href={buildApiUrl(`/media/${row.media_id}/download/`)}>{t('reports.download')}</a> : null}
                      {canRetry && row.retry ? <button type="button" className="secondary-button" onClick={() => { setSelected(new Set([rowKey(row)])); setConfirmRetry(true); }}>{t('reports.retryOne')}</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-data-cards">
            {rows.map((row) => (
              <article className="data-card" key={rowKey(row)}>
                <strong>{row.vehicle_label}</strong>
                <span>{statusLabel(row.status, t)} · {reportTypeLabel(row.document_type, t, i18n.exists)}</span>
                <span>{formatDateTime(row.performed_at, i18n.language)}</span>
                {row.failure_reason ? <span className="field-error">{row.failure_reason}</span> : null}
                {row.media_id ? <a href={buildApiUrl(`/media/${row.media_id}/download/`)}>{t('reports.download')}</a> : null}
              </article>
            ))}
          </div>
          {resultPage ? <PaginationControls page={resultPage} onPageChange={setPage} /> : null}
        </section>
      ) : null}
      {!isLoading && !error && !rows.length ? (
        <EmptyState
          title={t('reports.empty.title')}
          description={t('reports.empty.body')}
          action={<Link className="button-link secondary-button" to="/app/tasks">{t('reports.empty.action')}</Link>}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRetry}
        title={t('reports.retryConfirmTitle')}
        description={t('reports.retryConfirmDescription', { count: selectedRows.length })}
        confirmLabel={t(selectedRows.length > 1 ? 'reports.retryBulk' : 'reports.retryOne')}
        busy={isRetrying}
        onCancel={() => setConfirmRetry(false)}
        onConfirm={() => void retrySelected()}
      />
    </section>
  );
}

function rowKey(row: DocumentRegisterRow) {
  return `${row.document_type}:${row.record_id}:${row.language}`;
}

function reportTypeLabel(type: string, t: (key: string) => string, exists: (key: string) => boolean) {
  const key = `reports.types.${type}`;
  return exists(key) ? t(key) : type;
}

function statusLabel(status: DocumentRegisterStatus, t: (key: string) => string) {
  return t(`reports.status.${status}`);
}
