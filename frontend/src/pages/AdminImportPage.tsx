import { type ChangeEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  commitVehicleImport,
  remapVehicleImport,
  uploadVehicleImport,
  type ImportJob,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';

const FALLBACK_TARGET_COLUMNS = [
  'internal_number',
  'category',
  'manufacturer',
  'model',
  'serial_number',
  'license_plate',
  'current_odometer_km',
  'current_operating_hours',
  'current_location',
  'supplier',
  'notes',
];

export function AdminImportPage() {
  const { i18n, t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemapping, setIsRemapping] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    const active = job?.result?.mapping ?? job?.result?.suggested_mapping;
    if (!active) {
      return;
    }
    const next: Record<string, string> = {};
    Object.entries(active).forEach(([column, index]) => {
      next[column] = String(index);
    });
    setMapping(next);
  }, [job]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setJob(null);
    setMapping({});
    setError(null);
  }

  async function handleUpload() {
    if (!file) {
      setError(t('imports.validation.fileRequired'));
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      setJob(await uploadVehicleImport(file));
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('imports.uploadError')));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleApplyMapping() {
    if (!job) {
      return;
    }
    const numericMapping: Record<string, number> = {};
    Object.entries(mapping).forEach(([column, value]) => {
      if (value !== '') {
        numericMapping[column] = Number(value);
      }
    });
    setIsRemapping(true);
    setError(null);
    try {
      setJob(await remapVehicleImport(job.id, numericMapping));
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('imports.uploadError')));
    } finally {
      setIsRemapping(false);
    }
  }

  async function handleCommit() {
    if (!job) {
      return;
    }
    setIsCommitting(true);
    setError(null);
    try {
      setJob(await commitVehicleImport(job.id));
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('imports.commitError')));
    } finally {
      setIsCommitting(false);
    }
  }

  const canCommit = job?.status === 'validated' && job.error_count === 0;

  function importStatusLabel(status: string) {
    const key = `imports.status.${status}`;
    return i18n.exists(key) ? t(key) : t('common.unknown');
  }

  function importActionLabel(action?: string) {
    if (!action) {
      return t('common.notAvailable');
    }
    const key = `imports.actions.${action}`;
    return i18n.exists(key) ? t(key) : t('common.unknown');
  }

  function importFieldLabel(field: string) {
    const key = `imports.fields.${field}`;
    return i18n.exists(key) ? t(key) : field;
  }

  function importErrorLabel(errorItem: { field?: string; message: string }) {
    if (!errorItem.field) {
      return errorItem.message;
    }
    return t('imports.errorFormat', { field: importFieldLabel(errorItem.field), message: errorItem.message });
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('imports.eyebrow')}</p>
        <h2>{t('imports.title')}</h2>
        <p>{t('imports.description')}</p>
        <p className="hint-text">{t('imports.availabilityHint')}</p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <section className="content-card form-stack">
        <label>
          <span>{t('imports.fileLabel')}</span>
          <input accept=".xlsx,.xlsm" type="file" onChange={handleFileChange} />
        </label>
        <p className="hint-text">{t('imports.templateHint')}</p>
        <button type="button" disabled={isUploading} onClick={handleUpload}>
          {isUploading ? t('imports.uploading') : t('imports.validate')}
        </button>
      </section>

      {job?.result?.source_columns?.length && job.status !== 'committed' ? (
        <section className="content-card form-stack">
          <h3>{t('imports.mapping.title')}</h3>
          <p className="hint-text">{t('imports.mapping.description')}</p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('imports.mapping.targetColumn')}</th>
                  <th>{t('imports.mapping.sourceColumn')}</th>
                </tr>
              </thead>
              <tbody>
                {(job.result.columns ?? FALLBACK_TARGET_COLUMNS).map((column) => {
                  const isRequired = (job.result?.required_columns ?? []).includes(column);
                  return (
                    <tr key={column}>
                      <td>
                        <label htmlFor={`map-${column}`}>
                          {importFieldLabel(column)}
                          {isRequired ? ` (${t('imports.mapping.requiredTag')})` : ''}
                        </label>
                      </td>
                      <td>
                        <select
                          id={`map-${column}`}
                          value={mapping[column] ?? ''}
                          onChange={(event) =>
                            setMapping((current) => ({ ...current, [column]: event.target.value }))
                          }
                        >
                          <option value="">{t('imports.mapping.notMapped')}</option>
                          {job.result?.source_columns?.map((source) => (
                            <option key={source.index} value={String(source.index)}>
                              {source.label}
                              {source.sample ? ` — ${source.sample}` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={isRemapping} onClick={handleApplyMapping}>
            {isRemapping ? t('imports.mapping.applying') : t('imports.mapping.apply')}
          </button>
        </section>
      ) : null}

      {job ? (
        <section className="content-card">
          <div className="card-title-row">
            <div>
              <h3>{t('imports.resultTitle')}</h3>
              <p>{importStatusLabel(job.status)}</p>
            </div>
            <strong>{t('imports.rowSummary', { rows: job.row_count, errors: job.error_count })}</strong>
          </div>

          {job.result?.errors?.length ? (
            <div className="import-errors">
              <h4>{t('imports.errorsTitle')}</h4>
              <ul>
                {job.result.errors.map((errorItem, index) => (
                  <li key={`${errorItem.field ?? 'file'}-${index}`} className="field-error">
                    {importErrorLabel(errorItem)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {job.result?.rows?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('imports.table.row')}</th>
                    <th>{t('imports.table.action')}</th>
                    <th>{t('imports.table.errors')}</th>
                  </tr>
                </thead>
                <tbody>
                  {job.result.rows.slice(0, 20).map((row) => (
                    <tr key={row.row_number}>
                      <td>{row.row_number}</td>
                      <td>{importActionLabel(row.action)}</td>
                      <td>
                        {row.errors?.length
                          ? row.errors.map(importErrorLabel).join(t('imports.errorSeparator'))
                          : t('imports.table.noErrors')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <button type="button" disabled={!canCommit || isCommitting} onClick={handleCommit}>
            {isCommitting ? t('imports.committing') : t('imports.commit')}
          </button>
          {!canCommit ? <p className="hint-text">{t('imports.commitHint')}</p> : null}
        </section>
      ) : null}
    </section>
  );
}
