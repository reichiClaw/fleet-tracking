import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  commitVehicleImport,
  excludeVehicleImportRows,
  getImportJob,
  listImportPage,
  remapVehicleImport,
  uploadVehicleImport,
  type ImportJob,
  type PageResult,
} from '../api/fleet';
import { buildApiUrl } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
import { formatDateTime } from '../utils/format';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

const ACTIVE_IMPORT_KEY = 'fleet-active-import-job';
const FALLBACK_TARGET_COLUMNS = [
  'external_key', 'internal_number', 'category', 'manufacturer', 'model', 'serial_number',
  'license_plate', 'current_odometer_km', 'current_operating_hours', 'current_location', 'supplier', 'notes',
];

type ImportRow = NonNullable<NonNullable<ImportJob['result']>['rows']>[number];

function mappingFromJob(job: ImportJob): Record<string, string> {
  const active = job.result?.mapping ?? job.result?.suggested_mapping ?? {};
  return Object.fromEntries(Object.entries(active).map(([column, index]) => [column, String(index)]));
}

export function AdminImportPage() {
  const { i18n, t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [history, setHistory] = useState<ImportJob[]>([]);
  const [historyPage, setHistoryPage] = useState<PageResult<ImportJob> | null>(null);
  const [historyPageNumber, setHistoryPageNumber] = useState(1);
  const [loadingJob, setLoadingJob] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [isRemapping, setIsRemapping] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isExcluding, setIsExcluding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [rowPage, setRowPage] = useState(1);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);
  const mappingDirty = Boolean(job)
    && JSON.stringify(mapping) !== JSON.stringify(mappingFromJob(job as ImportJob));
  useDirtyFormWarning(Boolean(file || mappingDirty) && job?.status !== 'committed', t('forms.unsaved'));

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoadingHistory(true);
    listImportPage(historyPageNumber, controller.signal)
      .then((next) => {
        if (!active) return;
        setHistory(next.results);
        setHistoryPage(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [historyPageNumber, historyReload]);

  useEffect(() => {
    const requested = params.get('job') || window.sessionStorage.getItem(ACTIVE_IMPORT_KEY);
    if (!requested || requested === job?.id) return;
    void openJob(requested);
    // Loading is intentionally keyed by URL/session state, not the current job object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (!job?.id || params.get('job') === job.id) return;
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('job', job.id);
      return next;
    }, { replace: true });
  }, [job?.id, params, setParams]);

  async function openJob(id: string) {
    setLoadingJob(true);
    setError(null);
    try {
      const nextJob = await getImportJob(id);
      activateJob(nextJob);
    } catch (loadError) {
      window.sessionStorage.removeItem(ACTIVE_IMPORT_KEY);
      setError(getApiErrorMessage(loadError, t, t('imports.loadJobError')));
    } finally {
      setLoadingJob(false);
    }
  }

  function activateJob(nextJob: ImportJob) {
    setJob(nextJob);
    setMapping(mappingFromJob(nextJob));
    setRowPage(1);
    window.sessionStorage.setItem(ACTIVE_IMPORT_KEY, nextJob.id);
  }

  function startNew() {
    setFile(null);
    setJob(null);
    setMapping({});
    setError(null);
    setNotice(null);
    setRowPage(1);
    window.sessionStorage.removeItem(ACTIVE_IMPORT_KEY);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('job');
      return next;
    }, { replace: true });
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
  }

  async function handleUpload() {
    if (isUploading) return;
    if (!file) {
      setError(t('imports.validation.fileRequired'));
      return;
    }
    setIsUploading(true);
    setError(null);
    setNotice(null);
    try {
      const nextJob = await uploadVehicleImport(file);
      setFile(null);
      activateJob(nextJob);
      setHistoryReload((value) => value + 1);
    } catch (uploadError) {
      setError(getApiErrorMessage(uploadError, t, t('imports.uploadError')));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleApplyMapping() {
    if (!job || isRemapping) return;
    const numericMapping = Object.fromEntries(
      Object.entries(mapping).filter(([, value]) => value !== '').map(([column, value]) => [column, Number(value)]),
    );
    setIsRemapping(true);
    setError(null);
    try {
      activateJob(await remapVehicleImport(job.id, numericMapping));
      setNotice(t('imports.mapping.applied'));
    } catch (remapError) {
      setError(getApiErrorMessage(remapError, t, t('imports.uploadError')));
    } finally {
      setIsRemapping(false);
    }
  }

  async function setRowExcluded(row: ImportRow, excluded: boolean) {
    if (!job || isExcluding) return;
    const excludedRows = (job.result?.rows ?? [])
      .filter((item) => item.excluded)
      .map((item) => item.row_number)
      .filter((number) => number !== row.row_number);
    if (excluded) excludedRows.push(row.row_number);
    setIsExcluding(true);
    setError(null);
    try {
      activateJob(await excludeVehicleImportRows(job.id, excludedRows));
      setNotice(t(excluded ? 'imports.rowExcluded' : 'imports.rowIncluded', { row: row.row_number }));
    } catch (excludeError) {
      setError(getApiErrorMessage(excludeError, t, t('imports.excludeError')));
    } finally {
      setIsExcluding(false);
    }
  }

  async function handleCommit() {
    if (!job || isCommitting) return;
    setConfirmCommit(false);
    setIsCommitting(true);
    setError(null);
    setNotice(null);
    try {
      const committed = await commitVehicleImport(job.id);
      activateJob(committed);
      setNotice(t('imports.committed'));
      setHistoryReload((value) => value + 1);
    } catch (commitError) {
      setError(getApiErrorMessage(commitError, t, t('imports.commitError')));
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleTemplateDownload(language: 'de' | 'en') {
    if (isDownloadingTemplate) return;
    setIsDownloadingTemplate(true);
    setError(null);
    try {
      await downloadTemplate(language);
    } catch (downloadError) {
      setError(getApiErrorMessage(downloadError, t, t('imports.templateDownloadError')));
    } finally {
      setIsDownloadingTemplate(false);
    }
  }

  const rows = job?.result?.rows ?? [];
  const pageSize = 25;
  const visibleRows = rows.slice((rowPage - 1) * pageSize, rowPage * pageSize);
  const rowsPage: PageResult<ImportRow> = {
    count: rows.length,
    page: rowPage,
    pageSize,
    results: visibleRows,
    previous: rowPage > 1 ? 'previous' : null,
    next: rowPage * pageSize < rows.length ? 'next' : null,
  };
  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const canCommit = job?.status === 'validated' && job.error_count === 0;

  function exportReview() {
    const lines = [
      ['row', 'included', 'action', 'errors', 'changes'],
      ...rows.map((row) => [
        row.row_number,
        row.excluded ? 'no' : 'yes',
        row.action ?? '',
        (row.errors ?? []).map((item) => item.message).join('; '),
        (row.diff ?? []).filter((diff) => diff.changed).map((diff) => `${diff.field}: ${displayDiffValue(diff.old, diff.field, t)} -> ${displayDiffValue(diff.new, diff.field, t)}`).join('; '),
      ]),
    ];
    downloadCsv(`import-${job?.id ?? 'review'}-review.csv`, lines);
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('imports.eyebrow')}
        title={t('imports.title')}
        description={t('imports.description')}
        actions={job ? <button type="button" className="secondary-button" onClick={startNew}>{t('imports.startNew')}</button> : undefined}
      />
      <p className="info-panel">{t('imports.availabilityHint')}</p>
      {error ? <ErrorState message={error} /> : null}
      {notice ? <p className="success-panel" role="status" aria-live="polite">{notice}</p> : null}

      {!job ? (
        <section className="content-card form-stack">
          <h3>{t('imports.newTitle')}</h3>
          <div className="action-row action-row--wrap">
            <button type="button" className="secondary-button" disabled={isDownloadingTemplate} onClick={() => void handleTemplateDownload('de')}>{t('imports.downloadTemplateDe')}</button>
            <button type="button" className="secondary-button" disabled={isDownloadingTemplate} onClick={() => void handleTemplateDownload('en')}>{t('imports.downloadTemplateEn')}</button>
          </div>
          <p className="hint-text">{t('imports.templateHint')}</p>
          <label>
            <span>{t('imports.fileLabel')}</span>
            <input accept=".xlsx,.xlsm" type="file" onChange={handleFileChange} />
          </label>
          <button type="button" disabled={isUploading} onClick={handleUpload}>
            {isUploading ? t('imports.uploading') : t('imports.validate')}
          </button>
        </section>
      ) : (
        <>
          <section className="content-card">
            <div className="card-title-row">
              <div>
                <h3>{t('imports.activeJob')}</h3>
                <p>{t('imports.jobId', { id: job.id })}</p>
              </div>
              <span className={`status-badge status-badge--${job.status === 'committed' ? 'available' : job.status === 'failed' ? 'damaged' : 'announced'}`}>
                {importStatusLabel(job.status, t, i18n.exists)}
              </span>
            </div>
            <div className="action-row action-row--wrap">
              {job.source_media ? <a className="button-link secondary-button" href={buildApiUrl(`/media/${job.source_media}/download/`)}>{t('imports.downloadSource')}</a> : null}
              {job.error_count ? <a className="button-link secondary-button" href={buildApiUrl(`/imports/${job.id}/errors-csv/`)}>{t('imports.downloadErrors')}</a> : null}
              {rows.length ? <button type="button" className="secondary-button" onClick={exportReview}>{t('imports.downloadReview')}</button> : null}
              {job.status === 'committed' ? <a className="button-link secondary-button" href={buildApiUrl(`/imports/${job.id}/generated-ids-csv/`)}>{t('imports.downloadGeneratedIds')}</a> : null}
            </div>
          </section>

          {job.result?.source_columns?.length && job.status !== 'committed' ? (
            <section className="content-card form-stack">
              <h3>{t('imports.mapping.title')}</h3>
              <p className="hint-text">{t('imports.mapping.description')}</p>
              <div className="table-scroll">
                <table>
                  <caption>{t('imports.mapping.caption')}</caption>
                  <thead><tr><th scope="col">{t('imports.mapping.targetColumn')}</th><th scope="col">{t('imports.mapping.sourceColumn')}</th></tr></thead>
                  <tbody>
                    {(job.result.columns ?? FALLBACK_TARGET_COLUMNS).map((column) => (
                      <tr key={column}>
                        <th scope="row"><label htmlFor={`map-${column}`}>{importFieldLabel(column, t, i18n.exists)}{(job.result?.required_columns ?? []).includes(column) ? ` (${t('imports.mapping.requiredTag')})` : ''}</label></th>
                        <td><select id={`map-${column}`} value={mapping[column] ?? ''} onChange={(event) => setMapping((current) => ({ ...current, [column]: event.target.value }))}>
                          <option value="">{t('imports.mapping.notMapped')}</option>
                          {job.result?.source_columns?.map((source) => <option key={source.index} value={String(source.index)}>{source.label}{source.sample ? ` — ${source.sample}` : ''}</option>)}
                        </select></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" disabled={isRemapping} onClick={() => void handleApplyMapping()}>{isRemapping ? t('imports.mapping.applying') : t('imports.mapping.apply')}</button>
            </section>
          ) : null}

          <section className="content-card">
            <h3>{t('imports.resultTitle')}</h3>
            <div className="summary-grid import-summary">
              {(['create', 'update', 'clear', 'fallback', 'error', 'excluded'] as const).map((key) => (
                <article className="summary-card" key={key}><span>{t(`imports.summary.${key}`)}</span><strong>{summary[key]}</strong></article>
              ))}
            </div>
            {job.result?.errors?.length ? <ImportErrors errors={job.result.errors} /> : null}
            {rows.length ? (
              <>
                <div className="import-row-list">
                  {visibleRows.map((row) => (
                    <ImportReviewRow
                      key={row.row_number}
                      row={row}
                      busy={isExcluding}
                      onExcluded={(excluded) => void setRowExcluded(row, excluded)}
                    />
                  ))}
                </div>
                {rows.length > pageSize ? <PaginationControls page={rowsPage} onPageChange={setRowPage} /> : null}
              </>
            ) : <EmptyState title={t('imports.noRows')} />}
            {job.status === 'committed' ? (
              <div className="success-panel">
                <p>{t('imports.committedSummary', { created: job.result?.commit?.created_count ?? 0, updated: job.result?.commit?.updated_count ?? 0 })}</p>
                <Link className="button-link success-button" to="/app/tasks#arrivals_awaiting_check_in">{t('imports.checkInAnnounced')}</Link>
              </div>
            ) : (
              <>
                <button type="button" disabled={!canCommit || isCommitting} onClick={() => setConfirmCommit(true)}>{isCommitting ? t('imports.committing') : t('imports.commit')}</button>
                {!canCommit ? <p className="hint-text">{t('imports.commitHint')}</p> : null}
              </>
            )}
          </section>
        </>
      )}

      <section className="content-card">
        <h3>{t('imports.history.title')}</h3>
        <p className="hint-text">{t('imports.history.description')}</p>
        {loadingHistory ? <LoadingState variant="skeleton" rows={3} /> : history.length ? (
          <div className="table-scroll">
            <table>
              <caption>{t('imports.history.caption')}</caption>
              <thead><tr>
                <th scope="col">{t('imports.history.created')}</th>
                <th scope="col">{t('imports.history.creator')}</th>
                <th scope="col">{t('imports.history.status')}</th>
                <th scope="col">{t('imports.history.rows')}</th>
                <th scope="col">{t('imports.history.actions')}</th>
              </tr></thead>
              <tbody>{history.map((item, index) => {
                const superseded = item.status !== 'committed' && index > 0 && history.some((newer, newerIndex) => newerIndex < index && newer.status !== 'committed');
                return <tr key={item.id}>
                  <td>{formatDateTime(item.created_at, i18n.language, t('common.notAvailable'))}</td>
                  <td>{item.created_by || t('common.notAvailable')}</td>
                  <td>{superseded ? t('imports.status.superseded') : importStatusLabel(item.status, t, i18n.exists)}</td>
                  <td>{item.row_count ?? 0}</td>
                  <td><div className="action-row">
                    <button type="button" className="secondary-button" onClick={() => void openJob(item.id)}>{item.status === 'committed' ? t('imports.history.reopen') : t('imports.history.resume')}</button>
                    {item.source_media ? <a href={buildApiUrl(`/media/${item.source_media}/download/`)}>{t('imports.downloadSource')}</a> : null}
                  </div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState title={t('imports.history.empty')} />}
        {historyPage ? <PaginationControls page={historyPage} onPageChange={setHistoryPageNumber} /> : null}
      </section>

      {loadingJob ? <LoadingState /> : null}
      <ConfirmDialog
        open={confirmCommit}
        title={summary.clear ? t('imports.confirmDestructiveTitle') : t('imports.confirmTitle')}
        description={summary.clear
          ? t('imports.confirmDestructiveDescription', { count: summary.clear, rows: rows.length - summary.excluded })
          : t('imports.confirmDescription', { count: rows.length - summary.excluded })}
        confirmLabel={t('imports.commit')}
        busy={isCommitting}
        onCancel={() => setConfirmCommit(false)}
        onConfirm={() => void handleCommit()}
      />
    </section>
  );
}

function ImportReviewRow({ row, busy, onExcluded }: { row: ImportRow; busy: boolean; onExcluded: (excluded: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const values = row.values ?? row.data ?? {};
  const changes = (row.diff ?? []).filter((item) => item.changed || item.explicit_clear);
  return (
    <article className={`content-card import-review-row${row.excluded ? ' is-excluded' : ''}`}>
      <div className="card-title-row">
        <div>
          <h4>{t('imports.review.rowTitle', { row: row.row_number })}</h4>
          <p>{t('imports.review.identity', {
            identity: values.external_key || values.internal_number || `${values.manufacturer ?? ''} ${values.model ?? ''}`.trim() || t('common.unknown'),
          })}</p>
        </div>
        <label className="checkbox-inline">
          <input type="checkbox" checked={!row.excluded} disabled={busy} onChange={(event) => onExcluded(!event.target.checked)} />
          <span>{t('imports.review.include')}</span>
        </label>
      </div>
      <p><strong>{t('imports.table.action')}:</strong> {importActionLabel(row.action, t, i18n.exists)}</p>
      {row.action === 'update' ? <p className="hint-text">{t('imports.review.matchedTarget', { target: matchedTarget(row, t) })}</p> : null}
      <p className="hint-text">{t('imports.review.presentColumns', { columns: (row.present_fields ?? []).map((field) => importFieldLabel(field, t, i18n.exists)).join(', ') || t('common.notAvailable') })}</p>
      {changes.length ? <dl className="import-diff">{changes.map((diff) => (
        <div key={diff.field} className={diff.explicit_clear ? 'import-diff--clear' : ''}>
          <dt>{importFieldLabel(diff.field, t, i18n.exists)}</dt>
          <dd>
            <span>{displayDiffValue(diff.old, diff.field, t)}</span><span aria-hidden="true">→</span><strong>{diff.explicit_clear ? t('imports.review.explicitClear') : displayDiffValue(diff.new, diff.field, t)}</strong>
          </dd>
        </div>
      ))}</dl> : <p className="hint-text">{t('imports.review.noChanges')}</p>}
      {row.supplier_proposal ? <p className={row.supplier_proposal.status === 'create_proposal' ? 'warning-panel' : 'info-panel'}>
        {t(`imports.review.supplier.${row.supplier_proposal.status}`, { name: row.supplier_proposal.name })}
      </p> : null}
      {row.duplicate_candidates?.length ? <details><summary>{t('imports.review.duplicates', { count: row.duplicate_candidates.length })}</summary><ul>
        {row.duplicate_candidates.map((candidate) => <li key={candidate.vehicle_id}><Link to={`/app/vehicles/${candidate.vehicle_id}`}>{candidate.internal_number}</Link> · {candidate.matched_fields.map((field) => importFieldLabel(field, t, i18n.exists)).join(', ')}</li>)}
      </ul></details> : null}
      {row.errors?.length ? <ImportErrors errors={row.errors} /> : null}
    </article>
  );
}

function ImportErrors({ errors }: { errors: Array<{ field?: string; code?: string; message: string }> }) {
  const { t, i18n } = useTranslation();
  return <div className="import-errors"><h4>{t('imports.errorsTitle')}</h4><ul>{errors.map((error, index) => <li key={`${error.field ?? error.code}-${index}`}>{error.field ? `${importFieldLabel(error.field, t, i18n.exists)}: ` : ''}{error.message}</li>)}</ul></div>;
}

function summarizeRows(rows: ImportRow[]) {
  return rows.reduce((summary, row) => {
    if (row.excluded) summary.excluded += 1;
    else if (row.errors?.length) summary.error += 1;
    else if (row.action === 'create') summary.create += 1;
    else if (row.action === 'update') summary.update += 1;
    if (!row.excluded && row.diff?.some((diff) => diff.explicit_clear)) summary.clear += 1;
    if (!row.excluded && row.diff?.some((diff) => diff.field === 'category' && diff.new === 'Sonstiges')) summary.fallback += 1;
    return summary;
  }, { create: 0, update: 0, clear: 0, fallback: 0, error: 0, excluded: 0 });
}

function importStatusLabel(status: string, t: (key: string) => string, exists: (key: string) => boolean) {
  const key = `imports.status.${status}`;
  return exists(key) ? t(key) : t('common.unknown');
}

function importActionLabel(action: string | undefined, t: (key: string) => string, exists: (key: string) => boolean) {
  if (!action) return t('common.notAvailable');
  const key = `imports.actions.${action}`;
  return exists(key) ? t(key) : t('common.unknown');
}

function importFieldLabel(field: string, t: (key: string) => string, exists: (key: string) => boolean) {
  const key = `imports.fields.${field}`;
  return exists(key) ? t(key) : field.replaceAll('_', ' ');
}

function displayDiffValue(value: unknown, field: string, t: (key: string) => string) {
  if (value === undefined || value === null || value === '') return t('imports.review.emptyValue');
  if (field === 'category' && value === 'Sonstiges') return t('imports.review.fallbackCategory');
  return String(value);
}

function matchedTarget(row: ImportRow, t: (key: string) => string) {
  const internal = row.diff?.find((item) => item.field === 'internal_number')?.old;
  const external = row.diff?.find((item) => item.field === 'external_key')?.old;
  return String(external || internal || t('imports.review.existingVehicle'));
}

async function downloadTemplate(language: 'de' | 'en') {
  const response = await fetch(buildApiUrl('/imports/vehicle-template/'), {
    credentials: 'include',
    headers: { 'Accept-Language': language },
  });
  if (!response.ok) throw new Error('Template download failed');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `vehicle-import-template-${language}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, lines: unknown[][]) {
  const csv = `\ufeff${lines.map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
