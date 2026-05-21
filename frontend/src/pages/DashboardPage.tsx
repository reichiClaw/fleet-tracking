import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getDashboardOverdueLoans,
  getDashboardRecentActivity,
  getDashboardStatusSummary,
  type AuditLog,
  type DashboardSummary,
  type Loan,
} from '../api/fleet';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';

const summaryStatuses = ['available', 'loaned', 'maintenance', 'damaged'] as const;

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [counts, setCounts] = useState<DashboardSummary>({});
  const [overdueLoans, setOverdueLoans] = useState<Loan[]>([]);
  const [activity, setActivity] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadDashboard() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextCounts, nextLoans, nextActivity] = await Promise.all([
          getDashboardStatusSummary(),
          getDashboardOverdueLoans(),
          getDashboardRecentActivity(),
        ]);
        if (isMounted) {
          setCounts(nextCounts);
          setOverdueLoans(nextLoans);
          setActivity(nextActivity);
        }
      } catch {
        if (isMounted) {
          setError(t('dashboard.apiFallback'));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDashboard();
    return () => {
      isMounted = false;
    };
  }, [t]);

  const recentActivity = useMemo(() => activity.slice(0, 5), [activity]);

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('dashboard.eyebrow')}</p>
        <h2>{t('dashboard.title')}</h2>
        <p>{t('dashboard.description')}</p>
      </div>

      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}

      <div className="summary-grid">
        {summaryStatuses.map((status) => (
          <article className="summary-card" key={status}>
            <span>{t(`dashboard.cards.${status}`)}</span>
            <strong>{counts[status] ?? 0}</strong>
          </article>
        ))}
      </div>

      <section className="card-grid card-grid--two">
        <article className="content-card">
          <h3>{t('dashboard.overdue.title')}</h3>
          {overdueLoans.length ? (
            <ul className="list-stack">
              {overdueLoans.slice(0, 5).map((loan) => (
                <li key={loan.id}>
                  <div>
                    <strong>{loan.borrower_name || t('common.unknown')}</strong>
                    <small>{new Intl.DateTimeFormat(i18n.language).format(new Date(loan.expected_return_at))}</small>
                  </div>
                  <StatusBadge status={loan.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint-text">{t('dashboard.overdue.empty')}</p>
          )}
        </article>

        <article className="content-card">
          <h3>{t('dashboard.activity.title')}</h3>
          {recentActivity.length ? (
            <ul className="list-stack">
              {recentActivity.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{t(`audit.actions.${entry.action}`, { defaultValue: entry.action })}</strong>
                    <small>
                      {entry.created_at
                        ? new Intl.DateTimeFormat(i18n.language).format(new Date(entry.created_at))
                        : t('common.notAvailable')}
                    </small>
                  </div>
                  <span>{entry.entity_type}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint-text">{t('dashboard.activity.empty')}</p>
          )}
        </article>
      </section>
    </section>
  );
}
