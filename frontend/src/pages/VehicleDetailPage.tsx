import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import {
  archiveVehicle,
  scheduleManufacturerReturn,
  updateVehicle,
  getVehicleHistory,
  listVehicleCategories,
  type CreateVehiclePayload,
  type Vehicle,
  type VehicleCategory,
  type VehicleHistory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { FormErrorSummary } from '../components/FormErrorSummary';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { QRCodeCard } from '../components/QRCodeCard';
import { StatusBadge } from '../components/StatusBadge';
import { VehicleConditionTimeline } from '../components/VehicleConditionTimeline';
import {
  CurrentConditionPanel,
  VehicleContextBanner,
  useVehicleContext,
} from '../components/VehicleContextBanner';
import { formatDateOnly } from '../utils/format';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';
import { publicVehiclePath } from './QRAccessPage';

type FieldErrors = Record<string, string>;

function appUrl(path: string) {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

export function VehicleDetailPage() {
  const { vehicleId } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || user?.role === 'operations';
  const isAdmin = user?.role === 'admin';
  const vehicleState = useVehicleContext(vehicleId);
  const [history, setHistory] = useState<VehicleHistory | null>(null);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(Boolean(vehicleId));
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [returnDue, setReturnDue] = useState('');
  const [returnError, setReturnError] = useState<string | null>(null);
  const [isSavingReturn, setIsSavingReturn] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  useEffect(() => {
    if (!vehicleId) return;
    let active = true;
    const controller = new AbortController();
    setIsHistoryLoading(true);
    setHistoryError(null);
    Promise.all([
      getVehicleHistory(vehicleId, controller.signal),
      isAdmin ? listVehicleCategories() : Promise.resolve([]),
    ])
      .then(([nextHistory, nextCategories]) => {
        if (!active) return;
        setHistory({
          ...nextHistory,
          loans: nextHistory.loans ?? [],
          reservations: nextHistory.reservations ?? [],
          check_ins: nextHistory.check_ins ?? [],
          manufacturer_checkouts: nextHistory.manufacturer_checkouts ?? [],
          damages: nextHistory.damages ?? [],
          maintenance: nextHistory.maintenance ?? [],
          timeline: nextHistory.timeline ?? [],
          media: nextHistory.media ?? [],
        });
        setCategories(nextCategories);
      })
      .catch((loadError) => {
        if (active && !controller.signal.aborted) {
          setHistoryError(getApiErrorMessage(loadError, t, t('vehicles.detail.loadError')));
        }
      })
      .finally(() => {
        if (active) setIsHistoryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [isAdmin, reloadToken, t, vehicleId]);

  useEffect(() => {
    setReturnDue(vehicleState.context?.vehicle.manufacturer_return_due ?? '');
  }, [vehicleState.context?.vehicle.manufacturer_return_due]);

  function reload() {
    vehicleState.retry();
    setReloadToken((value) => value + 1);
  }

  async function handleSaveReturnDue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicleId || isSavingReturn) return;
    setReturnError(null);
    setIsSavingReturn(true);
    try {
      await scheduleManufacturerReturn(vehicleId, returnDue || null);
      setNotice(t('reservations.returnDue.saved'));
      reload();
    } catch (saveError) {
      setReturnError(getApiErrorMessage(saveError, t, t('reservations.returnDue.saveError')));
    } finally {
      setIsSavingReturn(false);
    }
  }

  async function handleArchive() {
    if (!vehicleId || isArchiving) return;
    if (!archiveReason.trim()) {
      setArchiveError(t('archive.reasonRequired'));
      setConfirmArchive(false);
      return;
    }
    setIsArchiving(true);
    setArchiveError(null);
    try {
      await archiveVehicle(vehicleId, archiveReason.trim());
      setNotice(t('archive.success'));
      setConfirmArchive(false);
      reload();
    } catch (error) {
      setArchiveError(getApiErrorMessage(error, t, t('archive.error')));
    } finally {
      setIsArchiving(false);
    }
  }

  if (vehicleState.isLoading || isHistoryLoading) {
    return <LoadingState variant="skeleton" rows={5} />;
  }

  const context = vehicleState.context;
  const vehicle = context?.vehicle;
  const loadError = vehicleState.error || historyError;
  if (loadError || !context || !vehicle || !history) {
    return <ErrorState message={loadError || t('vehicles.detail.loadError')} onRetry={reload} />;
  }

  const capabilities = context.capabilities;
  const firstOpenDamage = context.open_damages[0];

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('vehicles.detail.eyebrow')}
        title={[vehicle.internal_number, vehicle.manufacturer, vehicle.model].filter(Boolean).join(' · ')}
        description={vehicle.notes || t('vehicles.detail.description')}
        actions={<StatusBadge status={vehicle.status} />}
      />

      {notice ? <p className="success-text" role="status" aria-live="polite">{notice}</p> : null}
      {archiveError ? <ErrorState message={archiveError} /> : null}

      <VehicleContextBanner
        context={context}
        category={vehicleState.category}
        thumbnailUrl={vehicleState.thumbnailUrl}
      />
      <CurrentConditionPanel context={context} media={vehicleState.media} />

      <nav className="action-row action-row--wrap" aria-label={t('vehicles.detail.actionsLabel')}>
        {capabilities.can_check_in ? (
          <Link className="button-link success-button" to={`/app/workflows/check-in?vehicle=${vehicle.id}`}>
            {t('tasks.actions.checkIn')}
          </Link>
        ) : null}
        {capabilities.can_loan_checkout ? (
          <Link className="button-link" to={`/app/workflows/loan-checkout?vehicle=${vehicle.id}`}>
            {t('tasks.actions.loan')}
          </Link>
        ) : null}
        {capabilities.can_loan_return && context.active_loan ? (
          <Link className="button-link" to={`/app/workflows/loan-return?loan=${context.active_loan.id}`}>
            {t('tasks.actions.returnLoan')}
          </Link>
        ) : null}
        {capabilities.can_manufacturer_return ? (
          <Link className="button-link danger-button" to={`/app/workflows/manufacturer-return?vehicle=${vehicle.id}`}>
            {t('tasks.actions.manufacturerReturn')}
          </Link>
        ) : null}
        {capabilities.can_reserve ? (
          <Link className="button-link secondary-button" to={`/app/reservations?vehicle=${vehicle.id}`}>
            {t('reservations.submit')}
          </Link>
        ) : null}
        {canManage && firstOpenDamage ? (
          <Link className="button-link warning-button" to={`/app/tasks/maintenance?vehicle=${vehicle.id}&action=resolve&damage=${firstOpenDamage.id}`}>
            {t('maintenance.actions.resolve')}
          </Link>
        ) : null}
        {capabilities.can_send_to_maintenance ? (
          <Link className="button-link warning-button" to={`/app/tasks/maintenance?vehicle=${vehicle.id}&action=start`}>
            {t('maintenance.actions.start')}
          </Link>
        ) : null}
        {capabilities.can_complete_maintenance ? (
          <Link className="button-link warning-button" to={`/app/tasks/maintenance?vehicle=${vehicle.id}&action=complete`}>
            {t('maintenance.actions.complete')}
          </Link>
        ) : null}
      </nav>

      <section className="content-card">
        <div className="card-title-row">
          <h3>{t('vehicles.detail.dataTitle')}</h3>
          {capabilities.can_edit_master_data && !isEditing ? (
            <button type="button" className="secondary-button" onClick={() => setIsEditing(true)}>
              {t('vehicles.detail.edit')}
            </button>
          ) : null}
        </div>
        {isEditing ? (
          <VehicleEditForm
            vehicle={vehicle}
            categories={categories}
            onCancel={() => setIsEditing(false)}
            onSaved={() => {
              setIsEditing(false);
              setNotice(t('vehicles.detail.saved'));
              reload();
            }}
          />
        ) : (
          <dl className="detail-list detail-list--wide">
            <div><dt>{t('vehicles.fields.licensePlate')}</dt><dd>{vehicle.license_plate || t('common.notAvailable')}</dd></div>
            <div><dt>{t('vehicles.fields.serialNumber')}</dt><dd>{vehicle.serial_number || t('common.notAvailable')}</dd></div>
            <div><dt>{t('vehicles.fields.location')}</dt><dd>{vehicle.current_location || t('common.notAvailable')}</dd></div>
            <div><dt>{t('addVehicle.fields.category')}</dt><dd>{vehicleState.category?.name || t('common.notAvailable')}</dd></div>
          </dl>
        )}
      </section>

      <section className="content-card">
        <div className="card-title-row">
          <div>
            <h3>{t('qr.shortcuts.title')}</h3>
            <p className="hint-text">{t('qr.shortcuts.description')}</p>
          </div>
          <Link className="button-link secondary-button" to={`/app/qr/print?vehicle=${vehicle.id}`}>
            {t('qr.print')}
          </Link>
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
          <div>
            <h3>{t('reservations.title')}</h3>
            <p className="hint-text">{t('reservations.description')}</p>
          </div>
          {canManage ? (
            <Link className="button-link secondary-button" to={`/app/reservations?vehicle=${vehicle.id}`}>
              {t('reservationWizard.title')}
            </Link>
          ) : null}
        </div>
        {vehicle.manufacturer_return_due ? (
          <p className="warning-panel">
            {t('reservations.returnDue.current', {
              date: formatDateOnly(vehicle.manufacturer_return_due, i18n.language, t('common.notAvailable')),
            })}
          </p>
        ) : <p className="hint-text">{t('reservations.returnDue.none')}</p>}
        {canManage ? (
          <form className="reservation-return" onSubmit={handleSaveReturnDue}>
            <Field label={t('reservations.returnDue.label')}>
              <input type="date" value={returnDue} onChange={(event) => setReturnDue(event.target.value)} />
            </Field>
            <button type="submit" className="secondary-button" disabled={isSavingReturn}>
              {t('reservations.returnDue.save')}
            </button>
            {returnError ? <small className="field-error">{returnError}</small> : null}
          </form>
        ) : null}
      </section>

      <VehicleConditionTimeline history={history} />

      {capabilities.can_archive ? (
        <section className="content-card danger-zone">
          <h3>{t('archive.action')}</h3>
          <Field label={t('archive.reason')} error={archiveError || undefined} required>
            <textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} />
          </Field>
          <button
            type="button"
            className="danger-button"
            onClick={() => archiveReason.trim() ? setConfirmArchive(true) : setArchiveError(t('archive.reasonRequired'))}
          >
            {t('archive.action')}
          </button>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmArchive}
        title={t('archive.confirmTitle')}
        description={t('archive.confirmDescription')}
        confirmLabel={t('archive.action')}
        busy={isArchiving}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => void handleArchive()}
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
  onSaved: () => void;
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
  const [notes, setNotes] = useState(vehicle.notes ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isDirty = (
    category !== currentCategoryId
    || internalNumber !== (vehicle.internal_number ?? '')
    || manufacturer !== (vehicle.manufacturer ?? '')
    || model !== (vehicle.model ?? '')
    || serialNumber !== (vehicle.serial_number ?? '')
    || licensePlate !== (vehicle.license_plate ?? '')
    || location !== (vehicle.current_location ?? '')
    || notes !== (vehicle.notes ?? '')
  );
  useDirtyFormWarning(isDirty, t('forms.unsaved'));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    const next: FieldErrors = {};
    if (!category) next.category = t('addVehicle.validation.categoryRequired');
    if (!manufacturer.trim()) next.manufacturer = t('addVehicle.validation.manufacturerRequired');
    if (!model.trim()) next.model = t('addVehicle.validation.modelRequired');
    setFieldErrors(next);
    if (Object.keys(next).length) return;

    const payload: Partial<CreateVehiclePayload> = {
      category,
      internal_number: internalNumber.trim(),
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      serial_number: serialNumber.trim(),
      license_plate: licensePlate.trim(),
      current_location: location.trim(),
      notes: notes.trim(),
    };
    setIsSaving(true);
    setError(null);
    try {
      await updateVehicle(vehicle.id, payload);
      onSaved();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('vehicles.detail.editError')));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="form-stack" noValidate onSubmit={handleSubmit}>
      {error ? <ErrorState message={error} /> : null}
      <FormErrorSummary errors={fieldErrors} />
      <Field label={t('addVehicle.fields.category')} error={fieldErrors.category} required>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.filter((item) => item.is_active || item.id === currentCategoryId).map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </Field>
      <Field label={t('addVehicle.fields.internalNumber')}>
        <input value={internalNumber} onChange={(event) => setInternalNumber(event.target.value)} />
      </Field>
      <div className="form-grid form-grid--two">
        <Field label={t('addVehicle.fields.manufacturer')} error={fieldErrors.manufacturer} required>
          <input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} />
        </Field>
        <Field label={t('addVehicle.fields.model')} error={fieldErrors.model} required>
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </Field>
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
      <Field label={t('addVehicle.fields.notes')}>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      <div className="action-row">
        <button type="submit" disabled={isSaving}>{isSaving ? t('vehicles.detail.saving') : t('common.save')}</button>
        <button type="button" className="secondary-button" disabled={isSaving} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
