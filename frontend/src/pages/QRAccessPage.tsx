import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  displayVehicleName,
  listLoans,
  listVehicles,
  resolveVehicleQrCode,
  type Loan,
  type Vehicle,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { QRCodeCard } from '../components/QRCodeCard';
import { StatusBadge } from '../components/StatusBadge';

type BarcodeDetectorResult = {
  rawValue: string;
};

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

type QRTarget = {
  key: string;
  title: string;
  description: string;
  path: string;
};

type QRAction = 'details' | 'check-in' | 'loan-checkout' | 'loan-return' | 'manufacturer-checkout';

export function QRAccessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopScannerRef = useRef<(() => void) | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextLoans] = await Promise.all([listVehicles(), listLoans()]);
        if (isMounted) {
          setVehicles(nextVehicles);
          setLoans(nextLoans);
        }
      } catch (error) {
        if (isMounted) {
          setError(getApiErrorMessage(error, t, t('qr.loadError')));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [t]);

  const activeLoansByVehicle = useMemo(
    () => new Map(loans.filter((loan) => loan.status === 'active').map((loan) => [loan.vehicle, loan])),
    [loans],
  );

  function appUrl(path: string) {
    if (typeof window === 'undefined') {
      return path;
    }
    return `${window.location.origin}${path}`;
  }

  function handleScannedValue(value: string) {
    const path = parseQrTarget(value);
    if (!path) {
      setError(t('qr.scan.invalid'));
      return;
    }
    stopScanner();
    navigate(path);
  }

  async function startScanner() {
    setError(null);
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError(t('qr.scan.unsupported'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!videoRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const detector = new Detector({ formats: ['qr_code'] });
      let stopped = false;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setIsScanning(true);

      async function scanFrame() {
        if (stopped || !videoRef.current) {
          return;
        }
        try {
          const results = await detector.detect(videoRef.current);
          const firstResult = results[0]?.rawValue;
          if (firstResult) {
            handleScannedValue(firstResult);
            return;
          }
        } catch {
          // Keep scanning; transient detector errors happen while camera frames settle.
        }
        window.requestAnimationFrame(scanFrame);
      }

      stopScannerRef.current = () => {
        stopped = true;
        stream.getTracks().forEach((track) => track.stop());
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        setIsScanning(false);
      };
      window.requestAnimationFrame(scanFrame);
    } catch {
      setError(t('qr.scan.cameraError'));
      setIsScanning(false);
    }
  }

  function stopScanner() {
    stopScannerRef.current?.();
    stopScannerRef.current = null;
  }

  function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualValue.trim()) {
      setError(t('qr.scan.empty'));
      return;
    }
    handleScannedValue(manualValue.trim());
  }

  return (
    <section className="page-stack">
      <div className="page-header page-header--with-actions">
        <div>
          <p className="eyebrow">{t('qr.eyebrow')}</p>
          <h2>{t('qr.title')}</h2>
          <p>{t('qr.description')}</p>
        </div>
        <button type="button" onClick={() => window.print()}>
          {t('qr.print')}
        </button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <section className="content-card">
        <h3>{t('qr.scan.title')}</h3>
        <p className="hint-text">{t('qr.scan.description')}</p>
        <div className="qr-scanner">
          <video ref={videoRef} muted playsInline />
        </div>
        <div className="action-row action-row--wrap">
          <button type="button" disabled={isScanning} onClick={() => void startScanner()}>
            {isScanning ? t('qr.scan.scanning') : t('qr.scan.start')}
          </button>
          <button className="secondary-button" type="button" disabled={!isScanning} onClick={stopScanner}>
            {t('qr.scan.stop')}
          </button>
        </div>
        <form className="form-stack" onSubmit={handleManualSubmit}>
          <label>
            <span>{t('qr.scan.manualLabel')}</span>
            <input value={manualValue} onChange={(event) => setManualValue(event.target.value)} />
          </label>
          <button type="submit">{t('qr.scan.open')}</button>
        </form>
      </section>

      {isLoading ? <LoadingState /> : null}

      <section className="content-card">
        <h3>{t('qr.labels.title')}</h3>
        <p className="hint-text">{t('qr.labels.description')}</p>
        <div className="qr-label-grid">
          {vehicles.map((vehicle) => {
            const targets = vehicleQrTargets(vehicle, activeLoansByVehicle.get(vehicle.id), t);
            return (
              <article className="qr-label" key={vehicle.id}>
                <div className="card-title-row">
                  <div>
                    <h3>{displayVehicleName(vehicle)}</h3>
                    <p className="hint-text">{vehicle.license_plate || vehicle.serial_number || t('vehicles.noIdentifier')}</p>
                  </div>
                  <StatusBadge status={vehicle.status} />
                </div>
                <div className="qr-card-grid">
                  {targets.map((target) => (
                    <QRCodeCard
                      key={target.key}
                      title={target.title}
                      description={target.description}
                      value={appUrl(target.path)}
                    />
                  ))}
                </div>
                <Link className="button-link secondary-button" to={`/app/vehicles/${vehicle.id}`}>
                  {t('vehicles.actions.details')}
                </Link>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

export function QRResolvePage() {
  const { qrCode } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function resolve() {
      if (!qrCode) {
        setError(t('qr.resolve.missing'));
        return;
      }
      try {
        const resolution = await resolveVehicleQrCode(qrCode);
        if (!isMounted) {
          return;
        }
        const action = normalizeQrAction(searchParams.get('action'));
        navigate(pathForQrAction(resolution.vehicle, resolution.active_loan ?? undefined, action), { replace: true });
      } catch (error) {
        if (isMounted) {
          setError(getApiErrorMessage(error, t, t('qr.resolve.error')));
        }
      }
    }
    resolve();
    return () => {
      isMounted = false;
    };
  }, [navigate, qrCode, searchParams, t]);

  if (error) {
    return <ErrorState message={error} />;
  }

  return <LoadingState />;
}

export function vehicleQrTargets(vehicle: Vehicle, activeLoan: Loan | undefined, t: (key: string) => string): QRTarget[] {
  const qrCode = vehicle.qr_code;
  const targets: QRTarget[] = [
    {
      key: 'details',
      title: t('qr.targets.details.title'),
      description: t('qr.targets.details.description'),
      path: `/app/qr/v/${encodeURIComponent(qrCode)}?action=details`,
    },
  ];

  if (activeLoan) {
    targets.push({
      key: 'loan-return',
      title: t('qr.targets.loanReturn.title'),
      description: t('qr.targets.loanReturn.description'),
      path: `/app/qr/v/${encodeURIComponent(qrCode)}?action=loan-return`,
    });
    return targets;
  }

  if (vehicle.status === 'available') {
    targets.push({
      key: 'loan-checkout',
      title: t('qr.targets.loanCheckout.title'),
      description: t('qr.targets.loanCheckout.description'),
      path: `/app/qr/v/${encodeURIComponent(qrCode)}?action=loan-checkout`,
    });
  } else if (vehicle.status === 'announced') {
    targets.push({
      key: 'check-in',
      title: t('qr.targets.checkIn.title'),
      description: t('qr.targets.checkIn.description'),
      path: `/app/qr/v/${encodeURIComponent(qrCode)}?action=check-in`,
    });
  } else if (!['loaned', 'manufacturer_checkout', 'archived'].includes(vehicle.status)) {
    targets.push({
      key: 'manufacturer-checkout',
      title: t('qr.targets.manufacturerCheckout.title'),
      description: t('qr.targets.manufacturerCheckout.description'),
      path: `/app/qr/v/${encodeURIComponent(qrCode)}?action=manufacturer-checkout`,
    });
  }

  return targets;
}

function normalizeQrAction(action: string | null): QRAction {
  if (
    action === 'check-in' ||
    action === 'loan-checkout' ||
    action === 'loan-return' ||
    action === 'manufacturer-checkout'
  ) {
    return action;
  }
  return 'details';
}

function pathForQrAction(vehicle: Vehicle, activeLoan: Loan | undefined, action: QRAction) {
  if (action === 'check-in' && ['announced', 'checked_in', 'available', 'damaged', 'maintenance'].includes(vehicle.status)) {
    return `/app/workflows/check-in?vehicle=${vehicle.id}`;
  }
  if (action === 'loan-checkout' && vehicle.status === 'available') {
    return `/app/workflows/loan-checkout?vehicle=${vehicle.id}`;
  }
  if (action === 'loan-return' && activeLoan) {
    return `/app/workflows/loan-return?loan=${activeLoan.id}`;
  }
  if (
    action === 'manufacturer-checkout' &&
    !['announced', 'loaned', 'manufacturer_checkout', 'archived'].includes(vehicle.status)
  ) {
    return `/app/workflows/manufacturer-checkout?vehicle=${vehicle.id}`;
  }
  return `/app/vehicles/${vehicle.id}`;
}

function parseQrTarget(value: string) {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/app/')) {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return trimmed.startsWith('/app/') ? trimmed : null;
  }
}
