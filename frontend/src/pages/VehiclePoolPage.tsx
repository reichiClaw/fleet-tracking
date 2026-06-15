import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  displayDriverName,
  displayVehicleName,
  listDrivers,
  listLoans,
  listVehicleCategories,
  listVehicles,
  type Driver,
  type Loan,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';

const statuses = [
  '',
  'announced',
  'checked_in',
  'available',
  'reserved',
  'loaned',
  'maintenance',
  'damaged',
  'archived',
] as const;

export function VehiclePoolPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') === 'manufacturer_checkout' ? '' : searchParams.get('status') ?? '';
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
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
      } catch {
        if (isMounted) {
          setError(t('vehicles.loadError'));
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
        const nextVehicles = await listVehicles({ status, category, search });
        if (isMounted) {
          setVehicles(nextVehicles);
        }
      } catch {
        if (isMounted) {
          setError(t('vehicles.loadError'));
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
  }, [category, search, status, t]);

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

  const visibleVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.status !== 'manufacturer_checkout'), [vehicles]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  return (
    <section className="page-stack">
      <div className="page-header page-header--with-actions">
        <div>
          <p className="eyebrow">{t('vehicles.eyebrow')}</p>
          <h2>{t('vehicles.title')}</h2>
          <p>{t('vehicles.description')}</p>
        </div>
        <Link className="button-link" to="/app/workflows/loans">
          {t('navigation.loanWorkflows')}
        </Link>
      </div>

      <form className="filter-panel" onSubmit={handleSearch}>
        <label>
          <span>{t('vehicles.filters.search')}</span>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        </label>
        <label>
          <span>{t('vehicles.filters.status')}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {statuses.map((statusOption) => (
              <option key={statusOption || 'all'} value={statusOption}>
                {statusOption ? t(`status.${statusOption}`) : t('vehicles.filters.allStatuses')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('vehicles.filters.category')}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
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
      {error ? <ErrorState message={error} /> : null}

      <div className="vehicle-grid">
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
                  <dd>{vehicle.current_odometer_km ?? t('common.notAvailable')}</dd>
                </div>
                <div>
                  <dt>{t('vehicles.fields.hours')}</dt>
                  <dd>{vehicle.current_operating_hours ?? t('common.notAvailable')}</dd>
                </div>
              </dl>
              {activeLoan ? (
                <div className="loan-strip">
                  <strong>{t('vehicles.borrower')}</strong>
                  <span>{activeLoan.borrower_name || t('common.unknown')}</span>
                  <small>
                    {t('vehicles.expectedReturn', {
                      date: new Intl.DateTimeFormat(i18n.language).format(new Date(activeLoan.expected_return_at)),
                    })}
                  </small>
                </div>
              ) : null}
              <div className="action-row">
                <Link className="button-link secondary-button" to={`/app/vehicles/${vehicle.id}`}>
                  {t('vehicles.actions.details')}
                </Link>
                {vehicle.status === 'available' ? (
                  <Link className="button-link" to={`/app/workflows/loan-checkout?vehicle=${vehicle.id}`}>
                    {t('workflows.loanCheckout.shortTitle')}
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {!isLoading && !visibleVehicles.length ? (
        <EmptyState title={t('vehicles.empty.title')} description={t('vehicles.empty.body')} />
      ) : null}
    </section>
  );
}
