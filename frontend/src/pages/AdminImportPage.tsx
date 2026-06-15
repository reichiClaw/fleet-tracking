import { type ChangeEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commitVehicleImport, uploadVehicleImport, type ImportJob } from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';

export function AdminImportPage() {
  const { i18n, t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setJob(null);
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

  function importErrorLabel(errorItem: { field: string; message: string }) {
    return t('imports.errorFormat', { field: importFieldLabel(errorItem.field), message: errorItem.message });
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('imports.eyebrow')}</p>
        <h2>{t('imports.title')}</h2>
        <p>{t('imports.description')}</p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <section className="content-card form-stack">
        <label>
          <span>{t('imports.fileLabel')}</span>
          <input accept=".xlsx,.xls" type="file" onChange={handleFileChange} />
        </label>
        <p className="hint-text">{t('imports.templateHint')}</p>
        <button type="button" disabled={isUploading} onClick={handleUpload}>
          {isUploading ? t('imports.uploading') : t('imports.validate')}
        </button>
      </section>

      {job ? (
        <section className="content-card">
          <div className="card-title-row">
            <div>
              <h3>{t('imports.resultTitle')}</h3>
              <p>{importStatusLabel(job.status)}</p>
            </div>
            <strong>{t('imports.rowSummary', { rows: job.row_count, errors: job.error_count })}</strong>
          </div>

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
