import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  getDashboardTasks,
  getSetupReadiness,
  listCompanyDuplicates,
  listDocumentRegisterPage,
  listDriverDuplicates,
  listImportPage,
  listUserPage,
  type SetupReadiness,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';

export function SetupStatusCard({
  readiness,
  compact = false,
}: {
  readiness: SetupReadiness;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const complete = readiness.checklist.filter((item) => item.ready).length;
  const total = readiness.checklist.length;
  const percentage = total ? Math.round((complete / total) * 100) : 0;
  return (
    <section className={`content-card setup-summary${readiness.ready ? ' setup-summary--ready' : ''}`}>
      <div className="card-title-row">
        <div>
          <h3>{t('setup.summaryTitle')}</h3>
          <p className="hint-text">
            {readiness.ready
              ? t('setup.complete')
              : t('setup.progress', { complete, total })}
          </p>
        </div>
        <strong>{percentage}%</strong>
      </div>
      <progress max={total || 1} value={complete}>{percentage}%</progress>
      {!readiness.ready || !compact ? (
        <Link className="button-link secondary-button" to="/app/setup">
          {readiness.ready ? t('setup.review') : t('setup.continue')}
        </Link>
      ) : null}
    </section>
  );
}

type InboxState = {
  imports: number;
  announced: number;
  duplicates: number;
  documents: number;
  accounts: number;
};

export function AdminInbox({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<InboxState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      listImportPage(1),
      getDashboardTasks(5),
      listCompanyDuplicates(),
      listDriverDuplicates(),
      listDocumentRegisterPage({ status: 'failed' }, 1),
      listDocumentRegisterPage({ status: 'missing' }, 1),
      listUserPage({ status: 'attention' }, 1),
    ])
      .then(([imports, tasks, companies, drivers, failed, missing, users]) => {
        if (!active) return;
        setState({
          imports: imports.results.filter((job) => job.status !== 'committed').length,
          announced: tasks.groups?.arrivals_awaiting_check_in?.count ?? 0,
          duplicates: companies.length + drivers.length,
          documents: failed.count + missing.count,
          accounts: users.count,
        });
        setError(null);
      })
      .catch((loadError) => {
        if (active) setError(getApiErrorMessage(loadError, t, t('adminInbox.loadError')));
      });
    return () => {
      active = false;
    };
  }, [reload, t]);

  if (!state && !error) return <LoadingState variant="skeleton" rows={compact ? 2 : 3} />;
  if (error) return <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} />;
  if (!state) return null;

  const items = [
    { id: 'imports', count: state.imports, to: '/app/imports', label: t('adminInbox.items.imports') },
    { id: 'announced', count: state.announced, to: '/app/tasks#arrivals_awaiting_check_in', label: t('adminInbox.items.announced') },
    { id: 'duplicates', count: state.duplicates, to: '/app/directory?duplicates=true', label: t('adminInbox.items.duplicates') },
    { id: 'documents', count: state.documents, to: '/app/documents?status=attention', label: t('adminInbox.items.documents') },
    { id: 'accounts', count: state.accounts, to: '/app/users?status=attention', label: t('adminInbox.items.accounts') },
  ];
  const visible = compact ? items.filter((item) => item.count > 0) : items;

  return (
    <section className="content-card">
      <div>
        <h3>{t('adminInbox.title')}</h3>
        <p className="hint-text">{t('adminInbox.description')}</p>
      </div>
      {visible.length ? (
        <ul className="admin-inbox">
          {visible.map((item) => (
            <li key={item.id}>
              <Link to={item.to}>
                <strong>{item.count}</strong>
                <span>{item.label}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="success-text">{t('adminInbox.empty')}</p>}
    </section>
  );
}

export function AdminHomePanel() {
  const { t } = useTranslation();
  const [readiness, setReadiness] = useState<SetupReadiness | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getSetupReadiness(controller.signal).then(setReadiness).catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <section className="admin-home" aria-label={t('adminInbox.adminHomeLabel')}>
      {readiness ? <SetupStatusCard readiness={readiness} compact /> : null}
      <AdminInbox compact />
    </section>
  );
}
