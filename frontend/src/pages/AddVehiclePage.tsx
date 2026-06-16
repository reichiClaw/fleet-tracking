import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  createDamageReport,
  createVehicle,
  listVehicleCategories,
  updateMedia,
  type CreateVehiclePayload,
  type DamageSeverity,
  type MediaFile,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { LoadingState } from '../components/LoadingState';
import { MediaUploadField } from '../components/MediaUploadField';
import { PageHeader } from '../components/PageHeader';

type FieldErrors = Record<string, string>;

const severityOptions: DamageSeverity[] = ['unknown', 'minor', 'major', 'critical'];

export function AddVehiclePage() {
  const { t } = useTranslation();
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
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');

  const [hasDamage, setHasDamage] = useState(false);
  const [damageDescription, setDamageDescription] = useState('');
  const [damageSeverity, setDamageSeverity] = useState<DamageSeverity>('minor');
  const [damageMedia, setDamageMedia] = useState<MediaFile[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const nextCategories = await listVehicleCategories();
        if (isMounted) {
          const active = nextCategories.filter((item) => item.is_active);
          setCategories(active);
          // Autofill the category when there is only one choice so the
          // operator does not have to pick it manually on every vehicle.
          if (active.length === 1) {
            setCategory(active[0].id);
          }
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getApiErrorMessage(loadError, t, t('addVehicle.loadError')));
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
  }, [t]);

  const canSubmit = useMemo(() => categories.length > 0, [categories]);

  function resetForm() {
    setCategory(categories.length === 1 ? categories[0].id : '');
    setInternalNumber('');
    setManufacturer('');
    setModel('');
    setSerialNumber('');
    setLicensePlate('');
    setLocation('');
    setOdometer('');
    setHours('');
    setNotes('');
    setHasDamage(false);
    setDamageDescription('');
    setDamageSeverity('minor');
    setDamageMedia([]);
    setFieldErrors({});
  }

  function addDamageMedia(media: MediaFile) {
    setDamageMedia((current) => [...current, media]);
  }

  function validate() {
    const next: FieldErrors = {};
    if (!category) {
      next.category = t('addVehicle.validation.categoryRequired');
    }
    if (!manufacturer.trim()) {
      next.manufacturer = t('addVehicle.validation.manufacturerRequired');
    }
    if (!model.trim()) {
      next.model = t('addVehicle.validation.modelRequired');
    }
    if (hasDamage) {
      if (!damageDescription.trim()) {
        next.damageDescription = t('addVehicle.validation.damageDescriptionRequired');
      }
      if (damageMedia.length === 0) {
        next.damagePhoto = t('addVehicle.validation.damagePhotoRequired');
      }
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreated(null);
    if (!validate()) {
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: CreateVehiclePayload = {
        category,
        manufacturer: manufacturer.trim(),
        model: model.trim(),
        // New vehicles are added straight into the operational pool.
        status: 'available',
      };
      if (internalNumber.trim()) {
        payload.internal_number = internalNumber.trim();
      }
      if (serialNumber.trim()) {
        payload.serial_number = serialNumber.trim();
      }
      if (licensePlate.trim()) {
        payload.license_plate = licensePlate.trim();
      }
      if (location.trim()) {
        payload.current_location = location.trim();
      }
      if (odometer !== '') {
        payload.current_odometer_km = Number(odometer);
      }
      if (hours !== '') {
        payload.current_operating_hours = hours;
      }
      if (notes.trim()) {
        payload.notes = notes.trim();
      }
      const vehicle = await createVehicle(payload);
      if (hasDamage) {
        const damage = await createDamageReport({
          vehicle: vehicle.id,
          description: damageDescription.trim(),
          severity: damageSeverity,
          workflow_phase: 'general',
        });
        await Promise.all(
          damageMedia.map((media) =>
            updateMedia(media.id, {
              vehicle: vehicle.id,
              damage_report: damage.id,
              related_type: 'damage_report',
              related_id: damage.id,
            }),
          ),
        );
      }
      setCreated(vehicle);
      resetForm();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, t, t('addVehicle.saveError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow={t('addVehicle.eyebrow')} title={t('addVehicle.title')} description={t('addVehicle.intro')} />

      {error ? <ErrorState message={error} /> : null}

      {created ? (
        <article className="content-card success-card">
          <h3>{t('addVehicle.completed')}</h3>
          <p>{[created.internal_number, created.manufacturer, created.model].filter(Boolean).join(' · ')}</p>
          <div className="action-row">
            <Link className="button-link" to={`/app/vehicles/${created.id}`}>
              {t('addVehicle.viewVehicle')}
            </Link>
            <Link className="button-link secondary-button" to="/app/vehicles">
              {t('vehicles.title')}
            </Link>
          </div>
        </article>
      ) : null}

      {!canSubmit ? (
        <section className="placeholder-card">
          <p>{t('addVehicle.noCategories')}</p>
        </section>
      ) : (
        <form className="content-card form-stack" onSubmit={handleSubmit}>
          <Field label={t('addVehicle.fields.category')} error={fieldErrors.category}>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">{t('addVehicle.fields.selectCategory')}</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('addVehicle.fields.internalNumber')} hint={t('addVehicle.fields.internalNumberHint')}>
            <input value={internalNumber} onChange={(event) => setInternalNumber(event.target.value)} />
          </Field>

          <div className="form-grid form-grid--two">
            <Field label={t('addVehicle.fields.manufacturer')} error={fieldErrors.manufacturer}>
              <input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} />
            </Field>
            <Field label={t('addVehicle.fields.model')} error={fieldErrors.model}>
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

          <fieldset className="fieldset-card">
            <legend>{t('addVehicle.damage.title')}</legend>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={hasDamage}
                onChange={(event) => {
                  const next = event.target.checked;
                  setHasDamage(next);
                  if (!next) {
                    setDamageDescription('');
                    setDamageSeverity('minor');
                    setDamageMedia([]);
                    setFieldErrors((current) => {
                      const rest = { ...current };
                      delete rest.damageDescription;
                      delete rest.damagePhoto;
                      return rest;
                    });
                  }
                }}
              />
              <span>{t('addVehicle.damage.hasDamage')}</span>
            </label>
            {hasDamage ? (
              <>
                <Field label={t('addVehicle.damage.description')} error={fieldErrors.damageDescription}>
                  <textarea
                    value={damageDescription}
                    onChange={(event) => setDamageDescription(event.target.value)}
                  />
                </Field>
                <Field label={t('addVehicle.damage.severity')}>
                  <select
                    value={damageSeverity}
                    onChange={(event) => setDamageSeverity(event.target.value as DamageSeverity)}
                  >
                    {severityOptions.map((severity) => (
                      <option key={severity} value={severity}>
                        {t(`severity.${severity}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <MediaUploadField
                  mediaType="photo"
                  relatedType="damage_report"
                  label={t('addVehicle.damage.photoLabel')}
                  accept="image/*"
                  capture
                  onUploaded={addDamageMedia}
                />
                {damageMedia.length > 0 ? (
                  <ul className="media-list">
                    {damageMedia.map((media) => (
                      <li key={media.id}>{media.original_filename}</li>
                    ))}
                  </ul>
                ) : null}
                {fieldErrors.damagePhoto ? (
                  <small className="field-error">{fieldErrors.damagePhoto}</small>
                ) : (
                  <p className="hint-text">{t('addVehicle.damage.photoRequired')}</p>
                )}
              </>
            ) : (
              <p className="hint-text">{t('addVehicle.damage.noDamageHint')}</p>
            )}
          </fieldset>

          <button type="submit" className="success-button" disabled={isSubmitting}>
            {isSubmitting ? t('addVehicle.submitting') : t('addVehicle.submit')}
          </button>
        </form>
      )}
    </section>
  );
}
