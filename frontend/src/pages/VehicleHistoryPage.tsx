import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { displayVehicleName, listVehicleCategories, listVehicles, type Vehicle, type VehicleCategory } from '../api/fleet';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
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
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadCategories() {
      try {
        const nextCategories = await listVehicleCategories();
        if (isMounted) {
          setCategories(nextCategories.filter((item) => item.is_active));
        }
      } catch {
        if (isMounted) {
          setError(t('vehicles.loadError'));
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

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
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
    </section>
  );
}
