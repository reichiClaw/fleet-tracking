import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { listLoans, listVehicles, type Loan, type Vehicle } from '../api/fleet';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';

const summaryStatuses = ['available', 'loaned', 'maintenance', 'damaged'] as const;

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadDashboard() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextLoans] = await Promise.all([listVehicles(), listLoans()]);
        if (isMounted) {
          setVehicles(nextVehicles);
          setLoans(nextLoans);
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

  const counts = useMemo(
    () =>
      summaryStatuses.reduce<Record<string, number>>((accumulator, status) => {
        accumulator[status] = vehicles.filter((vehicle) => vehicle.status === status).length;
        return accumulator;
      }, {}),
    [vehicles],
  );

  const overdueLoans = useMemo(() => {
    const now = Date.now();
    return loans.filter((loan) => loan.status === 'active' && new Date(loan.expected_return_at).getTime() < now);
  }, [loans]);

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
          <p className="hint-text">{t('dashboard.activity.placeholder')}</p>
        </article>
      </section>
    </section>
  );
}
