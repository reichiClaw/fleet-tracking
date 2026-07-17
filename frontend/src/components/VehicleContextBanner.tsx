import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getVehicleCategory,
  getVehicleMedia,
  getVehicleWorkflowContext,
  mediaDownloadUrl,
  type MediaFile,
  type Vehicle,
  type VehicleCategory,
  type VehicleWorkflowContext,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { formatDateTime, formatNumber } from '../utils/format';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { StatusBadge } from './StatusBadge';

export function vehicleSearchLabel(vehicle: Vehicle, statusLabel: string, categoryLabel?: string) {
  const primary = [vehicle.internal_number, vehicle.license_plate, vehicle.serial_number].filter(Boolean).join(' · ');
  const secondary = [categoryLabel, vehicle.current_location, statusLabel].filter(Boolean).join(' · ');
  return secondary ? `${primary} — ${secondary}` : primary;
}

export function useVehicleContext(vehicleId?: string | null) {
  const { t } = useTranslation();
  const [context, setContext] = useState<VehicleWorkflowContext | null>(null);
  const [category, setCategory] = useState<VehicleCategory | null>(null);
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(vehicleId));
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!vehicleId) {
      setContext(null);
      setCategory(null);
      setMedia([]);
      setThumbnailUrl(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    async function load() {
      try {
        const nextContext = await getVehicleWorkflowContext(vehicleId!, controller.signal);
        if (!active) return;
        setContext(nextContext);
        const categoryId = typeof nextContext.vehicle.category === 'string'
          ? nextContext.vehicle.category
          : nextContext.vehicle.category?.id;
        const [nextCategory, media] = await Promise.all([
          categoryId ? getVehicleCategory(categoryId, controller.signal) : Promise.resolve(null),
          getVehicleMedia(vehicleId!, controller.signal),
        ]);
        if (!active) return;
        setCategory(nextCategory);
        setMedia(media);
        const photo = media.find((item) => item.media_type === 'photo');
        setThumbnailUrl(photo ? mediaDownloadUrl(photo) : null);
      } catch (loadError) {
        if (active && !controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, t, t('vehicleContext.loadError')));
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadToken, t, vehicleId]);

  return {
    context,
    category,
    media,
    thumbnailUrl,
    isLoading,
    error,
    retry: useCallback(() => setReloadToken((value) => value + 1), []),
  };
}

export function VehicleContextGate({
  state,
  children,
}: {
  state: ReturnType<typeof useVehicleContext>;
  children: React.ReactNode;
}) {
  if (state.isLoading) return <LoadingState variant="skeleton" rows={2} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.retry} />;
  return children;
}

export function VehicleContextBanner({
  context,
  category,
  thumbnailUrl,
}: {
  context: VehicleWorkflowContext;
  category?: VehicleCategory | null;
  thumbnailUrl?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const vehicle = context.vehicle;
  const nextReservation = context.reservations[0];
  const meterMode = context.meter.mode;

  return (
    <section className="vehicle-context-banner" aria-label={t('vehicleContext.label')}>
      <div className="vehicle-context-banner__image" aria-hidden={!thumbnailUrl}>
        {thumbnailUrl ? <img src={thumbnailUrl} alt={t('vehicleContext.thumbnailAlt', { vehicle: vehicle.internal_number })} /> : <span aria-hidden="true">▣</span>}
      </div>
      <div className="vehicle-context-banner__identity">
        <div className="card-title-row">
          <div>
            <p className="eyebrow">{t('vehicleContext.label')}</p>
            <h3>{vehicle.internal_number}</h3>
          </div>
          <StatusBadge status={vehicle.status} />
        </div>
        <dl className="vehicle-context-banner__facts">
          <div><dt>{t('vehicles.fields.licensePlate')}</dt><dd>{vehicle.license_plate || t('common.notAvailable')}</dd></div>
          <div><dt>{t('vehicles.fields.serialNumber')}</dt><dd>{vehicle.serial_number || t('common.notAvailable')}</dd></div>
          <div><dt>{t('addVehicle.fields.category')}</dt><dd>{category?.name || t('common.notAvailable')}</dd></div>
          <div><dt>{t('vehicles.fields.location')}</dt><dd>{vehicle.current_location || t('common.notAvailable')}</dd></div>
          {meterMode === 'odometer' || meterMode === 'both' ? (
            <div><dt>{t('vehicleContext.meterBaseline')}</dt><dd>{formatNumber(context.meter.odometer_km, i18n.language, t('common.notAvailable'))} km</dd></div>
          ) : null}
          {meterMode === 'hours' || meterMode === 'both' ? (
            <div><dt>{t('vehicles.fields.hours')}</dt><dd>{formatNumber(context.meter.operating_hours, i18n.language, t('common.notAvailable'))}</dd></div>
          ) : null}
          <div><dt>{t('vehicleContext.openDamage')}</dt><dd>{context.open_damages.length}</dd></div>
          <div>
            <dt>{t('vehicleContext.nextReservation')}</dt>
            <dd>{nextReservation ? formatDateTime(nextReservation.start_at, i18n.language, t('common.notAvailable')) : t('common.notAvailable')}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function CurrentConditionPanel({
  context,
  media = [],
}: {
  context: VehicleWorkflowContext;
  media?: MediaFile[];
}) {
  const { t, i18n } = useTranslation();
  const latestDamages = useMemo(() => context.open_damages.slice(0, 3), [context.open_damages]);
  return (
    <section className={`current-condition${latestDamages.length || context.active_maintenance ? ' current-condition--attention' : ''}`}>
      <div>
        <h4>{t('vehicleContext.currentCondition')}</h4>
        <p>{context.active_maintenance ? t('vehicleContext.inMaintenance') : latestDamages.length ? t('vehicleContext.damageCount', { count: latestDamages.length }) : t('vehicleContext.noOpenIssues')}</p>
      </div>
      {latestDamages.length ? (
        <ul>
            {latestDamages.map((damage) => {
              const evidence = media.filter((item) => (
                item.media_type === 'photo'
                && (item.damage_report === damage.id
                  || (item.related_type === 'damage_report' && item.related_id === damage.id))
              ));
              return (
                <li key={damage.id}>
                  <strong>{damage.description}</strong>
                  <span>{formatDateTime(damage.discovered_at, i18n.language, t('common.notAvailable'))}</span>
                  {evidence.length ? (
                    <span className="evidence-links">
                      {evidence.map((item) => (
                        <a href={mediaDownloadUrl(item)} key={item.id}>
                          {t('media.types.photo')} · {item.original_filename}
                        </a>
                      ))}
                    </span>
                  ) : null}
                </li>
              );
            })}
        </ul>
      ) : null}
    </section>
  );
}
