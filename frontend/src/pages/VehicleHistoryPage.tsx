import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  displayVehicleName,
  listVehicleCategories,
  listVehiclePage,
  type PageResult,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
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
  'manufacturer_checkout',
  'archived',
] as const;

export function VehicleHistoryPage() {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclePage, setVehiclePage] = useState<PageResult<Vehicle> | null>(null);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    async function loadCategories() {
      try {
        const nextCategories = await listVehicleCategories();
        if (isMounted) {
          setCategories(nextCategories.filter((item) => item.is_active));
        }
      } catch (error) {
        if (isMounted) {
          setError(getApiErrorMessage(error, t, t('vehicles.loadError')));
        }
      }
    }
    loadCategories();
    return () => {
      isMounted = false;
    };
  }, [t]);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    async function loadVehicles() {
      setIsLoading(true);
      setError(null);
      try {
        const nextPage = await listVehiclePage({ status, category, search }, page, controller.signal);
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
      controller.abort();
    };
  }, [category, page, search, status, t]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('vehicles.historyIndex.eyebrow')}
        title={t('vehicles.historyIndex.title')}
        description={t('vehicles.historyIndex.description')}
      />

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

      {isLoading ? <LoadingState variant="skeleton" rows={4} /> : null}
      {error ? <ErrorState message={error} /> : null}

      <div className="card-grid card-grid--two">
        {vehicles.map((vehicle) => (
          <article className="content-card" key={vehicle.id}>
            <div className="card-title-row">
              <div>
                <h3>{displayVehicleName(vehicle)}</h3>
                <p className="hint-text">{vehicle.license_plate || vehicle.serial_number || t('vehicles.noIdentifier')}</p>
              </div>
              <StatusBadge status={vehicle.status} />
            </div>
            <div className="action-row">
              <Link className="button-link secondary-button" to={`/app/vehicles/${vehicle.id}`}>
                {t('vehicles.historyIndex.openHistory')}
              </Link>
            </div>
          </article>
        ))}
      </div>

      {!isLoading && !vehicles.length ? (
        <EmptyState title={t('vehicles.empty.title')} description={t('vehicles.historyIndex.empty')} />
      ) : null}
      {!isLoading && !error && vehiclePage && vehiclePage.count > 0 ? (
        <PaginationControls page={vehiclePage} onPageChange={setPage} />
      ) : null}
    </section>
  );
}
