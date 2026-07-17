import { type FormEvent, useEffect, useState } from 'react';
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
  const [labelFormat, setLabelFormat] = useState<'standard' | 'compact'>('standard');
  const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('a4');
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

  return (
    <section className={`page-stack qr-print-page qr-paper--${paperSize}`}>
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
          <label><span>{t('qr.bulk.labelFormat')}</span><select value={labelFormat} onChange={(event) => setLabelFormat(event.target.value as 'standard' | 'compact')}>
            <option value="standard">{t('qr.bulk.formats.standard')}</option>
            <option value="compact">{t('qr.bulk.formats.compact')}</option>
          </select></label>
          <label><span>{t('qr.bulk.paperSize')}</span><select value={paperSize} onChange={(event) => setPaperSize(event.target.value as 'a4' | 'letter')}>
            <option value="a4">A4</option><option value="letter">Letter</option>
          </select></label>
          <button type="button" disabled={!selected.size} onClick={() => window.print()}>{t('qr.bulk.printSelected')}</button>
          <button type="button" className="secondary-button" disabled={!selected.size} onClick={exportSelected}>{t('qr.bulk.exportSelected')}</button>
          <button type="button" className="secondary-button" disabled={!selected.size} onClick={() => setSelected(new Map())}>{t('qr.bulk.clearSelection')}</button>
        </section>
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
        <div className={`qr-label-grid print-scope${labelFormat === 'compact' ? ' qr-label-grid--compact' : ''}`} aria-label={t('qr.bulk.preview')}>
          {selectedRows.map((row) => (
            <article className="qr-label" key={row.id}>
              <div className="card-title-row"><h3>{row.label}</h3><StatusBadge status={row.status} /></div>
              <QRCodeCard title={t('qr.shortcuts.cardTitle')} description={row.license_plate || t('qr.shortcuts.description')} value={row.public_url} />
            </article>
          ))}
        </div>
      ) : <p className="info-panel print-hidden">{t('qr.bulk.noSelection')}</p>}
    </section>
  );
}
