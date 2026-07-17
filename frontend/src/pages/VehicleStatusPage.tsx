import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router-dom';

import {
  getPublicVehicleStatus,
  resolveVehicleQrCode,
  type Loan,
  type PublicVehicleStatus,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/ErrorState';
import { LanguageSelector } from '../components/LanguageSelector';
import { LoadingState } from '../components/LoadingState';
import { StatusBadge } from '../components/StatusBadge';

type StatusAction = { key: string; to: string; primary: boolean };

/** Semantic button color per action: add = green, remove = red, otherwise neutral. */
function statusActionClass(key: string, primary: boolean): string {
  if (key === 'checkIn') {
    return ' success-button';
  }
  if (key === 'manufacturerCheckout') {
    return ' danger-button';
  }
  return primary ? '' : ' secondary-button';
}

/**
 * Build the contextual actions for a vehicle, based on its current status and
 * any active loan. Only meaningful for operators (admin/operations).
 */
export function vehicleStatusActions(status: string, vehicleId: string, activeLoan: Loan | null): StatusAction[] {
  const actions: StatusAction[] = [];
  if (activeLoan) {
    actions.push({ key: 'loanReturn', to: `/app/workflows/loan-return?loan=${activeLoan.id}`, primary: true });
  } else {
    if (status === 'announced') {
      actions.push({ key: 'checkIn', to: `/app/workflows/check-in?vehicle=${vehicleId}`, primary: true });
    }
    if (status === 'available') {
      actions.push({ key: 'loanCheckout', to: `/app/workflows/loan-checkout?vehicle=${vehicleId}`, primary: true });
    }
    if (status === 'available' || status === 'damaged') {
      actions.push({
        key: 'manufacturerCheckout',
        to: `/app/workflows/manufacturer-return?vehicle=${vehicleId}`,
        primary: status === 'damaged',
      });
    }
  }
  actions.push({ key: 'details', to: `/app/vehicles/${vehicleId}`, primary: false });
  return actions;
}

export function VehicleStatusPage() {
  const { qrCode } = useParams();
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<PublicVehicleStatus | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [activeLoan, setActiveLoan] = useState<Loan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const canAct = user?.role === 'admin' || user?.role === 'operations';

  useEffect(() => {
    if (authLoading) {
      return;
    }
    let isMounted = true;
    async function load() {
      if (!qrCode) {
        setError(t('qr.status.missing'));
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const status = await getPublicVehicleStatus(qrCode);
        if (!isMounted) {
          return;
        }
        setData(status);
        // Logged-in operators additionally get the vehicle id + active loan so
        // the page can offer the right action buttons.
        if (user) {
          try {
            const resolution = await resolveVehicleQrCode(qrCode);
            if (isMounted) {
              setVehicleId(resolution.vehicle.id);
              setActiveLoan(resolution.active_loan);
            }
          } catch {
            // Status still renders even if the authenticated lookup fails.
          }
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getApiErrorMessage(loadError, t, t('qr.status.loadError')));
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
  }, [authLoading, qrCode, t, user]);

  const actions = useMemo(
    () => (canAct && vehicleId ? vehicleStatusActions(data?.status ?? '', vehicleId, activeLoan) : []),
    [activeLoan, canAct, data?.status, vehicleId],
  );

  const displayName = data
    ? [data.internal_number, data.manufacturer, data.model].filter(Boolean).join(' · ')
    : '';
  const identifier = data?.license_plate || data?.serial_number || '';

  useEffect(() => {
    document.title = `${displayName || t('qr.status.eyebrow')} · ${t('app.name')}`;
    if (data) headingRef.current?.focus();
  }, [data, displayName, t]);

  return (
    <main className="login-page">
      <section className="login-card page-stack">
        <div className="login-card__header">
          <div>
            <p className="eyebrow">{t('qr.status.eyebrow')}</p>
            <h1>{t('app.name')}</h1>
          </div>
          <LanguageSelector />
        </div>

        {authLoading || isLoading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}

        {!isLoading && !error && data ? (
          <>
            <div className="card-title-row">
              <h2 ref={headingRef} tabIndex={-1}>{displayName}</h2>
              <StatusBadge status={data.status} />
            </div>

            <dl className="detail-list">
              {data.category ? (
                <div>
                  <dt>{t('qr.status.fields.category')}</dt>
                  <dd>{data.category}</dd>
                </div>
              ) : null}
              {identifier ? (
                <div>
                  <dt>{t('qr.status.fields.identifier')}</dt>
                  <dd>{identifier}</dd>
                </div>
              ) : null}
              {data.current_location ? (
                <div>
                  <dt>{t('qr.status.fields.location')}</dt>
                  <dd>{data.current_location}</dd>
                </div>
              ) : null}
            </dl>

            {user ? (
              actions.length ? (
                <div className="page-stack">
                  <h3>{t('qr.status.actionsTitle')}</h3>
                  <div className="action-row action-row--wrap">
                    {actions.map((action) => (
                      <Link key={action.key} className={`button-link${statusActionClass(action.key, action.primary)}`} to={action.to}>
                        {t(`qr.status.actions.${action.key}`)}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="hint-text">{t('qr.status.noActions')}</p>
              )
            ) : (
              <div className="page-stack">
                <p className="hint-text">{t('qr.status.signedOutHint')}</p>
                <Link
                  className="button-link"
                  to="/login"
                  state={{ from: `${location.pathname}${location.search}${location.hash}` }}
                >
                  {t('qr.status.signIn')}
                </Link>
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
