import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  getSetupReadiness,
  listDrivers,
  type SetupReadiness,
  type SetupReadinessItem,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { AdminInbox, SetupStatusCard } from '../components/AdminOverview';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';

type SetupStep = {
  id: string;
  ready: boolean;
  optional?: boolean;
  detail: string;
  links: Array<{ to: string; label: string }>;
};

export function SetupPage() {
  const { t } = useTranslation();
  const [readiness, setReadiness] = useState<SetupReadiness | null>(null);
  const [driverCount, setDriverCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([getSetupReadiness(controller.signal), listDrivers()])
      .then(([nextReadiness, drivers]) => {
        if (!active) return;
        setReadiness(nextReadiness);
        setDriverCount(drivers.length);
      })
      .catch((loadError) => {
        if (active && !controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, t, t('setup.loadError')));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reload, t]);

  const steps = useMemo(() => readiness ? buildSteps(readiness, driverCount, t) : [], [driverCount, readiness, t]);

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('setup.eyebrow')}
        title={t('setup.title')}
        description={t('setup.description')}
        actions={<button type="button" className="secondary-button" onClick={() => setReload((value) => value + 1)}>{t('setup.refresh')}</button>}
      />
      {loading ? <LoadingState variant="skeleton" rows={5} /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /> : null}
      {!loading && readiness ? (
        <>
          <SetupStatusCard readiness={readiness} />
          {!readiness.ready ? <p className="warning-panel" role="status">{t('setup.recommendation')}</p> : null}
          <ol className="setup-checklist">
            {steps.map((step, index) => (
              <li key={step.id} className={`content-card${step.ready ? ' setup-step--ready' : ''}`}>
                <div className="setup-step__status" aria-hidden="true">{step.ready ? '✓' : index + 1}</div>
                <div>
                  <div className="card-title-row">
                    <h3>{t(`setup.steps.${step.id}.title`)}</h3>
                    <span className={`status-badge status-badge--${step.ready ? 'available' : 'announced'}`}>
                      {step.optional ? t('setup.optional') : step.ready ? t('setup.ready') : t('setup.todo')}
                    </span>
                  </div>
                  <p>{t(`setup.steps.${step.id}.description`)}</p>
                  <p className="hint-text">{step.detail}</p>
                  <div className="action-row action-row--wrap">
                    {step.links.map((link) => (
                      <Link className="button-link secondary-button" key={`${step.id}-${link.to}`} to={link.to}>{link.label}</Link>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div id="backup-guidance" className="content-card">
            <h3>{t('setup.backupGuidance.title')}</h3>
            <p>{t('setup.backupGuidance.description')}</p>
          </div>
          <AdminInbox />
        </>
      ) : null}
    </section>
  );
}

function item(readiness: SetupReadiness, id: SetupReadinessItem['id']) {
  return readiness.checklist.find((entry) => entry.id === id);
}

function buildSteps(
  readiness: SetupReadiness,
  driverCount: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): SetupStep[] {
  const categories = item(readiness, 'categories');
  const suppliers = item(readiness, 'supplier_or_manufacturer');
  const users = item(readiness, 'users');
  const vehicles = item(readiness, 'vehicles');
  const qr = item(readiness, 'qr_codes');
  const documents = item(readiness, 'documents');
  const backup = item(readiness, 'backup');
  const security = readiness.admin_security;
  const securityReady = security.active_admin_exists
    && security.temporary_password_count === 0
    && !security.debug
    && security.secure_cookies;

  return [
    {
      id: 'security',
      ready: securityReady,
      detail: t('setup.steps.security.detail', {
        admins: security.superuser_count,
        temporary: security.temporary_password_count,
      }),
      links: [
        { to: '/app/change-password', label: t('setup.actions.changePassword') },
        { to: '/app/users', label: t('setup.actions.manageUsers') },
      ],
    },
    {
      id: 'users',
      ready: Boolean(users?.ready),
      detail: t('setup.steps.users.detail', { count: users?.count ?? 0 }),
      links: [{ to: '/app/users', label: t('setup.actions.manageUsers') }],
    },
    {
      id: 'categories',
      ready: Boolean(categories?.ready),
      detail: t('setup.steps.categories.detail', { count: categories?.count ?? 0 }),
      links: [{ to: '/app/categories', label: t('setup.actions.manageCategories') }],
    },
    {
      id: 'suppliers',
      ready: Boolean(suppliers?.ready),
      detail: t('setup.steps.suppliers.detail', { count: suppliers?.count ?? 0 }),
      links: [{ to: '/app/directory', label: t('setup.actions.openDirectory') }],
    },
    {
      id: 'drivers',
      ready: true,
      optional: true,
      detail: t('setup.steps.drivers.detail', { count: driverCount }),
      links: [{ to: '/app/directory', label: t('setup.actions.openDirectory') }],
    },
    {
      id: 'vehicles',
      ready: Boolean(vehicles?.ready),
      detail: t('setup.steps.vehicles.detail', { count: vehicles?.count ?? 0 }),
      links: [
        { to: '/app/imports', label: t('setup.actions.importVehicles') },
        { to: '/app/workflows/add-vehicle', label: t('setup.actions.addVehicle') },
      ],
    },
    {
      id: 'checkins',
      ready: (vehicles?.announced_awaiting_check_in ?? 0) === 0,
      detail: t('setup.steps.checkins.detail', { count: vehicles?.announced_awaiting_check_in ?? 0 }),
      links: [{ to: '/app/tasks#arrivals_awaiting_check_in', label: t('setup.actions.openCheckins') }],
    },
    {
      id: 'qr',
      ready: Boolean(qr?.ready),
      detail: t('setup.steps.qr.detail', { count: qr?.missing_count ?? 0 }),
      links: [{ to: '/app/qr/print', label: t('setup.actions.manageQr') }],
    },
    {
      id: 'documents',
      ready: Boolean(documents?.ready),
      detail: t('setup.steps.documents.detail', { count: documents?.failed_count ?? 0 }),
      links: [{ to: '/app/documents', label: t('setup.actions.openDocuments') }],
    },
    {
      id: 'backup',
      ready: Boolean(backup?.ready),
      detail: t(`setup.backupStatus.${backup?.status ?? 'unknown'}`),
      links: [{ to: '/app/setup#backup-guidance', label: t('setup.actions.backupGuidance') }],
    },
  ];
}
