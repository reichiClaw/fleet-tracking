import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  displayVehicleName,
  listVehicleCategories,
  listVehicles,
  type Vehicle,
  type VehicleCategory,
  type PageResult,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { PaginationControls } from '../components/PaginationControls';

// Vehicles that have left the active fleet (handed back to the manufacturer or
// otherwise archived) live here instead of the vehicle pool.
const ARCHIVED_STATUSES = new Set(['manufacturer_checkout', 'archived']);

export function ArchivePage() {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [category, setCategory] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextCategories] = await Promise.all([listVehicles(), listVehicleCategories()]);
        if (isMounted) {
          setVehicles(nextVehicles);
          setCategories(nextCategories);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getApiErrorMessage(loadError, t, t('vehicles.loadError')));
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
  }, [reloadToken, t]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [categories]);

  const archivedVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vehicles
      .filter((vehicle) => ARCHIVED_STATUSES.has(vehicle.status))
      .filter((vehicle) => {
        if (category) {
          const categoryId = typeof vehicle.category === 'string' ? vehicle.category : vehicle.category?.id;
          if (categoryId !== category) {
            return false;
          }
        }
        if (!query) {
          return true;
        }
        return [
          vehicle.internal_number,
          vehicle.manufacturer,
          vehicle.model,
          vehicle.license_plate,
          vehicle.serial_number,
          vehicle.current_location,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [vehicles, category, search]);
  const pageSize = 50;
  const visibleVehicles = archivedVehicles.slice((page - 1) * pageSize, page * pageSize);
  const archivePage: PageResult<Vehicle> = {
    count: archivedVehicles.length,
    page,
    pageSize,
    results: visibleVehicles,
    previous: page > 1 ? 'previous' : null,
    next: page * pageSize < archivedVehicles.length ? 'next' : null,
  };

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow={t('archive.eyebrow')} title={t('archive.title')} description={t('archive.description')} />

      <form className="filter-panel" onSubmit={handleSearch}>
        <label>
          <span>{t('vehicles.filters.search')}</span>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
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
      {!isLoading && error ? <ErrorState message={error} onRetry={() => setReloadToken((token) => token + 1)} /> : null}

      {!isLoading && !error ? <div className="vehicle-grid">
        {visibleVehicles.map((vehicle) => {
          const categoryName =
            typeof vehicle.category === 'string'
              ? categoryNameById.get(vehicle.category)
              : vehicle.category?.name;
          return (
            <article className="content-card vehicle-card" key={vehicle.id}>
              <div className="card-title-row">
                <div>
                  <h3>{displayVehicleName(vehicle)}</h3>
                  <p className="hint-text">
                    {vehicle.license_plate || vehicle.serial_number || t('vehicles.noIdentifier')}
                  </p>
                </div>
                <StatusBadge status={vehicle.status} />
              </div>
              <dl className="detail-list">
                <div>
                  <dt>{t('vehicles.filters.category')}</dt>
                  <dd>{categoryName || t('common.notAvailable')}</dd>
                </div>
                <div>
                  <dt>{t('vehicles.fields.location')}</dt>
                  <dd>{vehicle.current_location || t('common.notAvailable')}</dd>
                </div>
              </dl>
              <div className="action-row">
                <Link className="button-link secondary-button" to={`/app/vehicles/${vehicle.id}`}>
                  {t('vehicles.actions.details')}
                </Link>
              </div>
            </article>
          );
        })}
      </div> : null}

      {!isLoading && !error && !archivedVehicles.length ? (
        <EmptyState title={t('archive.empty.title')} description={t('archive.empty.body')} />
      ) : null}
      {!isLoading && !error && archivedVehicles.length ? (
        <PaginationControls page={archivePage} onPageChange={setPage} />
      ) : null}
    </section>
  );
}
