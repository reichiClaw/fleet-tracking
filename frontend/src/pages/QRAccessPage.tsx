import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { displayVehicleName, listVehicles, type Vehicle } from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { QRCodeCard } from '../components/QRCodeCard';
import { StatusBadge } from '../components/StatusBadge';

type BarcodeDetectorResult = {
  rawValue: string;
};

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/** The single public status path for a vehicle's QR code. */
export function publicVehiclePath(qrCode: string) {
  return `/v/${encodeURIComponent(qrCode)}`;
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Build a CSV (one row per vehicle) mapping each vehicle to its single QR
 * status URL, for import into label-printer software. Uses CRLF line endings
 * and quoted cells for broad spreadsheet/label-tool compatibility.
 */
export function buildVehicleQrCsv(vehicles: Vehicle[], origin: string) {
  const headers = [
    'internal_number',
    'manufacturer',
    'model',
    'serial_number',
    'license_plate',
    'status',
    'qr_code',
    'status_url',
  ];
  const rows = vehicles.map((vehicle) =>
    [
      vehicle.internal_number,
      vehicle.manufacturer,
      vehicle.model,
      vehicle.serial_number ?? '',
      vehicle.license_plate ?? '',
      vehicle.status,
      vehicle.qr_code,
      `${origin}${publicVehiclePath(vehicle.qr_code)}`,
    ]
      .map(csvCell)
      .join(','),
  );
  return [headers.map(csvCell).join(','), ...rows].join('\r\n');
}

export function QRAccessPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopScannerRef = useRef<(() => void) | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [compact, setCompact] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const nextVehicles = await listVehicles();
        if (isMounted) {
          setVehicles(nextVehicles);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getApiErrorMessage(loadError, t, t('qr.loadError')));
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

  function appUrl(path: string) {
    if (typeof window === 'undefined') {
      return path;
    }
    return `${window.location.origin}${path}`;
  }

  function exportCsv() {
    if (!vehicles.length) {
      return;
    }
    const csv = buildVehicleQrCsv(vehicles, window.location.origin);
    // Prepend a UTF-8 BOM so spreadsheet/label tools detect encoding correctly.
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vehicle-qr-codes.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
      <PageHeader
        eyebrow={t('qr.eyebrow')}
        title={t('qr.title')}
        description={t('qr.description')}
        actions={
          <div className="action-row action-row--wrap">
            <button type="button" onClick={() => window.print()}>
              {t('qr.print')}
            </button>
            <button type="button" className="secondary-button" disabled={!vehicles.length} onClick={exportCsv}>
              {t('qr.export')}
            </button>
          </div>
        }
      />

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

      {isLoading ? <LoadingState variant="skeleton" rows={3} /> : null}

      <section className="content-card">
        <div className="card-title-row">
          <div>
            <h3>{t('qr.labels.title')}</h3>
            <p className="hint-text">{t('qr.labels.description')}</p>
          </div>
          <label className="checkbox-inline">
            <input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} />
            <span>{t('qr.compact')}</span>
          </label>
        </div>
        <div className={`qr-label-grid${compact ? ' qr-label-grid--compact' : ''}`}>
          {vehicles.map((vehicle) => (
            <article className="qr-label" key={vehicle.id}>
              <div className="card-title-row">
                <div>
                  <h3>{displayVehicleName(vehicle)}</h3>
                  <p className="hint-text">{vehicle.license_plate || vehicle.serial_number || t('vehicles.noIdentifier')}</p>
                </div>
                <StatusBadge status={vehicle.status} />
              </div>
              <QRCodeCard
                title={t('qr.shortcuts.cardTitle')}
                description={t('qr.shortcuts.description')}
                value={appUrl(publicVehiclePath(vehicle.qr_code))}
              />
              <Link className="button-link secondary-button" to={`/app/vehicles/${vehicle.id}`}>
                {t('vehicles.actions.details')}
              </Link>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

/**
 * Resolve a scanned value (full URL, app path, public `/v/<code>` path, or a
 * bare vehicle code) to an in-app path, or null when it is not a recognized
 * Fleet Tracking vehicle link.
 */
export function parseQrTarget(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  // A bare vehicle code (e.g. "VH-ABC234XYZ9") maps straight to its status page.
  if (/^VH-[A-Z0-9-]+$/i.test(trimmed)) {
    return publicVehiclePath(trimmed);
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  try {
    const url = new URL(trimmed, origin);
    if (url.origin !== origin) {
      return null;
    }
    if (url.pathname.startsWith('/v/') || url.pathname.startsWith('/app/')) {
      return `${url.pathname}${url.search}`;
    }
    return null;
  } catch {
    if (trimmed.startsWith('/v/') || trimmed.startsWith('/app/')) {
      return trimmed;
    }
    return null;
  }
}
