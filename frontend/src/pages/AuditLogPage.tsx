import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  listAuditLogPage,
  listUsers,
  type AuditLogEntry,
  type AuditLogFilters,
  type ManagedUser,
  type PageResult,
} from '../api/fleet';
import { buildApiUrl } from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
import { formatDateTime } from '../utils/format';

const ENTITY_TYPES = ['', 'vehicle', 'user', 'company', 'driver', 'vehicle_category', 'import_job', 'document_register'];
const AREAS = ['', 'import.', 'workflow.', 'vehicle.', 'user.', 'document.'];

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [resultPage, setResultPage] = useState<PageResult<AuditLogEntry> | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const [draft, setDraft] = useState<AuditLogFilters>({});
  const [area, setArea] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    listUsers().then(setUsers).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listAuditLogPage(filters, page, controller.signal)
      .then((nextPage) => {
        if (!active) return;
        setEntries(nextPage.results);
        setResultPage(nextPage);
      })
      .catch((loadError) => {
        if (active && !controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, t, t('audit.loadError')));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [filters, page, reload, t]);

  const actorNames = useMemo(
    () => new Map(users.map((user) => [user.id, user.full_name || user.username])),
    [users],
  );
  const exportUrl = buildApiUrl('/audit-logs/export-csv/', filters);

  function apply(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft, action: draft.action?.trim() || area || undefined });
    setPage(1);
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('audit.eyebrow')}
        title={t('audit.title')}
        description={t('audit.description')}
        actions={<a className="button-link secondary-button" href={exportUrl}>{t('audit.export')}</a>}
      />
      <p className="info-panel">{t('audit.vehicleHistoryDistinction')}</p>
      <form className="filter-panel admin-filter-grid" onSubmit={apply}>
        <label>
          <span>{t('audit.filters.area')}</span>
          <select value={area} onChange={(event) => setArea(event.target.value)}>
            {AREAS.map((value) => <option key={value || 'all'} value={value}>{t(`audit.areas.${value ? value.slice(0, -1) : 'all'}`)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('audit.filters.action')}</span>
          <input value={draft.action ?? ''} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} placeholder={t('audit.filters.actionPlaceholder')} />
        </label>
        <label>
          <span>{t('audit.filters.entity')}</span>
          <select value={draft.entity_type ?? ''} onChange={(event) => setDraft((current) => ({ ...current, entity_type: event.target.value }))}>
            {ENTITY_TYPES.map((value) => <option key={value || 'all'} value={value}>{value ? entityTypeLabel(value, t, i18n.exists) : t('audit.filters.allEntities')}</option>)}
          </select>
        </label>
        <label>
          <span>{t('audit.filters.actor')}</span>
          <select value={draft.actor ?? ''} onChange={(event) => setDraft((current) => ({ ...current, actor: event.target.value }))}>
            <option value="">{t('audit.filters.allActors')}</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.username}</option>)}
          </select>
        </label>
        <label>
          <span>{t('audit.filters.dateFrom')}</span>
          <input type="date" value={draft.date_from ?? ''} onChange={(event) => setDraft((current) => ({ ...current, date_from: event.target.value }))} />
        </label>
        <label>
          <span>{t('audit.filters.dateTo')}</span>
          <input type="date" value={draft.date_to ?? ''} onChange={(event) => setDraft((current) => ({ ...current, date_to: event.target.value }))} />
        </label>
        <button type="submit">{t('audit.filters.apply')}</button>
      </form>

      {loading ? <LoadingState variant="skeleton" rows={5} /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /> : null}
      {!loading && !error && entries.length ? (
        <section className="content-card">
          <div className="table-scroll desktop-data-table">
            <table>
              <caption>{t('audit.caption')}</caption>
              <thead><tr>
                <th scope="col">{t('audit.columns.date')}</th>
                <th scope="col">{t('audit.columns.actor')}</th>
                <th scope="col">{t('audit.columns.action')}</th>
                <th scope="col">{t('audit.columns.entity')}</th>
                <th scope="col">{t('audit.columns.changes')}</th>
              </tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDateTime(entry.created_at, i18n.language, t('common.notAvailable'))}</td>
                    <td>{entry.actor ? actorNames.get(entry.actor) || entry.actor : t('audit.system')}</td>
                    <td>{actionLabel(entry.action, t, i18n.exists)}</td>
                    <td><EntityLink entry={entry} /></td>
                    <td><AuditDiff entry={entry} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-data-cards">
            {entries.map((entry) => (
              <article className="data-card" key={entry.id}>
                <strong>{actionLabel(entry.action, t, i18n.exists)}</strong>
                <span>{formatDateTime(entry.created_at, i18n.language)}</span>
                <span>{entry.actor ? actorNames.get(entry.actor) || entry.actor : t('audit.system')}</span>
                <EntityLink entry={entry} />
                <AuditDiff entry={entry} />
              </article>
            ))}
          </div>
          {resultPage ? <PaginationControls page={resultPage} onPageChange={setPage} /> : null}
        </section>
      ) : null}
      {!loading && !error && !entries.length ? <EmptyState title={t('audit.empty.title')} description={t('audit.empty.description')} /> : null}
    </section>
  );
}

function actionLabel(action: string, t: (key: string) => string, exists: (key: string) => boolean) {
  const key = `audit.actions.${action.replaceAll('.', '_')}`;
  return exists(key) ? t(key) : action;
}

function entityTypeLabel(type: string, t: (key: string) => string, exists: (key: string) => boolean) {
  const key = `audit.entities.${type}`;
  return exists(key) ? t(key) : type;
}

function EntityLink({ entry }: { entry: AuditLogEntry }) {
  const { t, i18n } = useTranslation();
  const label = `${entityTypeLabel(entry.entity_type, t, i18n.exists)}${entry.entity_id ? ` · ${entry.entity_id}` : ''}`;
  if (!entry.entity_id) return <span>{label}</span>;
  const routes: Record<string, string> = {
    vehicle: `/app/vehicles/${entry.entity_id}`,
    import_job: `/app/imports?job=${entry.entity_id}`,
  };
  const route = routes[entry.entity_type];
  return route ? <Link to={route}>{label}</Link> : <span>{label}</span>;
}

function AuditDiff({ entry }: { entry: AuditLogEntry }) {
  const { t, i18n } = useTranslation();
  const fields = Array.from(new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]));
  if (!fields.length) return <span>{t('audit.noDiff')}</span>;
  return (
    <details>
      <summary>{t('audit.showDiff', { count: fields.length })}</summary>
      <dl className="audit-diff">
        {fields.map((field) => {
          const key = `apiFields.${field}`;
          const label = i18n.exists(key) ? t(key) : field.replaceAll('_', ' ');
          return (
            <div key={field}>
              <dt>{label}</dt>
              <dd><span>{displayValue(entry.before?.[field], t('audit.emptyValue'))}</span><span aria-hidden="true">→</span><span>{displayValue(entry.after?.[field], t('audit.emptyValue'))}</span></dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}

function displayValue(value: unknown, empty: string) {
  if (value === undefined || value === null || value === '') return empty;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
