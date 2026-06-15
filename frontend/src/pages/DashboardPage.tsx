import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  listLoans,
  listVehicleCategories,
  listVehicles,
  type Loan,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';

const summaryStatuses = ['available', 'loaned', 'maintenance', 'damaged'] as const;
const statusTone: Record<(typeof summaryStatuses)[number], string> = {
  available: 'ok',
  loaned: 'warn',
  maintenance: 'info',
  damaged: 'danger',
};

function vehicleCategoryId(vehicle: Vehicle) {
  if (!vehicle.category) {
    return null;
  }
  return typeof vehicle.category === 'string' ? vehicle.category : vehicle.category.id;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadDashboard() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextLoans, nextCategories] = await Promise.all([
          listVehicles(),
          listLoans(),
          listVehicleCategories(),
        ]);
        if (isMounted) {
          setVehicles(nextVehicles);
          setLoans(nextLoans);
          setCategories(nextCategories);
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

  const operationalVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status !== 'manufacturer_checkout'),
    [vehicles],
  );

  const counts = useMemo(
    () =>
      summaryStatuses.reduce<Record<string, number>>((accumulator, status) => {
        accumulator[status] = operationalVehicles.filter((vehicle) => vehicle.status === status).length;
        return accumulator;
      }, {}),
    [operationalVehicles],
  );

  const overdueLoans = useMemo(() => {
    const now = Date.now();
    return loans.filter((loan) => loan.status === 'active' && new Date(loan.expected_return_at).getTime() < now);
  }, [loans]);

  const categoryAvailability = useMemo(() => {
    return categories
      .filter((category) => category.is_active)
      .map((category) => {
        const inCategory = operationalVehicles.filter((vehicle) => vehicleCategoryId(vehicle) === category.id);
        return {
          id: category.id,
          name: category.name,
          total: inCategory.length,
          available: inCategory.filter((vehicle) => vehicle.status === 'available').length,
        };
      })
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.available - a.available);
  }, [categories, operationalVehicles]);

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
          <article className={`summary-card summary-card--${statusTone[status]}`} key={status}>
            <span>{t(`dashboard.cards.${status}`)}</span>
            <strong>{counts[status] ?? 0}</strong>
            <StatusBadge status={status} />
          </article>
        ))}
      </div>

      <section className="content-card">
        <div className="card-title-row">
          <div>
            <h3>{t('dashboard.byCategory.title')}</h3>
            <p className="hint-text">{t('dashboard.byCategory.description')}</p>
          </div>
        </div>
        {categoryAvailability.length ? (
          <div className="category-grid">
            {categoryAvailability.map((entry) => (
              <Link
                key={entry.id}
                className={`category-card${entry.available > 0 ? ' category-card--available' : ' category-card--empty'}`}
                to={`/app/vehicles?status=available&category=${entry.id}`}
              >
                <span className="category-card__name">{entry.name}</span>
                <strong className="category-card__count">{entry.available}</strong>
                <span className="category-card__meta">{t('dashboard.byCategory.ofTotal', { total: entry.total })}</span>
                <span className="category-card__cta">{t('dashboard.byCategory.viewAvailable')}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="hint-text">{t('dashboard.byCategory.empty')}</p>
        )}
      </section>

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
