import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import {
  displayVehicleName,
  listVehiclePage,
  type PageResult,
  type Vehicle,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
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
  const [vehiclePage, setVehiclePage] = useState<PageResult<Vehicle> | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [compact, setCompact] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const nextPage = await listVehiclePage({ active: true }, page, controller.signal);
        if (isMounted) {
          setVehicles(nextPage.results);
          setVehiclePage(nextPage);
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
      controller.abort();
      stopScanner();
    };
  }, [page, t]);

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
    // Camera scanning needs getUserMedia, which requires a secure context (HTTPS
    // or localhost). It is available on modern iOS Safari and Android browsers.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('qr.scan.unsupported'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      setIsScanning(true);

      // Prefer the native BarcodeDetector (Android/Chrome). iOS Safari lacks it,
      // so fall back to decoding camera frames with jsQR — works on every phone.
      const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
      const canvas = detector ? null : document.createElement('canvas');
      const context = canvas ? canvas.getContext('2d', { willReadFrequently: true }) : null;
      // Load the pure-JS QR decoder only when the native detector is missing
      // (e.g. iOS Safari), keeping it out of the initial bundle.
      const decodeQr = detector ? null : (await import('jsqr')).default;
      let stopped = false;
      let detectorFailures = 0;

      async function decodeFrame(): Promise<string | null> {
        if (!video) {
          return null;
        }
        if (detector) {
          const results = await detector.detect(video);
          return results[0]?.rawValue ?? null;
        }
        if (!canvas || !context || !decodeQr || !video.videoWidth) {
          return null;
        }
        // Downscale for fast, battery-friendly decoding on phones.
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = decodeQr(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        return result?.data ?? null;
      }

      async function scanFrame() {
        if (stopped || !videoRef.current) {
          return;
        }
        try {
          const value = await decodeFrame();
          if (value) {
            handleScannedValue(value);
            return;
          }
        } catch {
          detectorFailures += 1;
          if (detectorFailures >= 10) {
            setError(t('qr.scan.decodeError'));
            stopScanner();
            return;
          }
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
            <Link className="button-link" to="/app/qr/print">
              {t('qr.print')}
            </Link>
            <button type="button" className="secondary-button" disabled={!vehicles.length} onClick={exportCsv}>
              {t('qr.exportPage')}
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
        {vehiclePage && vehiclePage.count > 0 ? (
          <PaginationControls page={vehiclePage} onPageChange={setPage} />
        ) : null}
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
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return null;
  } catch {
    if (trimmed.startsWith('/v/') || trimmed.startsWith('/app/')) {
      return trimmed;
    }
    return null;
  }
}
