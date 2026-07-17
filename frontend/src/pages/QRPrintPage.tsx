import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  displayVehicleName,
  getVehicle,
  listVehiclePage,
  type PageResult,
  type Vehicle,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { PaginationControls } from '../components/PaginationControls';
import { PageHeader } from '../components/PageHeader';
import { QRCodeCard } from '../components/QRCodeCard';
import { StatusBadge } from '../components/StatusBadge';
import { publicVehiclePath } from './QRAccessPage';

export function QRPrintPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const requestedVehicle = params.get('vehicle');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclePage, setVehiclePage] = useState<PageResult<Vehicle> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const request = requestedVehicle
      ? getVehicle(requestedVehicle, controller.signal).then((vehicle) => ({
        count: 1,
        next: null,
        previous: null,
        results: [vehicle],
        page: 1,
        pageSize: 1,
      }))
      : listVehiclePage({ active: true }, page, controller.signal);
    request
      .then((nextPage) => {
        if (mounted) {
          setVehicles(nextPage.results);
          setVehiclePage(nextPage);
        }
      })
      .catch((loadError) => {
        if (mounted) setError(getApiErrorMessage(loadError, t, t('qr.loadError')));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [page, requestedVehicle, t]);

  return (
    <section className="page-stack qr-print-page">
      <div className="print-hidden">
        <PageHeader
          title={t('qr.printTitle')}
          actions={(
            <div className="action-row">
              <button type="button" onClick={() => window.print()}>{t('qr.print')}</button>
              <Link className="button-link secondary-button" to="/app/qr">{t('common.back')}</Link>
            </div>
          )}
        />
      </div>
      {loading ? <LoadingState /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && vehicles.length ? (
        <div className="qr-label-grid print-scope">
          {vehicles.map((vehicle) => (
            <article className="qr-label" key={vehicle.id}>
              <div className="card-title-row">
                <h3>{displayVehicleName(vehicle)}</h3>
                <StatusBadge status={vehicle.status} />
              </div>
              <QRCodeCard
                title={t('qr.shortcuts.cardTitle')}
                description={t('qr.shortcuts.description')}
                value={`${window.location.origin}${publicVehiclePath(vehicle.qr_code)}`}
              />
            </article>
          ))}
        </div>
      ) : null}
      {!requestedVehicle && !loading && !error && vehiclePage && vehiclePage.count > 0 ? (
        <div className="print-hidden">
          <PaginationControls page={vehiclePage} onPageChange={setPage} />
        </div>
      ) : null}
      {!loading && !error && !vehicles.length ? (
        <EmptyState title={t('vehicles.empty.title')} description={t('vehicles.empty.body')} />
      ) : null}
    </section>
  );
}
