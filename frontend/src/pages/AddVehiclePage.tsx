import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import {
  createVehicle,
  listVehicleCategories,
  searchVehicles,
  type CreateVehiclePayload,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { FormErrorSummary } from '../components/FormErrorSummary';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';
import { vehicleSearchLabel } from '../components/VehicleContextBanner';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

type FieldErrors = Record<string, string>;

export function AddVehiclePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<Vehicle | null>(null);
  const [category, setCategory] = useState('');
  const [internalNumber, setInternalNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  useDirtyFormWarning(
    !created && Boolean(internalNumber || manufacturer || model || serialNumber || licensePlate || location || notes),
    t('forms.unsaved'),
  );

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    listVehicleCategories()
      .then((items) => {
        if (!active) return;
        const next = items.filter((item) => item.is_active);
        setCategories(next);
        if (next.length === 1) setCategory(next[0].id);
      })
      .catch((loadError) => active && setError(getApiErrorMessage(loadError, t, t('addVehicle.loadError'))))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [t]);

  const loadAnnounced = useCallback(async (query: string, signal: AbortSignal): Promise<SearchableOption[]> => {
    const page = await searchVehicles(query, { status: 'announced' }, signal);
    return page.results.map((vehicle) => ({
      value: vehicle.id,
      label: vehicleSearchLabel(vehicle, t(`status.${vehicle.status}`)),
      keywords: [vehicle.license_plate, vehicle.serial_number, vehicle.current_location, vehicle.status].filter(Boolean).join(' '),
    }));
  }, [t]);

  function validate() {
    const next: FieldErrors = {};
    if (!category) next.category = t('addVehicle.validation.categoryRequired');
    if (!manufacturer.trim()) next.manufacturer = t('addVehicle.validation.manufacturerRequired');
    if (!model.trim()) next.model = t('addVehicle.validation.modelRequired');
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || !validate()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload: CreateVehiclePayload = {
        category,
        manufacturer: manufacturer.trim(),
        model: model.trim(),
      };
      if (internalNumber.trim()) payload.internal_number = internalNumber.trim();
      if (serialNumber.trim()) payload.serial_number = serialNumber.trim();
      if (licensePlate.trim()) payload.license_plate = licensePlate.trim();
      if (location.trim()) payload.current_location = location.trim();
      if (notes.trim()) payload.notes = notes.trim();
      setCreated(await createVehicle(payload));
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, t, t('addVehicle.saveError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <LoadingState />;

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('addVehicle.eyebrow')}
        title={t('addVehicle.recordTitle')}
        description={t('addVehicle.recordIntro')}
        actions={<Link className="button-link success-button" to="/app/workflows/intake">{t('intake.title')}</Link>}
      />
      {error ? <ErrorState message={error} /> : null}
      <section className="content-card">
        <h3>{t('addVehicle.checkInExisting.title')}</h3>
        <p className="hint-text">{t('addVehicle.checkInExisting.hint')}</p>
        <SearchableSelect
          label={t('addVehicle.checkInExisting.label')}
          options={[]}
          value=""
          onChange={(id) => id && navigate(`/app/workflows/check-in?vehicle=${id}`)}
          loadOptions={loadAnnounced}
          loadingText={t('states.loading')}
          placeholder={t('addVehicle.checkInExisting.searchPlaceholder')}
          emptyText={t('addVehicle.checkInExisting.noMatches')}
        />
      </section>
      {created ? (
        <article className="content-card success-card" role="status" aria-live="polite">
          <h3 tabIndex={-1} autoFocus>{t('addVehicle.recordCreated')}</h3>
          <p>{[created.internal_number, created.manufacturer, created.model].filter(Boolean).join(' · ')}</p>
          <p>{t('addVehicle.announcedConsequence')}</p>
          <div className="action-row">
            <Link className="button-link success-button" to={`/app/workflows/check-in?vehicle=${created.id}`}>
              {t('tasks.actions.checkIn')}
            </Link>
            <Link className="button-link secondary-button" to={`/app/vehicles/${created.id}`}>{t('addVehicle.viewVehicle')}</Link>
          </div>
        </article>
      ) : categories.length ? (
        <form className="content-card form-stack" noValidate onSubmit={handleSubmit}>
          <FormErrorSummary errors={fieldErrors} />
          <Field label={t('addVehicle.fields.category')} error={fieldErrors.category} required>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t('addVehicle.fields.selectCategory')}</option>
              {categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label={t('addVehicle.fields.internalNumber')} hint={t('addVehicle.fields.internalNumberHint')}>
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
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('addVehicle.submitting') : t('addVehicle.recordTitle')}
          </button>
        </form>
      ) : (
        <p className="placeholder-card">{t('addVehicle.noCategories')}</p>
      )}
    </section>
  );
}
