import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  displayDriverName,
  displayVehicleName,
  listDrivers,
  listLoans,
  listVehicleCategories,
  listVehiclePage,
  listVehicles,
  type PageResult,
  type Driver,
  type Loan,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';
import { PaginationControls } from '../components/PaginationControls';
import { useAuth } from '../auth/AuthContext';
import { canLoan, canMutate } from '../utils/capabilities';
import { formatDateTime, formatNumber } from '../utils/format';

const statuses = [
  '',
  'announced',
  'checked_in',
  'available',
  'reserved',
  'loaned',
  'maintenance',
  'damaged',
] as const;

// Vehicles handed back to the manufacturer (or archived) leave the active fleet
// and are only shown on the Archive page.
const ARCHIVED_STATUSES = new Set(['manufacturer_checkout', 'archived']);

export function VehiclePoolPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status') ?? '';
  const initialStatus = ARCHIVED_STATUSES.has(requestedStatus) ? '' : requestedStatus;
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclePage, setVehiclePage] = useState<PageResult<Vehicle> | null>(null);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [category, setCategory] = useState(searchParams.get('category') ?? '');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadSupportData() {
      try {
        const [nextCategories, nextLoans, nextDrivers] = await Promise.all([
          listVehicleCategories(),
          listLoans(),
          listDrivers(),
        ]);
        if (isMounted) {
          setCategories(nextCategories);
          setLoans(nextLoans);
          setDrivers(nextDrivers);
        }
      } catch (error) {
        if (isMounted) {
          setError(getApiErrorMessage(error, t, t('vehicles.loadError')));
        }
      }
    }

    loadSupportData();
    return () => {
      isMounted = false;
    };
  }, [t]);

  useEffect(() => {
    let isMounted = true;
    async function loadVehicles() {
      setIsLoading(true);
      setError(null);
      try {
        let nextPage: PageResult<Vehicle>;
        if (status) {
          nextPage = await listVehiclePage({ status, category, search }, page);
        } else {
          // The backend currently has no "active fleet only" filter, so its
          // unfiltered count includes archived/manufacturer-returned records.
          // Follow all pages and paginate the filtered active set locally to
          // keep counts and page boundaries correct.
          const allVehicles = await listVehicles({ category });
          const query = search.trim().toLowerCase();
          const activeVehicles = allVehicles
            .filter((item) => !ARCHIVED_STATUSES.has(item.status))
            .filter((item) => !query || [
              item.internal_number,
              item.manufacturer,
              item.model,
              item.license_plate,
              item.serial_number,
              item.current_location,
            ].filter(Boolean).join(' ').toLowerCase().includes(query));
          const pageSize = 50;
          const results = activeVehicles.slice((page - 1) * pageSize, page * pageSize);
          nextPage = {
            count: activeVehicles.length,
            next: page * pageSize < activeVehicles.length ? 'next' : null,
            previous: page > 1 ? 'previous' : null,
            results,
            page,
            pageSize,
          };
        }
        if (isMounted) {
          setVehicles(nextPage.results);
          setVehiclePage(nextPage);
        }
      } catch (error) {
        if (isMounted) {
          setError(getApiErrorMessage(error, t, t('vehicles.loadError')));
          setVehicles([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadVehicles();
    return () => {
      isMounted = false;
    };
  }, [category, page, reloadToken, search, status, t]);

  const activeLoansByVehicle = useMemo(() => {
    const driverNames = new Map(drivers.map((driver) => [driver.id, displayDriverName(driver)]));
    return new Map(
      loans
        .filter((loan) => loan.status === 'active')
        .map((loan) => [
          loan.vehicle,
          {
            ...loan,
            borrower_name: loan.driver ? driverNames.get(loan.driver) || loan.borrower_name : loan.borrower_name,
          },
        ]),
    );
  }, [drivers, loans]);

  const visibleVehicles = useMemo(() => vehicles.filter((vehicle) => !ARCHIVED_STATUSES.has(vehicle.status)), [vehicles]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  return (
    <section className="page-stack">
      <div className="page-header page-header--with-actions">
        <div>
          <p className="eyebrow">{t('vehicles.eyebrow')}</p>
          <h2>{t('vehicles.title')}</h2>
          <p>{t('vehicles.description')}</p>
        </div>
        {canMutate(user?.role) ? (
          <Link className="button-link" to="/app/workflows/loans">
            {t('navigation.loanWorkflows')}
          </Link>
        ) : null}
      </div>

      <form className="filter-panel" onSubmit={handleSearch}>
        <label>
          <span>{t('vehicles.filters.search')}</span>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </label>
        <label>
          <span>{t('vehicles.filters.status')}</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            {statuses.map((statusOption) => (
              <option key={statusOption || 'all'} value={statusOption}>
                {statusOption ? t(`status.${statusOption}`) : t('vehicles.filters.allStatuses')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('vehicles.filters.category')}</span>
          <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
            <option value="">{t('vehicles.filters.allCategories')}</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">{t('vehicles.filters.apply')}</button>
      </form>

      {isLoading ? <LoadingState variant="skeleton" rows={6} /> : null}
      {!isLoading && error ? <ErrorState message={error} onRetry={() => setReloadToken((token) => token + 1)} /> : null}

      {!isLoading && !error ? <div className="vehicle-grid">
        {visibleVehicles.map((vehicle) => {
          const activeLoan = activeLoansByVehicle.get(vehicle.id);
          return (
            <article className="content-card vehicle-card" key={vehicle.id}>
              <div className="card-title-row">
                <div>
                  <h3>{displayVehicleName(vehicle)}</h3>
                  <p className="hint-text">{vehicle.license_plate || vehicle.serial_number || t('vehicles.noIdentifier')}</p>
                </div>
                <StatusBadge status={vehicle.status} />
              </div>
              <dl className="detail-list">
                <div>
                  <dt>{t('vehicles.fields.location')}</dt>
                  <dd>{vehicle.current_location || t('common.notAvailable')}</dd>
                </div>
                <div>
                  <dt>{t('vehicles.fields.odometer')}</dt>
                  <dd>{formatNumber(vehicle.current_odometer_km, i18n.language, t('common.notAvailable'))}</dd>
                </div>
                <div>
                  <dt>{t('vehicles.fields.hours')}</dt>
                  <dd>{formatNumber(vehicle.current_operating_hours, i18n.language, t('common.notAvailable'), { maximumFractionDigits: 1 })}</dd>
                </div>
              </dl>
              {activeLoan ? (
                <div className="loan-strip">
                  <strong>{t('vehicles.borrower')}</strong>
                  <span>{activeLoan.borrower_name || t('common.unknown')}</span>
                  <small>
                    {t('vehicles.expectedReturn', {
                      date: formatDateTime(activeLoan.expected_return_at, i18n.language, t('common.notAvailable')),
                    })}
                  </small>
                </div>
              ) : null}
              <div className="action-row">
                <Link className="button-link secondary-button" to={`/app/vehicles/${vehicle.id}`}>
                  {t('vehicles.actions.details')}
                </Link>
                {canLoan(user?.role, vehicle.status) ? (
                  <Link className="button-link" to={`/app/workflows/loan-checkout?vehicle=${vehicle.id}`}>
                    {t('workflows.loanCheckout.shortTitle')}
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div> : null}

      {!isLoading && !error && !visibleVehicles.length ? (
        <EmptyState title={t('vehicles.empty.title')} description={t('vehicles.empty.body')} />
      ) : null}
      {!isLoading && !error && vehiclePage && vehiclePage.count > 0 ? (
        <PaginationControls page={vehiclePage} onPageChange={setPage} />
      ) : null}
    </section>
  );
}
