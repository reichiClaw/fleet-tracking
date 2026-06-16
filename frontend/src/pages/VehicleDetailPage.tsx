import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import {
  displayVehicleName,
  generateCheckInPdf,
  generateLoanCheckoutPdf,
  generateLoanReturnPdf,
  generateManufacturerCheckoutPdf,
  getVehicle,
  getVehicleHistory,
  mediaDownloadUrl,
  type Loan,
  type MediaFile,
  type Vehicle,
  type VehicleHistory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { QRCodeCard } from '../components/QRCodeCard';
import { StatusBadge } from '../components/StatusBadge';
import { publicVehiclePath } from './QRAccessPage';

export function VehicleDetailPage() {
  const { vehicleId } = useParams();
  const { t, i18n } = useTranslation();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [history, setHistory] = useState<VehicleHistory | null>(null);
  const [generatedMedia, setGeneratedMedia] = useState<MediaFile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadVehicle() {
      if (!vehicleId) {
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicle, nextHistory] = await Promise.all([getVehicle(vehicleId), getVehicleHistory(vehicleId)]);
        if (isMounted) {
          setVehicle(nextVehicle);
          setHistory(nextHistory);
        }
      } catch (error) {
        if (isMounted) {
          setError(getApiErrorMessage(error, t, t('vehicles.detail.loadError')));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    loadVehicle();
    return () => {
      isMounted = false;
    };
  }, [t, vehicleId]);

  const activeLoan = useMemo(() => history?.loans.find((loan) => loan.status === 'active'), [history]);
  const reports = useMemo(() => (history?.media ?? []).filter((media) => media.media_type === 'pdf'), [history]);

  function reportTypeLabel(relatedType?: string) {
    const key = `reports.types.${relatedType}`;
    return relatedType && i18n.exists(key) ? t(key) : t('media.types.pdf');
  }

  function appUrl(path: string) {
    if (typeof window === 'undefined') {
      return path;
    }
    return `${window.location.origin}${path}`;
  }

  async function handleGeneratePdf(kind: 'checkIn' | 'loanCheckout' | 'loanReturn' | 'manufacturer', id: string) {
    setPdfError(null);
    setGeneratedMedia(null);
    try {
      const language = i18n.language.startsWith('de') ? 'de' : 'en';
      const media = await (kind === 'checkIn'
        ? generateCheckInPdf(id, language)
        : kind === 'loanCheckout'
          ? generateLoanCheckoutPdf(id, language)
          : kind === 'loanReturn'
            ? generateLoanReturnPdf(id, language)
            : generateManufacturerCheckoutPdf(id, language));
      setGeneratedMedia(media);
    } catch (error) {
      setPdfError(getApiErrorMessage(error, t, t('pdf.error')));
    }
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (error || !vehicle) {
    return <ErrorState message={error ?? t('vehicles.detail.loadError')} />;
  }

  return (
    <section className="page-stack">
      <div className="page-header page-header--with-actions">
        <div>
          <p className="eyebrow">{t('vehicles.detail.eyebrow')}</p>
          <h2>{displayVehicleName(vehicle)}</h2>
          <p>{vehicle.notes || t('vehicles.detail.description')}</p>
        </div>
        <StatusBadge status={vehicle.status} />
      </div>

      <div className="action-row action-row--wrap">
        <Link className="button-link success-button" to={`/app/workflows/check-in?vehicle=${vehicle.id}`}>
          {t('workflows.checkIn.title')}
        </Link>
        <Link className="button-link" to={`/app/workflows/loan-checkout?vehicle=${vehicle.id}`}>
          {t('workflows.loanCheckout.title')}
        </Link>
        {activeLoan ? (
          <Link className="button-link" to={`/app/workflows/loan-return?loan=${activeLoan.id}`}>
            {t('workflows.loanReturn.title')}
          </Link>
        ) : null}
        <Link className="button-link danger-button" to={`/app/workflows/manufacturer-checkout?vehicle=${vehicle.id}`}>
          {t('workflows.manufacturerCheckout.title')}
        </Link>
      </div>

      {pdfError ? <ErrorState message={pdfError} /> : null}
      {generatedMedia ? (
        <article className="content-card success-card">
          <h3>{t('pdf.generated')}</h3>
          <a href={mediaDownloadUrl(generatedMedia)}>{generatedMedia.original_filename}</a>
        </article>
      ) : null}

      <section className="content-card">
        <div className="card-title-row">
          <div>
            <h3>{t('qr.shortcuts.title')}</h3>
            <p className="hint-text">{t('qr.shortcuts.description')}</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => window.print()}>
            {t('qr.print')}
          </button>
        </div>
        <div className="qr-card-grid">
          <QRCodeCard
            title={t('qr.shortcuts.cardTitle')}
            description={t('qr.shortcuts.description')}
            value={appUrl(publicVehiclePath(vehicle.qr_code))}
          />
        </div>
      </section>

      <section className="content-card">
        <h3>{t('vehicles.detail.dataTitle')}</h3>
        <dl className="detail-list detail-list--wide">
          <div>
            <dt>{t('vehicles.fields.licensePlate')}</dt>
            <dd>{vehicle.license_plate || t('common.notAvailable')}</dd>
          </div>
          <div>
            <dt>{t('vehicles.fields.serialNumber')}</dt>
            <dd>{vehicle.serial_number || t('common.notAvailable')}</dd>
          </div>
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
      </section>

      <section className="content-card">
        <h3>{t('vehicles.history.reports')}</h3>
        {reports.length ? (
          <ul className="list-stack list-stack--actions">
            {reports.map((media) => (
              <li key={media.id}>
                <div>
                  <strong>{reportTypeLabel(media.related_type)}</strong>
                  <small>
                    {media.language ? t(`language.options.${media.language}`) : ''}
                    {media.created_at ? ` · ${new Intl.DateTimeFormat(i18n.language).format(new Date(media.created_at))}` : ''}
                  </small>
                </div>
                <a className="button-link secondary-button" href={mediaDownloadUrl(media)}>
                  {t('media.download')}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint-text">{t('vehicles.history.emptyReports')}</p>
        )}
      </section>

      <HistorySection
        title={t('vehicles.history.loans')}
        empty={t('vehicles.history.emptyLoans')}
        items={history?.loans ?? []}
        renderItem={(loan) => (
          <li key={loan.id}>
            <div>
              <strong>{loan.borrower_name || t('common.unknown')}</strong>
              <small>{new Intl.DateTimeFormat(i18n.language).format(new Date(loan.expected_return_at))}</small>
            </div>
            <StatusBadge status={loan.status} />
            <button type="button" onClick={() => handleGeneratePdf('loanCheckout', loan.id)}>
              {t('pdf.generateCheckout')}
            </button>
            {loan.status === 'returned' ? (
              <button type="button" onClick={() => handleGeneratePdf('loanReturn', loan.id)}>
                {t('pdf.generateReturn')}
              </button>
            ) : null}
          </li>
        )}
      />

      <HistorySection
        title={t('vehicles.history.checkIns')}
        empty={t('vehicles.history.emptyCheckIns')}
        items={history?.check_ins ?? []}
        renderItem={(protocol) => (
          <li key={protocol.id}>
            <div>
              <strong>{t('workflows.checkIn.title')}</strong>
              <small>{new Intl.DateTimeFormat(i18n.language).format(new Date(protocol.performed_at))}</small>
            </div>
            <button type="button" onClick={() => handleGeneratePdf('checkIn', protocol.id)}>
              {t('pdf.generate')}
            </button>
          </li>
        )}
      />

      <HistorySection
        title={t('vehicles.history.manufacturer')}
        empty={t('vehicles.history.emptyManufacturer')}
        items={history?.manufacturer_checkouts ?? []}
        renderItem={(protocol) => (
          <li key={protocol.id}>
            <div>
              <strong>{t('workflows.manufacturerCheckout.title')}</strong>
              <small>{new Intl.DateTimeFormat(i18n.language).format(new Date(protocol.performed_at))}</small>
            </div>
            <button type="button" onClick={() => handleGeneratePdf('manufacturer', protocol.id)}>
              {t('pdf.generate')}
            </button>
          </li>
        )}
      />

      <HistorySection
        title={t('vehicles.history.media')}
        empty={t('vehicles.history.emptyMedia')}
        items={history?.media ?? []}
        renderItem={(media) => (
          <li key={media.id}>
            <div>
              <strong>{media.original_filename}</strong>
              <small>{t(`media.types.${media.media_type}`)}</small>
            </div>
            <a className="button-link secondary-button" href={mediaDownloadUrl(media)}>
              {t('media.download')}
            </a>
          </li>
        )}
      />
    </section>
  );
}

function HistorySection<T>({
  title,
  empty,
  items,
  renderItem,
}: {
  title: string;
  empty: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <section className="content-card">
      <h3>{title}</h3>
      {items.length ? <ul className="list-stack list-stack--actions">{items.map(renderItem)}</ul> : <p className="hint-text">{empty}</p>}
    </section>
  );
}
