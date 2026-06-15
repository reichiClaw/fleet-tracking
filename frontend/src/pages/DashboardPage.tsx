import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { getDashboardSummary, type DashboardSummary, type VehicleStatus } from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ActivityChart, DonutChart, type DonutSegment } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';

const STATUS_COLORS: Record<string, string> = {
  available: 'var(--success-line)',
  loaned: 'var(--warning-line)',
  maintenance: 'var(--info-line)',
  damaged: 'var(--danger-line)',
  manufacturer_checkout: '#8a6d3b',
  announced: '#64748b',
  checked_in: '#3b82f6',
  reserved: '#06b6d4',
  archived: '#94a3b8',
};

type KpiTone = 'brand' | 'ok' | 'warn' | 'info' | 'danger';

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    fleet: (
      <>
        <path d="M3 13l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5" />
        <path d="M5 13h14v5H5z" />
        <circle cx="7.5" cy="18" r="1.4" />
        <circle cx="16.5" cy="18" r="1.4" />
      </>
    ),
    available: <path d="M20 6L9 17l-5-5" />,
    loaned: (
      <>
        <path d="M4 7h11l-2-2M20 17H9l2 2" />
        <path d="M4 7l3 3M20 17l-3-3" />
      </>
    ),
    maintenance: <path d="M14 7a4 4 0 0 1-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2 2-2-2 2-2z" />,
    damaged: (
      <>
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
    overdue: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    qr: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />,
    pool: <path d="M3 7h18M3 12h18M3 17h18" />,
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 4v4h4" />
        <path d="M12 8v4l3 2" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="kpi-icon">
      {paths[name] ?? null}
    </svg>
  );
}

function KpiCard({
  tone,
  icon,
  label,
  value,
  helper,
}: {
  tone: KpiTone;
  icon: string;
  label: string;
  value: number;
  helper: string;
}) {
  return (
    <article className={`kpi-card kpi-card--${tone}`}>
      <div className="kpi-card__top">
        <span className="kpi-card__icon">
          <Icon name={icon} />
        </span>
        <span className="kpi-card__label">{label}</span>
      </div>
      <strong className="kpi-card__value">{value}</strong>
      <span className="kpi-card__helper">{helper}</span>
    </article>
  );
}

