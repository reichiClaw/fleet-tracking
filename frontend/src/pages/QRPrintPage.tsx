import { type CSSProperties, type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  getVehicle,
  listQrBulkPage,
  listVehicleCategories,
  type PageResult,
  type QrBulkRow,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
import { QRCodeCard } from '../components/QRCodeCard';
import { StatusBadge } from '../components/StatusBadge';
import { publicVehiclePath } from './QRAccessPage';

type LabelPreset =
  | '62x29'
  | '54x25'
  | '50x30'
  | '40x30'
  | '100x50'
  | 'custom'
  | 'a4-sheet'
  | 'letter-sheet';

const LABEL_PRESETS: Record<Exclude<LabelPreset, 'custom' | 'a4-sheet' | 'letter-sheet'>, {
  width: number;
  height: number;
}> = {
  '62x29': { width: 62, height: 29 },
  '54x25': { width: 54, height: 25 },
  '50x30': { width: 50, height: 30 },
  '40x30': { width: 40, height: 30 },
  '100x50': { width: 100, height: 50 },
};

export function QRPrintPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const requestedVehicle = params.get('vehicle');
  const [rows, setRows] = useState<QrBulkRow[]>([]);
  const [resultPage, setResultPage] = useState<PageResult<QrBulkRow> | null>(null);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [selected, setSelected] = useState<Map<string, QrBulkRow>>(new Map());
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [labelPreset, setLabelPreset] = useState<LabelPreset>('62x29');
  const [customWidth, setCustomWidth] = useState(62);
  const [customHeight, setCustomHeight] = useState(29);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVehicleCategories().then(setCategories).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const request = requestedVehicle
      ? getVehicle(requestedVehicle, controller.signal).then((vehicle) => {
        const row: QrBulkRow = {
          id: vehicle.id,
          qr_code: vehicle.qr_code,
          internal_number: vehicle.internal_number,
          license_plate: vehicle.license_plate,
          status: vehicle.status,
          label: [vehicle.internal_number, vehicle.manufacturer, vehicle.model].filter(Boolean).join(' · '),
          public_url: `${window.location.origin}${publicVehiclePath(vehicle.qr_code)}`,
        };
        return { count: 1, next: null, previous: null, results: [row], page: 1, pageSize: 1 };
      })
      : listQrBulkPage({ search, status, category, include_inactive: includeInactive }, page, controller.signal);
    request
      .then((nextPage) => {
        if (!active) return;
        setRows(nextPage.results);
        setResultPage(nextPage);
        if (requestedVehicle) setSelected(new Map(nextPage.results.map((row) => [row.id, row])));
      })
      .catch((loadError) => {
        if (active && !controller.signal.aborted) setError(getApiErrorMessage(loadError, t, t('qr.loadError')));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [category, includeInactive, page, requestedVehicle, search, status, t]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function selectRow(row: QrBulkRow, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });
  }

  function selectCurrentPage(checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      rows.forEach((row) => checked ? next.set(row.id, row) : next.delete(row.id));
      return next;
    });
  }

  function exportSelected() {
    const lines = [
      ['internal_number', 'license_plate', 'status', 'url'],
      ...[...selected.values()].map((row) => [row.internal_number, row.license_plate ?? '', row.status, row.public_url]),
    ];
    const csv = `\ufeff${lines.map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'selected-vehicle-qr-codes.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const selectedRows = [...selected.values()];
  const currentPageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const isSheet = labelPreset === 'a4-sheet' || labelPreset === 'letter-sheet';
  const labelDimensions = useMemo(() => {
    if (labelPreset === 'custom') {
      return {
        width: Math.min(200, Math.max(20, customWidth || 20)),
        height: Math.min(150, Math.max(20, customHeight || 20)),
      };
    }
    if (isSheet) return null;
    return LABEL_PRESETS[labelPreset];
  }, [customHeight, customWidth, isSheet, labelPreset]);
  const printPageRule = isSheet
    ? `@page { size: ${labelPreset === 'letter-sheet' ? 'letter' : 'A4'}; margin: 8mm; }`
    : `@page { size: ${labelDimensions?.width ?? 62}mm ${labelDimensions?.height ?? 29}mm; margin: 0; }`;
  const printStyle = labelDimensions
    ? ({
        '--qr-label-width': `${labelDimensions.width}mm`,
        '--qr-label-height': `${labelDimensions.height}mm`,
      } as CSSProperties)
    : undefined;

  return (
    <section className={`page-stack qr-print-page${isSheet ? ' qr-print-page--sheet' : ' qr-print-page--roll'}`}>
      <style media="print">{printPageRule}</style>
      <div className="print-hidden">
        <PageHeader
          eyebrow={t('qr.bulk.eyebrow')}
          title={t('qr.bulk.title')}
          description={t('qr.bulk.description')}
          actions={<Link className="button-link secondary-button" to="/app/tasks">{t('qr.bulk.scannerTask')}</Link>}
        />
        <form className="filter-panel" onSubmit={apply}>
          <label><span>{t('vehicles.filters.search')}</span><input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></label>
          <label><span>{t('vehicles.filters.status')}</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">{t('vehicles.filters.allStatuses')}</option>
            {['announced', 'checked_in', 'available', 'reserved', 'loaned', 'maintenance', 'damaged', 'manufacturer_checkout', 'archived'].map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
          </select></label>
          <label><span>{t('vehicles.filters.category')}</span><select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}>
            <option value="">{t('vehicles.filters.allCategories')}</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label className="checkbox-inline"><input type="checkbox" checked={includeInactive} onChange={(event) => { setIncludeInactive(event.target.checked); setPage(1); }} /><span>{t('qr.bulk.includeInactive')}</span></label>
          <button type="submit">{t('vehicles.filters.apply')}</button>
        </form>

        <section className="content-card bulk-toolbar">
          <label className="checkbox-inline">
            <input type="checkbox" checked={currentPageSelected} onChange={(event) => selectCurrentPage(event.target.checked)} />
            <span>{t('qr.bulk.selectPage')}</span>
          </label>
          <strong>{t('qr.bulk.selectedCount', { count: selected.size })}</strong>
          <label><span>{t('qr.bulk.labelSize')}</span><select value={labelPreset} onChange={(event) => setLabelPreset(event.target.value as LabelPreset)}>
            <option value="62x29">{t('qr.bulk.sizes.62x29')}</option>
            <option value="54x25">{t('qr.bulk.sizes.54x25')}</option>
            <option value="50x30">{t('qr.bulk.sizes.50x30')}</option>
            <option value="40x30">{t('qr.bulk.sizes.40x30')}</option>
            <option value="100x50">{t('qr.bulk.sizes.100x50')}</option>
            <option value="custom">{t('qr.bulk.sizes.custom')}</option>
            <option value="a4-sheet">{t('qr.bulk.sizes.a4')}</option>
            <option value="letter-sheet">{t('qr.bulk.sizes.letter')}</option>
          </select></label>
          {labelPreset === 'custom' ? (
            <div className="qr-custom-size">
              <label>
                <span>{t('qr.bulk.customWidth')}</span>
                <input type="number" min="20" max="200" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} />
              </label>
              <label>
                <span>{t('qr.bulk.customHeight')}</span>
                <input type="number" min="20" max="150" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} />
              </label>
            </div>
          ) : null}
          <button type="button" disabled={!selected.size} onClick={() => window.print()}>{t('qr.bulk.printSelected')}</button>
          <button type="button" className="secondary-button" disabled={!selected.size} onClick={exportSelected}>{t('qr.bulk.exportSelected')}</button>
          <button type="button" className="secondary-button" disabled={!selected.size} onClick={() => setSelected(new Map())}>{t('qr.bulk.clearSelection')}</button>
        </section>
        <p className="info-panel qr-printer-hint">{t('qr.bulk.printerHint')}</p>
      </div>

      {loading ? <LoadingState variant="skeleton" rows={4} /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && rows.length ? (
        <section className="content-card print-hidden">
          <div className="table-scroll">
            <table>
              <caption>{t('qr.bulk.caption')}</caption>
              <thead><tr>
                <th scope="col">{t('qr.bulk.select')}</th>
                <th scope="col">{t('reports.columns.vehicle')}</th>
                <th scope="col">{t('reports.columns.plate')}</th>
                <th scope="col">{t('reports.columns.status')}</th>
              </tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id}>
                <td><input type="checkbox" aria-label={t('qr.bulk.selectVehicle', { vehicle: row.label })} checked={selected.has(row.id)} onChange={(event) => selectRow(row, event.target.checked)} /></td>
                <td>{row.label}</td><td>{row.license_plate || t('common.notAvailable')}</td><td><StatusBadge status={row.status} /></td>
              </tr>)}</tbody>
            </table>
          </div>
          {!requestedVehicle && resultPage ? <PaginationControls page={resultPage} onPageChange={setPage} /> : null}
        </section>
      ) : null}
      {!loading && !error && !rows.length ? <EmptyState title={t('vehicles.empty.title')} description={t('qr.bulk.empty')} /> : null}

      {selectedRows.length ? (
        <div
          className={`qr-label-grid print-scope${isSheet ? ' qr-label-grid--sheet' : ' qr-label-grid--roll'}`}
          style={printStyle}
          aria-label={t('qr.bulk.preview')}
        >
          {selectedRows.map((row) => (
            <article className="qr-label" key={row.id}>
              <div className="qr-label__identity">
                <h3>{row.internal_number}</h3>
                <span>{row.license_plate || row.label}</span>
                {isSheet ? <StatusBadge status={row.status} /> : null}
              </div>
              <QRCodeCard
                title={row.label}
                value={row.public_url}
                humanReadableValue={row.qr_code}
                showHeader={false}
              />
            </article>
          ))}
        </div>
      ) : <p className="info-panel print-hidden">{t('qr.bulk.noSelection')}</p>}
    </section>
  );
}
