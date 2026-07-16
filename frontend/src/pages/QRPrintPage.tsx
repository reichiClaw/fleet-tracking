import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { displayVehicleName, listVehicles, type Vehicle } from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { QRCodeCard } from '../components/QRCodeCard';
import { StatusBadge } from '../components/StatusBadge';
import { publicVehiclePath } from './QRAccessPage';

export function QRPrintPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const requestedVehicle = params.get('vehicle');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    listVehicles()
      .then((items) => {
        if (mounted) setVehicles(requestedVehicle ? items.filter((item) => item.id === requestedVehicle) : items);
      })
      .catch((loadError) => {
        if (mounted) setError(getApiErrorMessage(loadError, t, t('qr.loadError')));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [requestedVehicle, t]);

  return (
    <section className="page-stack qr-print-page">
      <div className="page-header print-hidden">
        <h2>{t('qr.printTitle')}</h2>
        <div className="action-row">
          <button type="button" onClick={() => window.print()}>{t('qr.print')}</button>
          <Link className="button-link secondary-button" to="/app/qr">{t('common.back')}</Link>
        </div>
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
      {!loading && !error && !vehicles.length ? (
        <EmptyState title={t('vehicles.empty.title')} description={t('vehicles.empty.body')} />
      ) : null}
    </section>
  );
}