function TrendBadge({ direction, label }: { direction: 'up' | 'down' | 'flat'; label: string }) {
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■';
  return (
    <span className={`trend-badge trend-badge--${direction}`}>
      <span aria-hidden="true">{arrow}</span> {label}
    </span>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const summary = await getDashboardSummary();
        if (isMounted) {
          setData(summary);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getApiErrorMessage(loadError, t, t('dashboard.loadError')));
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
  }, [t, reloadToken]);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }), [i18n.language]);
  const shortDateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language]);

  const statusSegments: DonutSegment[] = useMemo(
    () =>
      (data?.status_distribution ?? []).map((entry) => ({
        key: entry.status,
        label: i18n.exists(`status.${entry.status}`) ? t(`status.${entry.status}`) : entry.status,
        value: entry.count,
        color: STATUS_COLORS[entry.status] ?? '#94a3b8',
      })),
    [data?.status_distribution, i18n, t],
  );

  const activityPoints = useMemo(
    () =>
      (data?.checkouts_series ?? []).map((point) => ({
        label: point.date,
        value: point.count,
      })),
    [data?.checkouts_series],
  );

  const activity = useMemo(() => {
    const series = data?.checkouts_series ?? [];
    const total = series.reduce((sum, point) => sum + point.count, 0);
    const prev7 = series.slice(0, 7).reduce((sum, point) => sum + point.count, 0);
    const last7 = series.slice(7).reduce((sum, point) => sum + point.count, 0);
    let direction: 'up' | 'down' | 'flat' = 'flat';
    let pct = 0;
    if (prev7 === 0 && last7 === 0) {
      direction = 'flat';
    } else if (prev7 === 0) {
      direction = 'up';
      pct = 100;
    } else {
      const change = ((last7 - prev7) / prev7) * 100;
      pct = Math.abs(Math.round(change));
      direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
    }
    return { total, direction, pct };
  }, [data?.checkouts_series]);

  if (isLoading) {
    return (
      <section className="page-stack">
        <PageHeader eyebrow={t('dashboard.eyebrow')} title={t('dashboard.title')} description={t('dashboard.description')} />
        <LoadingState variant="skeleton" rows={4} />
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className="page-stack">
        <PageHeader eyebrow={t('dashboard.eyebrow')} title={t('dashboard.title')} description={t('dashboard.description')} />
        <ErrorState message={error ?? t('dashboard.loadError')} onRetry={() => setReloadToken((token) => token + 1)} />
      </section>
    );
  }

  const totals = data.totals;
  const canManageVehicles = user?.role === 'admin';

  if (totals.vehicles === 0) {
    return (
      <section className="page-stack">
        <PageHeader eyebrow={t('dashboard.eyebrow')} title={t('dashboard.title')} description={t('dashboard.description')} />
        <EmptyState
          title={t('dashboard.empty.title')}
          description={t('dashboard.empty.body')}
          action={
            canManageVehicles ? (
              <Link className="button-link" to="/app/workflows/add-vehicle">
                {t('dashboard.empty.action')}
              </Link>
            ) : (
              <Link className="button-link" to="/app/vehicles">
                {t('dashboard.secondaryAction')}
              </Link>
            )
          }
        />
      </section>
    );
  }

  const trendLabel =
    activity.direction === 'up'
      ? t('dashboard.activity.trendUp', { pct: activity.pct })
      : activity.direction === 'down'
        ? t('dashboard.activity.trendDown', { pct: activity.pct })
        : t('dashboard.activity.trendFlat');

  return (
    <section className="page-stack dashboard">
      <PageHeader
        eyebrow={t('dashboard.asOf', { date: dateFormatter.format(new Date(data.generated_at)) })}
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        actions={
          <div className="action-row action-row--wrap">
            <Link className="button-link" to="/app/workflows/loan-checkout">
              {t('dashboard.primaryAction')}
            </Link>
            <Link className="button-link secondary-button" to="/app/vehicles">
              {t('dashboard.secondaryAction')}
            </Link>
          </div>
        }
      />

      <div className="kpi-grid">
        <KpiCard tone="brand" icon="fleet" label={t('dashboard.kpis.fleet.label')} value={totals.vehicles} helper={t('dashboard.kpis.fleet.helper', { count: totals.operational })} />
        <KpiCard tone="ok" icon="available" label={t('dashboard.kpis.available.label')} value={totals.available} helper={t('dashboard.kpis.available.helper')} />
        <KpiCard tone="warn" icon="loaned" label={t('dashboard.kpis.loaned.label')} value={totals.loaned} helper={t('dashboard.kpis.loaned.helper', { pct: totals.utilization_pct })} />
        <KpiCard tone="info" icon="maintenance" label={t('dashboard.kpis.maintenance.label')} value={totals.maintenance} helper={t('dashboard.kpis.maintenance.helper')} />
        <KpiCard tone="danger" icon="damaged" label={t('dashboard.kpis.damaged.label')} value={totals.damaged} helper={t('dashboard.kpis.damaged.helper')} />
        <KpiCard tone="danger" icon="overdue" label={t('dashboard.kpis.overdue.label')} value={totals.overdue_loans} helper={t('dashboard.kpis.overdue.helper', { count: totals.active_loans })} />
      </div>

      <div className="dashboard-analytics">
        <section className="content-card dashboard-analytics__primary">
          <div className="card-title-row">
            <div>
              <h3>{t('dashboard.activity.title')}</h3>
              <p className="hint-text">{t('dashboard.activity.subtitle')}</p>
            </div>
            <TrendBadge direction={activity.direction} label={trendLabel} />
          </div>
          <ActivityChart
            points={activityPoints}
            ariaLabel={t('dashboard.activity.summary') + ` ${t('dashboard.activity.total', { count: activity.total })}`}
          />
          <p className="hint-text">{t('dashboard.activity.total', { count: activity.total })}</p>
        </section>

        <section className="content-card dashboard-analytics__donut">
          <div>
            <h3>{t('dashboard.statusChart.title')}</h3>
            <p className="hint-text">{t('dashboard.statusChart.subtitle')}</p>
          </div>
          {statusSegments.length ? (
            <div className="donut-layout">
              <DonutChart
                segments={statusSegments}
                centerValue={totals.vehicles}
                centerLabel={t('dashboard.statusChart.centerLabel')}
                ariaLabel={`${t('dashboard.statusChart.summary')} ${statusSegments
                  .map((segment) => `${segment.label}: ${segment.value}`)
                  .join(', ')}`}
              />
              <ul className="donut-legend">
                {statusSegments.map((segment) => (
                  <li key={segment.key}>
                    <span className="donut-legend__swatch" style={{ background: segment.color }} aria-hidden="true" />
                    <span className="donut-legend__label">{segment.label}</span>
                    <span className="donut-legend__value">{segment.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="hint-text">{t('dashboard.statusChart.empty')}</p>
          )}
        </section>
      </div>

      <section className="content-card">
        <h3>{t('dashboard.attention.title')}</h3>
        <div className="card-grid card-grid--two">
          <div className="attention-panel">
            <h4 className="attention-panel__title">{t('dashboard.overdue.title')}</h4>
            {data.attention.overdue_loans.length ? (
              <ul className="list-stack">
                {data.attention.overdue_loans.map((loan) => (
                  <li key={loan.id}>
                    <div>
                      <strong>{loan.vehicle_label}</strong>
                      <small>{loan.borrower || t('common.unknown')}</small>
                    </div>
                    <span className="status-badge status-badge--damaged">
                      {t('dashboard.overdue.due', { date: shortDateFormatter.format(new Date(loan.expected_return_at)) })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint-text">{t('dashboard.overdue.empty')}</p>
            )}
          </div>

          <div className="attention-panel">
            <h4 className="attention-panel__title">{t('dashboard.damaged.title')}</h4>
            {data.attention.damaged_vehicles.length ? (
              <ul className="list-stack">
                {data.attention.damaged_vehicles.map((vehicle) => (
                  <li key={vehicle.id}>
                    <div>
                      <strong>{vehicle.label}</strong>
                    </div>
                    <Link className="button-link secondary-button" to={`/app/vehicles/${vehicle.id}`}>
                      {t('dashboard.recent.columns.vehicle')}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint-text">{t('dashboard.damaged.empty')}</p>
            )}
          </div>
        </div>
      </section>

      <section className="content-card">
        <div className="card-title-row">
          <div>
            <h3>{t('dashboard.byCategory.title')}</h3>
            <p className="hint-text">{t('dashboard.byCategory.description')}</p>
          </div>
        </div>
        {data.available_by_category.length ? (
          <div className="category-grid">
            {data.available_by_category.map((entry) => {
              const ratio = entry.total ? Math.round((entry.available / entry.total) * 100) : 0;
              return (
                <Link
                  key={entry.id}
                  className={`category-card${entry.available > 0 ? ' category-card--available' : ' category-card--empty'}`}
                  to={`/app/vehicles?status=available&category=${entry.id}`}
                >
                  <span className="category-card__name">{entry.name}</span>
                  <strong className="category-card__count">{entry.available}</strong>
                  <span className="category-card__meta">{t('dashboard.byCategory.ofTotal', { total: entry.total })}</span>
                  <span className="progress-track" aria-hidden="true">
                    <span className="progress-fill" style={{ width: `${ratio}%` }} />
                  </span>
                  <span className="category-card__cta">{t('dashboard.byCategory.viewAvailable')}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="hint-text">{t('dashboard.byCategory.empty')}</p>
        )}
      </section>

      <section className="content-card">
        <h3>{t('dashboard.recent.title')}</h3>
        {data.recent_loans.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('dashboard.recent.columns.vehicle')}</th>
                  <th>{t('dashboard.recent.columns.borrower')}</th>
                  <th>{t('dashboard.recent.columns.status')}</th>
                  <th>{t('dashboard.recent.columns.date')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_loans.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.vehicle_label}</td>
                    <td>{loan.borrower || t('common.unknown')}</td>
                    <td>
                      <StatusBadge status={loan.status} />
                    </td>
                    <td>{loan.created_at ? shortDateFormatter.format(new Date(loan.created_at)) : t('common.notAvailable')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint-text">{t('dashboard.recent.empty')}</p>
        )}
      </section>

      <section className="content-card">
        <h3>{t('dashboard.quickActions.title')}</h3>
        <div className="quick-actions">
          <Link className="quick-action" to="/app/workflows/loan-checkout">
            <Icon name="loaned" />
            <span>{t('dashboard.quickActions.loan')}</span>
          </Link>
          <Link className="quick-action" to="/app/workflows/loan-return">
            <Icon name="available" />
            <span>{t('dashboard.quickActions.return')}</span>
          </Link>
          {canManageVehicles ? (
            <Link className="quick-action" to="/app/workflows/add-vehicle">
              <Icon name="fleet" />
              <span>{t('dashboard.quickActions.addVehicle')}</span>
            </Link>
          ) : null}
          <Link className="quick-action" to="/app/qr">
            <Icon name="qr" />
            <span>{t('dashboard.quickActions.qr')}</span>
          </Link>
          <Link className="quick-action" to="/app/vehicles">
            <Icon name="pool" />
            <span>{t('dashboard.quickActions.pool')}</span>
          </Link>
          <Link className="quick-action" to="/app/history">
            <Icon name="history" />
            <span>{t('dashboard.quickActions.history')}</span>
          </Link>
        </div>
      </section>
    </section>
  );
}
