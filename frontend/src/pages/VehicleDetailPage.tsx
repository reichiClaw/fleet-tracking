import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import {
  cancelReservation,
  createDriver,
  createReservation,
  displayDriverName,
  displayVehicleName,
  generateCheckInPdf,
  generateLoanCheckoutPdf,
  generateLoanReturnPdf,
  generateManufacturerCheckoutPdf,
  getVehicle,
  getVehicleHistory,
  listDrivers,
  listVehicleCategories,
  mediaDownloadUrl,
  scheduleManufacturerReturn,
  updateVehicle,
  type CreateVehiclePayload,
  type Driver,
  type Loan,
  type MediaFile,
  type Vehicle,
  type VehicleCategory,
  type VehicleHistory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { LoadingState } from '../components/LoadingState';
import { QRCodeCard } from '../components/QRCodeCard';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';
import { ReservationTimeline } from '../components/ReservationTimeline';
import { StatusBadge } from '../components/StatusBadge';
import { publicVehiclePath } from './QRAccessPage';

function defaultReservationStart() {
  const date = new Date();
  date.setHours(8, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function defaultReservationEnd() {
  const date = new Date();
  date.setHours(17, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function VehicleDetailPage() {
  const { vehicleId } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'operations';
  const isAdmin = user?.role === 'admin';
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [history, setHistory] = useState<VehicleHistory | null>(null);
  const [generatedMedia, setGeneratedMedia] = useState<MediaFile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [reservationStart, setReservationStart] = useState(defaultReservationStart);
  const [reservationEnd, setReservationEnd] = useState(defaultReservationEnd);
  const [reservationDriver, setReservationDriver] = useState('');
  const [reservationNotes, setReservationNotes] = useState('');
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [isReserving, setIsReserving] = useState(false);

  const [isAddingDriver, setIsAddingDriver] = useState(false);
  const [newDriverFirstName, setNewDriverFirstName] = useState('');
  const [newDriverLastName, setNewDriverLastName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [isSavingDriver, setIsSavingDriver] = useState(false);
  const [quickDriverError, setQuickDriverError] = useState<string | null>(null);

  const [returnDue, setReturnDue] = useState('');
  const [returnError, setReturnError] = useState<string | null>(null);
  const [isSavingReturn, setIsSavingReturn] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadVehicle() {
      if (!vehicleId) {
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicle, nextHistory, nextCategories, nextDrivers] = await Promise.all([
          getVehicle(vehicleId),
          getVehicleHistory(vehicleId),
          listVehicleCategories(),
          listDrivers(),
        ]);
        if (isMounted) {
          setVehicle(nextVehicle);
          setHistory(nextHistory);
          setCategories(nextCategories);
          setDrivers(nextDrivers.filter((item) => item.is_active));
          setReturnDue(nextVehicle.manufacturer_return_due ?? '');
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
  }, [t, vehicleId, reloadToken]);

  async function handleCreateReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicleId) {
      return;
    }
    setReservationError(null);
    if (!reservationStart || !reservationEnd) {
      setReservationError(t('reservations.validation.required'));
      return;
    }
    if (!reservationDriver) {
      setReservationError(t('reservations.validation.driverRequired'));
      return;
    }
    setIsReserving(true);
    try {
      await createReservation({
        vehicle: vehicleId,
        start_at: new Date(reservationStart).toISOString(),
        end_at: new Date(reservationEnd).toISOString(),
        driver: reservationDriver,
        notes: reservationNotes.trim(),
      });
      setReservationDriver('');
      setReservationNotes('');
      setReloadToken((token) => token + 1);
    } catch (createError) {
      setReservationError(getApiErrorMessage(createError, t, t('reservations.saveError')));
    } finally {
      setIsReserving(false);
    }
  }

  async function handleQuickAddDriver() {
    if (!newDriverFirstName.trim() || !newDriverLastName.trim()) {
      setQuickDriverError(t('management.validation.driverNameRequired'));
      return;
    }
    setIsSavingDriver(true);
    setQuickDriverError(null);
    try {
      const created = await createDriver({
        first_name: newDriverFirstName.trim(),
        last_name: newDriverLastName.trim(),
        phone: newDriverPhone.trim(),
        is_active: true,
      });
      setDrivers((current) => [created, ...current]);
      setReservationDriver(created.id);
      setNewDriverFirstName('');
      setNewDriverLastName('');
      setNewDriverPhone('');
      setIsAddingDriver(false);
    } catch (saveError) {
      setQuickDriverError(getApiErrorMessage(saveError, t, t('management.saveError')));
    } finally {
      setIsSavingDriver(false);
    }
  }

  async function handleCancelReservation(id: string) {
    setReservationError(null);
    try {
      await cancelReservation(id);
      setReloadToken((token) => token + 1);
    } catch (cancelError) {
      setReservationError(getApiErrorMessage(cancelError, t, t('reservations.saveError')));
    }
  }

  async function handleSaveReturnDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicleId) {
      return;
    }
    setReturnError(null);
    setIsSavingReturn(true);
    try {
      const updated = await scheduleManufacturerReturn(vehicleId, returnDue || null);
      setVehicle(updated);
      setReturnDue(updated.manufacturer_return_due ?? '');
    } catch (saveError) {
      setReturnError(getApiErrorMessage(saveError, t, t('reservations.returnDue.saveError')));
    } finally {
      setIsSavingReturn(false);
    }
  }

  const activeLoan = useMemo(() => history?.loans.find((loan) => loan.status === 'active'), [history]);
  const reservations = useMemo(() => history?.reservations ?? [], [history]);
  const activeReservations = useMemo(() => reservations.filter((item) => item.status === 'active'), [reservations]);
  const reservationDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );
  const reports = useMemo(() => (history?.media ?? []).filter((media) => media.media_type === 'pdf'), [history]);
  const driverOptions = useMemo<SearchableOption[]>(
    () =>
      drivers.map((item) => ({
        value: item.id,
        label: displayDriverName(item),
        keywords: [item.phone, item.email, item.license_classes].filter(Boolean).join(' '),
      })),
    [drivers],
  );

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
        {vehicle.status === 'announced' ? (
          <Link className="button-link success-button" to={`/app/workflows/check-in?vehicle=${vehicle.id}`}>
            {t('workflows.checkIn.poolAction')}
          </Link>
        ) : null}
        {vehicle.status === 'available' ? (
          <Link className="button-link" to={`/app/workflows/loan-checkout?vehicle=${vehicle.id}`}>
            {t('workflows.loanCheckout.title')}
          </Link>
        ) : null}
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
        <div className="card-title-row">
          <h3>{t('vehicles.detail.dataTitle')}</h3>
          {isAdmin && !isEditing ? (
            <button type="button" className="secondary-button" onClick={() => setIsEditing(true)}>
              {t('vehicles.detail.edit')}
            </button>
          ) : null}
        </div>
        {isEditing && vehicle ? (
          <VehicleEditForm
            vehicle={vehicle}
            categories={categories}
            onCancel={() => setIsEditing(false)}
            onSaved={(updated) => {
              setVehicle(updated);
              setIsEditing(false);
              setReloadToken((token) => token + 1);
            }}
          />
        ) : (
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
        )}
      </section>

      <section className="content-card">
        <div className="card-title-row">
          <div>
            <h3>{t('reservations.title')}</h3>
            <p className="hint-text">{t('reservations.description')}</p>
          </div>
        </div>

        <form className="reservation-return" onSubmit={handleSaveReturnDue}>
          {vehicle.manufacturer_return_due ? (
            <p className="status-badge status-badge--manufacturer_checkout">
              {t('reservations.returnDue.current', {
                date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
                  new Date(vehicle.manufacturer_return_due),
                ),
              })}
            </p>
          ) : (
            <p className="hint-text">{t('reservations.returnDue.none')}</p>
          )}
          {canManage ? (
            <div className="action-row action-row--wrap">
              <Field label={t('reservations.returnDue.label')}>
                <input type="date" value={returnDue ?? ''} onChange={(event) => setReturnDue(event.target.value)} />
              </Field>
              <button type="submit" className="warning-button" disabled={isSavingReturn}>
                {t('reservations.returnDue.save')}
              </button>
            </div>
          ) : null}
          {returnError ? <p className="field-error">{returnError}</p> : null}
        </form>

        {activeReservations.length || vehicle.manufacturer_return_due ? (
          <ReservationTimeline reservations={reservations} returnDue={vehicle.manufacturer_return_due} />
        ) : (
          <p className="hint-text">{t('reservations.empty')}</p>
        )}

        {canManage ? (
          <form className="form-stack" onSubmit={handleCreateReservation}>
            <div className="form-grid form-grid--two">
              <Field label={t('reservations.fields.start')}>
                <input type="datetime-local" value={reservationStart} onChange={(event) => setReservationStart(event.target.value)} />
              </Field>
              <Field label={t('reservations.fields.end')}>
                <input type="datetime-local" value={reservationEnd} onChange={(event) => setReservationEnd(event.target.value)} />
              </Field>
            </div>
            <SearchableSelect
              label={t('reservations.fields.driver')}
              options={driverOptions}
              value={reservationDriver}
              onChange={setReservationDriver}
              placeholder={t('reservations.fields.driverPlaceholder')}
              emptyText={t('reservations.fields.noDrivers')}
            />
            {isAddingDriver ? (
              <div className="quick-add">
                {quickDriverError ? <ErrorState message={quickDriverError} /> : null}
                <div className="form-grid form-grid--two">
                  <Field label={t('management.fields.firstName')}>
                    <input value={newDriverFirstName} onChange={(event) => setNewDriverFirstName(event.target.value)} />
                  </Field>
                  <Field label={t('management.fields.lastName')}>
                    <input value={newDriverLastName} onChange={(event) => setNewDriverLastName(event.target.value)} />
                  </Field>
                </div>
                <Field label={t('loanCheckout.phoneOptional')}>
                  <input type="tel" value={newDriverPhone} onChange={(event) => setNewDriverPhone(event.target.value)} />
                </Field>
                <div className="action-row">
                  <button type="button" className="success-button" disabled={isSavingDriver} onClick={handleQuickAddDriver}>
                    {isSavingDriver ? t('management.saving') : t('loanCheckout.saveDriver')}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={isSavingDriver}
                    onClick={() => setIsAddingDriver(false)}
                  >
                    {t('management.cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="ghost-button add-driver-button" onClick={() => setIsAddingDriver(true)}>
                {`+ ${t('loanCheckout.quickAddDriver')}`}
              </button>
            )}
            <Field label={t('reservations.fields.notes')}>
              <textarea value={reservationNotes} onChange={(event) => setReservationNotes(event.target.value)} />
            </Field>
            {reservationError ? <p className="field-error">{reservationError}</p> : null}
            <button type="submit" className="success-button" disabled={isReserving}>
              {isReserving ? t('reservations.saving') : t('reservations.submit')}
            </button>
          </form>
        ) : null}

        {activeReservations.length ? (
          <ul className="list-stack list-stack--actions">
            {activeReservations.map((reservation) => (
              <li key={reservation.id}>
                <div>
                  <strong>{reservation.reserved_for || t('reservations.untitled')}</strong>
                  <small>
                    {reservationDateFormatter.format(new Date(reservation.start_at))} –{' '}
                    {reservationDateFormatter.format(new Date(reservation.end_at))}
                  </small>
                </div>
                {canManage ? (
                  <button type="button" className="danger-button" onClick={() => handleCancelReservation(reservation.id)}>
                    {t('reservations.cancel')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
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

function VehicleEditForm({
  vehicle,
  categories,
  onCancel,
  onSaved,
}: {
  vehicle: Vehicle;
  categories: VehicleCategory[];
  onCancel: () => void;
  onSaved: (vehicle: Vehicle) => void;
}) {
  const { t } = useTranslation();
  const currentCategoryId = typeof vehicle.category === 'string' ? vehicle.category : vehicle.category?.id ?? '';
  const [category, setCategory] = useState(currentCategoryId);
  const [internalNumber, setInternalNumber] = useState(vehicle.internal_number ?? '');
  const [manufacturer, setManufacturer] = useState(vehicle.manufacturer ?? '');
  const [model, setModel] = useState(vehicle.model ?? '');
  const [serialNumber, setSerialNumber] = useState(vehicle.serial_number ?? '');
  const [licensePlate, setLicensePlate] = useState(vehicle.license_plate ?? '');
  const [location, setLocation] = useState(vehicle.current_location ?? '');
  const [odometer, setOdometer] = useState(vehicle.current_odometer_km != null ? String(vehicle.current_odometer_km) : '');
  const [hours, setHours] = useState(vehicle.current_operating_hours != null ? String(vehicle.current_operating_hours) : '');
  const [notes, setNotes] = useState(vehicle.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeCategories = categories.filter((item) => item.is_active || item.id === currentCategoryId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manufacturer.trim() || !model.trim()) {
      setError(t('vehicles.detail.editValidation'));
      return;
    }
    setIsSaving(true);
    setError(null);
    const payload: Partial<CreateVehiclePayload> = {
      category,
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      serial_number: serialNumber.trim(),
      license_plate: licensePlate.trim(),
      current_location: location.trim(),
      notes: notes.trim(),
    };
    if (internalNumber.trim()) {
      payload.internal_number = internalNumber.trim();
    }
    if (odometer !== '') {
      payload.current_odometer_km = Number(odometer);
    }
    if (hours !== '') {
      payload.current_operating_hours = hours;
    }
    try {
      const updated = await updateVehicle(vehicle.id, payload);
      onSaved(updated);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('vehicles.detail.editError')));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      {error ? <ErrorState message={error} /> : null}
      <div className="form-grid form-grid--two">
        <Field label={t('addVehicle.fields.category')}>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {activeCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('addVehicle.fields.internalNumber')}>
          <input value={internalNumber} onChange={(event) => setInternalNumber(event.target.value)} />
        </Field>
      </div>
      <div className="form-grid form-grid--two">
        <Field label={t('addVehicle.fields.manufacturer')}>
          <input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} />
        </Field>
        <Field label={t('addVehicle.fields.model')}>
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </Field>
      </div>
      <div className="form-grid form-grid--two">
        <Field label={t('addVehicle.fields.serialNumber')}>
          <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} />
        </Field>
        <Field label={t('addVehicle.fields.licensePlate')}>
          <input value={licensePlate} onChange={(event) => setLicensePlate(event.target.value)} />
        </Field>
      </div>
      <Field label={t('addVehicle.fields.location')}>
        <input value={location} onChange={(event) => setLocation(event.target.value)} />
      </Field>
      <div className="form-grid form-grid--two">
        <Field label={t('addVehicle.fields.odometer')}>
          <input min="0" type="number" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
        </Field>
        <Field label={t('addVehicle.fields.hours')}>
          <input min="0" step="0.1" type="number" value={hours} onChange={(event) => setHours(event.target.value)} />
        </Field>
      </div>
      <Field label={t('addVehicle.fields.notes')}>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      <div className="action-row">
        <button type="submit" className="success-button" disabled={isSaving}>
          {isSaving ? t('vehicles.detail.saving') : t('vehicles.detail.save')}
        </button>
        <button type="button" className="secondary-button" disabled={isSaving} onClick={onCancel}>
          {t('management.cancel')}
        </button>
      </div>
    </form>
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
