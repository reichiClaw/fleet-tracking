import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { Field } from '../components/Field';
import { FormErrorSummary } from '../components/FormErrorSummary';

import {
  createDriver,
  createLoanCheckout,
  displayDriverName,
  displayVehicleName,
  generateLoanCheckoutPdf,
  listCompanies,
  listDrivers,
  listVehicleCategories,
  listVehicles,
  mediaDownloadUrl,
  type Company,
  type Driver,
  type MediaFile,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import {
  markMediaAttached,
  MediaUploadField,
  SignatureInput,
  type SignatureInputHandle,
} from '../components/MediaUploadField';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';
import { isValidPhone, localDateTimeToIso } from '../utils/format';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

type BorrowerType = 'driver' | 'company' | 'other';
type FieldErrors = Record<string, string>;
const LOAN_COMPANY_TYPES = new Set<Company['company_type']>(['subcontractor', 'internal']);

function defaultReturnDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function LoanCheckoutPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const language = i18n.language.startsWith('de') ? 'de' : 'en';

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Pre-fill from a reservation hand-over link
  // (?vehicle=&driver=|company=|reserved=) so the borrower is set automatically.
  const presetDriver = searchParams.get('driver') ?? '';
  const presetCompany = searchParams.get('company') ?? '';
  const presetReserved = searchParams.get('reserved') ?? '';
  const presetBorrowerType: BorrowerType = presetDriver ? 'driver' : presetCompany ? 'company' : presetReserved ? 'other' : 'driver';

  const [vehicle, setVehicle] = useState(searchParams.get('vehicle') ?? '');
  const [borrowerType, setBorrowerType] = useState<BorrowerType>(presetBorrowerType);
  const [driver, setDriver] = useState(presetDriver);
  const [company, setCompany] = useState(presetCompany);
  const [borrowerName, setBorrowerName] = useState(presetReserved);
  const [borrowerPhone, setBorrowerPhone] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState(defaultReturnDate());
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const [mediaFileIds, setMediaFileIds] = useState<string[]>([]);
  const [signatureMediaIds, setSignatureMediaIds] = useState<string[]>([]);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [hasDamage, setHasDamage] = useState(false);
  const [damageDescription, setDamageDescription] = useState('');
  const [damageSeverity, setDamageSeverity] = useState('minor');
  const [damagePhotoIds, setDamagePhotoIds] = useState<string[]>([]);
  const signatureRef = useRef<SignatureInputHandle>(null);

  const [result, setResult] = useState<{ id: string; detail: string; pdfError?: string } | null>(null);
  const [generatedPdf, setGeneratedPdf] = useState<MediaFile | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Quick-add driver inline so a loan is not blocked by a missing driver record.
  const [isAddingDriver, setIsAddingDriver] = useState(false);
  const [newDriverFirstName, setNewDriverFirstName] = useState('');
  const [newDriverLastName, setNewDriverLastName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [isSavingDriver, setIsSavingDriver] = useState(false);
  const [quickDriverError, setQuickDriverError] = useState<string | null>(null);
  useDirtyFormWarning(
    !result && Boolean(vehicle || driver || company || borrowerName || borrowerPhone || odometer || hours || notes || mediaFileIds.length || damagePhotoIds.length),
    t('forms.unsaved'),
  );

  async function handleQuickAddDriver() {
    if (isSavingDriver) return;
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
      setDriver(created.id);
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

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextDrivers, nextCompanies, nextCategories] = await Promise.all([
          listVehicles(),
          listDrivers(),
          listCompanies(),
          listVehicleCategories(),
        ]);
        if (isMounted) {
          const eligibleCompanies = nextCompanies.filter(
            (item) => item.is_active && LOAN_COMPANY_TYPES.has(item.company_type),
          );
          const eligibleCompanyIds = new Set(eligibleCompanies.map((item) => item.id));
          const eligibleDrivers = nextDrivers.filter(
            (item) => item.is_active && (!item.company || eligibleCompanyIds.has(item.company)),
          );
          setVehicles(nextVehicles);
          setDrivers(eligibleDrivers);
          setCompanies(eligibleCompanies);
          setCategories(nextCategories);
          if (presetDriver && !eligibleDrivers.some((item) => item.id === presetDriver)) {
            setDriver('');
          }
          if (presetCompany && !eligibleCompanyIds.has(presetCompany)) {
            setCompany('');
          }
          const presetVehicle = searchParams.get('vehicle');
          if (presetVehicle && nextVehicles.find((item) => item.id === presetVehicle)?.status !== 'available') {
            setVehicle('');
            setError(t('workflows.validation.vehicleNotEligible'));
          }
        }
      } catch (error) {
        if (isMounted) {
          setError(getApiErrorMessage(error, t, t('workflows.loadError')));
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

  const loanableVehicles = useMemo(
    () => vehicles.filter((item) => item.status === 'available'),
    [vehicles],
  );
  const selectedDriver = useMemo(() => drivers.find((item) => item.id === driver), [driver, drivers]);
  const selectedCompany = useMemo(() => companies.find((item) => item.id === company), [company, companies]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [categories]);

  // Vehicle options carry every searchable field (name/number, manufacturer,
  // model, plate, serial, category, location, status) so the search box finds a
  // vehicle by anything stored about it.
  const vehicleOptions = useMemo<SearchableOption[]>(
    () =>
      loanableVehicles.map((item) => {
        const categoryName =
          typeof item.category === 'string' ? categoryNameById.get(item.category) ?? '' : item.category?.name ?? '';
        const keywords = [
          item.internal_number,
          item.manufacturer,
          item.model,
          item.license_plate,
          item.serial_number,
          item.current_location,
          categoryName,
          item.status,
          t(`status.${item.status}`),
        ]
          .filter(Boolean)
          .join(' ');
        return { value: item.id, label: displayVehicleName(item), keywords };
      }),
    [loanableVehicles, categoryNameById, t],
  );

  const driverOptions = useMemo<SearchableOption[]>(
    () =>
      drivers.map((item) => {
        const companyName = item.company ? companies.find((c) => c.id === item.company)?.name ?? '' : '';
        const keywords = [item.phone, item.email, item.license_classes, companyName].filter(Boolean).join(' ');
        return {
          value: item.id,
          label: `${displayDriverName(item)}${item.phone ? ` (${item.phone})` : ''}`,
          keywords,
        };
      }),
    [drivers, companies],
  );

  const companyOptions = useMemo<SearchableOption[]>(
    () =>
      companies.map((item) => ({
        value: item.id,
        label: item.name,
        keywords: [item.contact_name, item.email, item.phone, t(`companyTypes.${item.company_type}`)]
          .filter(Boolean)
          .join(' '),
      })),
    [companies, t],
  );

  function addMedia(media: MediaFile) {
    setMediaFileIds((current) => [...current, media.id]);
    if (media.media_type === 'signature') {
      setSignatureMediaIds((current) => [...current, media.id]);
    }
  }

  function resolveBorrower() {
    if (borrowerType === 'driver' && selectedDriver) {
      return { name: displayDriverName(selectedDriver), phone: selectedDriver.phone ?? '' };
    }
    if (borrowerType === 'company' && selectedCompany) {
      return { name: borrowerName.trim() || selectedCompany.contact_name || selectedCompany.name, phone: borrowerPhone.trim() };
    }
    return { name: borrowerName.trim(), phone: borrowerPhone.trim() };
  }

  function validate() {
    const next: FieldErrors = {};
    if (!vehicle) {
      next.vehicle = t('workflows.validation.vehicleRequired');
    } else if (vehicles.find((item) => item.id === vehicle)?.status !== 'available') {
      next.vehicle = t('workflows.validation.vehicleNotEligible');
    }
    if (borrowerType === 'driver' && !driver) {
      next.driver = t('loanCheckout.validation.driverRequired');
    }
    if (borrowerType === 'company' && !company) {
      next.company = t('loanCheckout.validation.companyRequired');
    }
    if (borrowerType === 'other' && !borrowerName.trim()) {
      next.borrowerName = t('workflows.validation.borrowerRequired');
    }
    if (!expectedReturnAt) {
      next.expectedReturnAt = t('workflows.validation.expectedReturnRequired');
    } else if (!localDateTimeToIso(expectedReturnAt) || new Date(expectedReturnAt).getTime() <= Date.now()) {
      next.expectedReturnAt = t('workflows.validation.expectedReturnFuture');
    }
    const borrower = resolveBorrower();
    if (!borrower.name) next.borrowerName = t('workflows.validation.borrowerRequired');
    if (!isValidPhone(borrower.phone)) next.borrowerPhone = t('workflows.validation.phoneInvalid');
    if (signatureMediaIds.length === 0 && !signatureDrawn) next.signature = t('workflows.validation.checkoutSignatureRequired');
    if (hasDamage && !damageDescription.trim()) next.damageDescription = t('workflows.validation.damageDescriptionRequired');
    if (hasDamage && damagePhotoIds.length === 0) next.damagePhoto = t('workflows.validation.damagePhotoRequired');
    const selected = vehicles.find((item) => item.id === vehicle);
    if (selected?.current_odometer_km != null && odometer !== '' && Number(odometer) < selected.current_odometer_km) {
      next.odometer = t('workflows.validation.odometerDecrease');
    }
    if (selected?.current_operating_hours != null && hours !== '' && Number(hours) < Number(selected.current_operating_hours)) {
      next.hours = t('workflows.validation.hoursDecrease');
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setResult(null);
    setGeneratedPdf(null);
    setPdfError(null);
    if (!validate()) {
      return;
    }
    setIsSubmitting(true);
    try {
      // Save the drawn signature (if any) automatically on submit.
      let signatureMediaId: string | null = null;
      try {
        const signature = await signatureRef.current?.commit();
        signatureMediaId = signature?.id ?? null;
      } catch (signatureError) {
        setError(getApiErrorMessage(signatureError, t, t('media.uploadError')));
        setIsSubmitting(false);
        return;
      }
      const borrower = resolveBorrower();
      const payload: Record<string, unknown> = {
        vehicle,
        borrower_name: borrower.name,
        borrower_phone: borrower.phone,
        expected_return_at: localDateTimeToIso(expectedReturnAt),
        media_file_ids: signatureMediaId ? [...mediaFileIds, signatureMediaId] : mediaFileIds,
      };
      if (borrowerType === 'driver') {
        payload.driver = driver;
        if (selectedDriver?.company) {
          payload.company = selectedDriver.company;
        }
      }
      if (borrowerType === 'company') {
        payload.company = company;
      }
      if (odometer !== '') {
        payload.checkout_odometer_km = Number(odometer);
      }
      if (hours !== '') {
        payload.checkout_operating_hours = hours;
      }
      if (notes.trim()) {
        payload.checkout_notes = notes.trim();
      }
      if (hasDamage) {
        payload.damage_reports = [{
          description: damageDescription.trim(),
          severity: damageSeverity,
          media_file_ids: damagePhotoIds,
        }];
      }
      const loan = await createLoanCheckout(payload);
      markMediaAttached([
        ...((payload.media_file_ids as string[]) ?? []),
        ...damagePhotoIds,
      ]);
      setResult({
        id: loan.id,
        detail: loan.borrower_name || borrower.name || t('common.unknown'),
        pdfError: loan.checkout_pdf_generation_error,
      });
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('workflows.submitError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGeneratePdf() {
    if (!result) {
      return;
    }
    setPdfError(null);
    try {
      setGeneratedPdf(await generateLoanCheckoutPdf(result.id, language));
    } catch (error) {
      setPdfError(getApiErrorMessage(error, t, t('pdf.error')));
    }
  }

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('workflows.eyebrow')}</p>
        <h2>{t('workflows.loanCheckout.title')}</h2>
        <p>{t('loanCheckout.intro')}</p>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {pdfError ? <ErrorState message={pdfError} /> : null}

      {result ? (
        <article className="content-card success-card" role="status" aria-live="polite">
          <h3 tabIndex={-1} autoFocus>{t('workflows.loanCheckout.completed')}</h3>
          <p>{result.detail}</p>
          {result.pdfError ? <p className="field-error">{t('pdf.automaticError', { error: result.pdfError })}</p> : null}
          <div className="action-row">
            <button type="button" onClick={handleGeneratePdf}>
              {t('pdf.generate')}
            </button>
            {generatedPdf ? <a href={mediaDownloadUrl(generatedPdf)}>{generatedPdf.original_filename}</a> : null}
            <Link className="button-link secondary-button" to="/app/vehicles">
              {t('vehicles.title')}
            </Link>
          </div>
        </article>
      ) : null}

      {!result ? (
        <form className="content-card form-stack" noValidate onSubmit={handleSubmit}>
          <FormErrorSummary errors={fieldErrors} />
          <SearchableSelect
            label={t('workflows.fields.vehicle')}
            options={vehicleOptions}
            value={vehicle}
            onChange={setVehicle}
            placeholder={t('loanCheckout.searchVehicle')}
            emptyText={t('loanCheckout.noMatches')}
            error={fieldErrors.vehicle}
            required
          >
            {loanableVehicles.length === 0 ? <small className="hint-text">{t('loanCheckout.noVehicles')}</small> : null}
          </SearchableSelect>

          <fieldset className="fieldset-card">
            <legend>{t('loanCheckout.borrowerType.label')}</legend>
            <div className="segmented">
              {(['driver', 'company', 'other'] as BorrowerType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={borrowerType === type}
                  className={`segmented__option${borrowerType === type ? ' is-active' : ''}`}
                  onClick={() => setBorrowerType(type)}
                >
                  {t(`loanCheckout.borrowerType.${type}`)}
                </button>
              ))}
            </div>

            {borrowerType === 'driver' ? (
              <>
                <SearchableSelect
                  label={t('workflows.fields.driver')}
                  options={driverOptions}
                  value={driver}
                  onChange={setDriver}
                  placeholder={t('loanCheckout.searchDriver')}
                  emptyText={t('loanCheckout.noMatches')}
                  error={fieldErrors.driver}
                >
                  {drivers.length === 0 ? <small className="hint-text">{t('loanCheckout.noDrivers')}</small> : null}
                </SearchableSelect>

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
              </>
            ) : null}

            {borrowerType === 'company' ? (
              <>
                <SearchableSelect
                  label={t('workflows.fields.company')}
                  options={companyOptions}
                  value={company}
                  onChange={setCompany}
                  placeholder={t('loanCheckout.searchCompany')}
                  emptyText={t('loanCheckout.noMatches')}
                  error={fieldErrors.company}
                >
                  {companies.length === 0 ? (
                    <small className="hint-text">
                      {t('loanCheckout.noCompanies')} <Link to="/app/partners">{t('navigation.partners')}</Link>
                    </small>
                  ) : null}
                </SearchableSelect>
                <Field label={t('loanCheckout.contactPersonOptional')}>
                  <input value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} />
                </Field>
                <Field label={t('workflows.fields.borrowerPhone')} error={fieldErrors.borrowerPhone} required>
                  <input required type="tel" value={borrowerPhone} onChange={(event) => setBorrowerPhone(event.target.value)} />
                </Field>
              </>
            ) : null}

            {borrowerType === 'other' ? (
              <>
                <Field label={t('workflows.fields.borrowerName')} error={fieldErrors.borrowerName} required>
                  <input required value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} />
                </Field>
                <Field label={t('workflows.fields.borrowerPhone')} error={fieldErrors.borrowerPhone} required>
                  <input required type="tel" value={borrowerPhone} onChange={(event) => setBorrowerPhone(event.target.value)} />
                </Field>
              </>
            ) : null}
          </fieldset>

          <Field label={t('workflows.fields.expectedReturn')} error={fieldErrors.expectedReturnAt} required>
            <input required type="datetime-local" value={expectedReturnAt} onChange={(event) => setExpectedReturnAt(event.target.value)} />
          </Field>

          <fieldset className="fieldset-card">
            <legend>{t('loanCheckout.moreDetails')}</legend>
            <div className="form-grid form-grid--two">
              <Field label={t('workflows.fields.checkoutOdometer')} error={fieldErrors.odometer}>
                <input min="0" type="number" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
              </Field>
              <Field label={t('workflows.fields.checkoutHours')} error={fieldErrors.hours}>
                <input min="0" step="0.1" type="number" value={hours} onChange={(event) => setHours(event.target.value)} />
              </Field>
              <div className="form-grid__full">
                <Field label={t('workflows.fields.notes')}>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
              </div>
            </div>
          </fieldset>

          <fieldset className="fieldset-card">
            <legend>{t('workflows.damage.title')}</legend>
            <label className="checkbox-inline">
              <input type="checkbox" checked={hasDamage} onChange={(event) => setHasDamage(event.target.checked)} />
              <span>{t('workflows.damage.hasDamage')}</span>
            </label>
            {hasDamage ? (
              <>
                <Field label={t('workflows.damage.description')} error={fieldErrors.damageDescription} required>
                  <textarea required value={damageDescription} onChange={(event) => setDamageDescription(event.target.value)} />
                </Field>
                <Field label={t('workflows.damage.severity')}>
                  <select value={damageSeverity} onChange={(event) => setDamageSeverity(event.target.value)}>
                    {['unknown', 'minor', 'major', 'critical'].map((severity) => (
                      <option key={severity} value={severity}>{t(`severity.${severity}`)}</option>
                    ))}
                  </select>
                </Field>
                <MediaUploadField
                  mediaType="photo"
                  label={t('workflows.damage.photoLabel')}
                  accept="image/*"
                  capture
                  required
                  validationError={fieldErrors.damagePhoto}
                  submitted={Boolean(result)}
                  onUploaded={(media) => setDamagePhotoIds((current) => [...current, media.id])}
                  onRemoved={(media) => setDamagePhotoIds((current) => current.filter((id) => id !== media.id))}
                />
              </>
            ) : null}
          </fieldset>

          <fieldset className="fieldset-card">
            <legend>{t('loanCheckout.documentHandover')}</legend>
            <MediaUploadField
              mediaType="photo"
              vehicleId={vehicle || undefined}
              relatedType="workflow_draft"
              label={t('media.photoLabel')}
              accept="image/*"
              capture
              submitted={Boolean(result)}
              onUploaded={addMedia}
              onRemoved={(media) => setMediaFileIds((current) => current.filter((id) => id !== media.id))}
            />
            <SignatureInput
              ref={signatureRef}
              vehicleId={vehicle || undefined}
              relatedType="workflow_draft"
              label={t('media.signatureLabel')}
              required
              validationError={fieldErrors.signature}
              onUploaded={addMedia}
              onRemoved={(media) => {
                setMediaFileIds((current) => current.filter((id) => id !== media.id));
                setSignatureMediaIds((current) => current.filter((id) => id !== media.id));
              }}
              onDrawnChange={setSignatureDrawn}
              submitted={Boolean(result)}
            />
            <p className="hint-text">{t('media.handoffNote')}</p>
          </fieldset>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('workflows.submitting') : t('loanCheckout.submit')}
          </button>
        </form>
      ) : null}
    </section>
  );
}

