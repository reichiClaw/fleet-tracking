import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { Field } from '../components/Field';

import {
  createCheckIn,
  createLoanCheckout,
  createManufacturerCheckout,
  displayDriverName,
  displayVehicleName,
  generateCheckInPdf,
  generateLoanCheckoutPdf,
  generateLoanReturnPdf,
  generateManufacturerCheckoutPdf,
  listCompanies,
  listDrivers,
  listLoans,
  listVehicleCategories,
  listVehicles,
  mediaDownloadUrl,
  returnLoan,
  type Company,
  type Driver,
  type Loan,
  type MediaFile,
  type Vehicle,
  type VehicleCategory,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { MediaUploadField, SignatureInput, type SignatureInputHandle } from '../components/MediaUploadField';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';

export type WorkflowKind = 'check-in' | 'loan-checkout' | 'loan-return' | 'manufacturer-checkout';

type FieldErrors = Record<string, string>;

type WorkflowResult = {
  id: string;
  titleKey: string;
  detail: string;
  pdfAction?: () => Promise<MediaFile>;
};

const targetStatuses = ['available', 'damaged', 'maintenance'] as const;
const severityOptions = ['unknown', 'minor', 'major', 'critical'] as const;

export function WorkflowPage({ kind }: { kind: WorkflowKind }) {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [generatedPdf, setGeneratedPdf] = useState<MediaFile | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [mediaFileIds, setMediaFileIds] = useState<string[]>([]);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const signatureRef = useRef<SignatureInputHandle>(null);

  const initialVehicle = searchParams.get('vehicle') ?? '';
  const initialLoan = searchParams.get('loan') ?? '';
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [loan, setLoan] = useState(initialLoan);
  const [company, setCompany] = useState('');
  const [driver, setDriver] = useState('');
  const [borrowerName, setBorrowerName] = useState('');
  const [borrowerPhone, setBorrowerPhone] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [performedAt, setPerformedAt] = useState(nowForDateTimeLocal);
  const [actualReturnAt, setActualReturnAt] = useState('');
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const [targetStatus, setTargetStatus] = useState('available');
  const [hasDamage, setHasDamage] = useState(false);
  const [damageDescription, setDamageDescription] = useState('');
  const [damageSeverity, setDamageSeverity] = useState('minor');
  const [damagePhotoIds, setDamagePhotoIds] = useState<string[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextCompanies, nextDrivers, nextLoans, nextCategories] = await Promise.all([
          listVehicles(),
          listCompanies(),
          listDrivers(),
          listLoans(),
          listVehicleCategories(),
        ]);
        if (isMounted) {
          setVehicles(nextVehicles);
          setCompanies(nextCompanies);
          setDrivers(nextDrivers);
          setLoans(nextLoans);
          setCategories(nextCategories);
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
    loadData();
    return () => {
      isMounted = false;
    };
  }, [t]);

  const activeLoans = useMemo(() => loans.filter((item) => item.status === 'active'), [loans]);
  const selectedLoan = useMemo(() => loans.find((item) => item.id === loan), [loan, loans]);
  const selectedVehicleId = kind === 'loan-return' ? selectedLoan?.vehicle : vehicle;

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [categories]);

  // For check-in the user picks from vehicles still awaiting check-in
  // ("announced"); other workflows can target any vehicle. The search matches
  // every stored field so a vehicle is easy to find.
  const vehicleOptions = useMemo<SearchableOption[]>(() => {
    let source = vehicles;
    if (kind === 'check-in') {
      source = vehicles.filter((item) => item.status === 'announced' || item.id === vehicle);
    } else if (kind === 'manufacturer-checkout') {
      // Only vehicles still in the fleet can be removed; already-removed,
      // loaned, or not-yet-checked-in vehicles are not eligible.
      const eligible = new Set(['available', 'checked_in', 'maintenance', 'damaged', 'reserved']);
      source = vehicles.filter((item) => eligible.has(item.status) || item.id === vehicle);
    }
    return source.map((item) => {
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
    });
  }, [vehicles, vehicle, kind, categoryNameById, t]);
  const damageRequiredByStatus = (kind === 'check-in' || kind === 'loan-return') && targetStatus === 'damaged';
  const damageActive = hasDamage || damageRequiredByStatus;
  const currentTitleKey = `workflows.${translationPrefix(kind)}.title`;
  const language = i18n.language.startsWith('de') ? 'de' : 'en';

  function addMedia(media: MediaFile) {
    setMediaFileIds((current) => [...current, media.id]);
    if (media.media_type === 'signature') {
      setHasSignature(true);
    }
  }

  function addDamagePhoto(media: MediaFile) {
    setDamagePhotoIds((current) => [...current, media.id]);
  }

  function validate() {
    const nextErrors: FieldErrors = {};
    if (kind === 'loan-return') {
      if (!loan) {
        nextErrors.loan = t('workflows.validation.loanRequired');
      }
    } else if (!vehicle) {
      nextErrors.vehicle = t('workflows.validation.vehicleRequired');
    }

    if (kind === 'loan-checkout') {
      if (!driver && !borrowerName.trim()) {
        nextErrors.borrowerName = t('workflows.validation.borrowerRequired');
      }
      if (!borrowerPhone.trim()) {
        nextErrors.borrowerPhone = t('workflows.validation.phoneRequired');
      }
      if (!expectedReturnAt) {
        nextErrors.expectedReturnAt = t('workflows.validation.expectedReturnRequired');
      }
    }

    if (damageActive && !damageDescription.trim()) {
      nextErrors.damageDescription = t('workflows.validation.damageDescriptionRequired');
    }

    // A damage report must be backed by at least one photo of the damage.
    if (damageActive && damagePhotoIds.length === 0) {
      nextErrors.damagePhoto = t('workflows.validation.damagePhotoRequired');
    }

    // Every loan return must be signed off (drawn signature or uploaded image).
    if (kind === 'loan-return' && !hasSignature && !signatureDrawn) {
      nextErrors.signature = t('workflows.validation.signatureRequired');
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setGeneratedPdf(null);
    setPdfError(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      // Capture the drawn signature (if any) at submit time so it is saved
      // automatically without a separate "save" step.
      let signatureMediaId: string | null = null;
      try {
        const signature = await signatureRef.current?.commit();
        signatureMediaId = signature?.id ?? null;
      } catch (signatureError) {
        setError(getApiErrorMessage(signatureError, t, t('media.uploadError')));
        setIsSubmitting(false);
        return;
      }
      const payload = buildPayload(signatureMediaId ? [signatureMediaId] : []);
      if (kind === 'check-in') {
        const protocol = await createCheckIn(payload);
        setResult({
          id: protocol.id,
          titleKey: 'workflows.checkIn.completed',
          detail: displayVehicleName(vehicles.find((item) => item.id === protocol.vehicle)) || protocol.vehicle,
          pdfAction: () => generateCheckInPdf(protocol.id, language),
        });
      } else if (kind === 'loan-checkout') {
        const nextLoan = await createLoanCheckout(payload);
        setResult({
          id: nextLoan.id,
          titleKey: 'workflows.loanCheckout.completed',
          detail: nextLoan.borrower_name || borrowerName || t('common.unknown'),
          pdfAction: () => generateLoanCheckoutPdf(nextLoan.id, language),
        });
      } else if (kind === 'loan-return') {
        const returned = await returnLoan(loan, payload);
        setResult({
          id: returned.id,
          titleKey: 'workflows.loanReturn.completed',
          detail: returned.borrower_name || t('common.unknown'),
          pdfAction: () => generateLoanReturnPdf(returned.id, language),
        });
      } else {
        const protocol = await createManufacturerCheckout(payload);
        setResult({
          id: protocol.id,
          titleKey: 'workflows.manufacturerCheckout.completed',
          detail: displayVehicleName(vehicles.find((item) => item.id === protocol.vehicle)) || protocol.vehicle,
          pdfAction: () => generateManufacturerCheckoutPdf(protocol.id, language),
        });
      }
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('workflows.submitError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildPayload(extraMediaIds: string[] = []) {
    const payload: Record<string, unknown> = {
      media_file_ids: [...mediaFileIds, ...extraMediaIds],
    };

    if (kind !== 'loan-return') {
      payload.vehicle = vehicle;
    }
    if (kind === 'check-in') {
      assignIfPresent(payload, 'performed_at', toIso(performedAt));
      assignIfPresent(payload, 'supplier_company', company);
      assignIfPresent(payload, 'odometer_km', toNumber(odometer));
      assignIfPresent(payload, 'operating_hours', hours);
      assignIfPresent(payload, 'condition_notes', notes.trim());
      assignIfPresent(payload, 'target_status', targetStatus);
    }
    if (kind === 'loan-checkout') {
      assignIfPresent(payload, 'company', company);
      assignIfPresent(payload, 'driver', driver);
      assignIfPresent(payload, 'borrower_name', borrowerName.trim());
      payload.borrower_phone = borrowerPhone.trim();
      payload.expected_return_at = toIso(expectedReturnAt) ?? expectedReturnAt;
      assignIfPresent(payload, 'checkout_odometer_km', toNumber(odometer));
      assignIfPresent(payload, 'checkout_operating_hours', hours);
      assignIfPresent(payload, 'checkout_notes', notes.trim());
    }
    if (kind === 'loan-return') {
      assignIfPresent(payload, 'actual_return_at', toIso(actualReturnAt));
      assignIfPresent(payload, 'return_odometer_km', toNumber(odometer));
      assignIfPresent(payload, 'return_operating_hours', hours);
      assignIfPresent(payload, 'return_notes', notes.trim());
      assignIfPresent(payload, 'target_status', targetStatus);
    }
    if (kind === 'manufacturer-checkout') {
      assignIfPresent(payload, 'performed_at', toIso(performedAt));
      assignIfPresent(payload, 'recipient_company', company);
      assignIfPresent(payload, 'odometer_km', toNumber(odometer));
      assignIfPresent(payload, 'operating_hours', hours);
      assignIfPresent(payload, 'condition_notes', notes.trim());
    }

    if (damageActive && damageDescription.trim()) {
      payload.damage_reports = [
        { description: damageDescription.trim(), severity: damageSeverity, media_file_ids: damagePhotoIds },
      ];
    }

    return payload;
  }

  async function handleGeneratePdf() {
    if (!result?.pdfAction) {
      return;
    }
    setPdfError(null);
    try {
      setGeneratedPdf(await result.pdfAction());
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
        <h2>{t(currentTitleKey)}</h2>
        <p>{t(`workflows.${translationPrefix(kind)}.description`)}</p>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {pdfError ? <ErrorState message={pdfError} /> : null}
      {result ? (
        <article className="content-card success-card">
          <h3>{t(result.titleKey)}</h3>
          <p>{result.detail}</p>
          <div className="action-row">
            {result.pdfAction ? (
              <button type="button" onClick={handleGeneratePdf}>
                {t('pdf.generate')}
              </button>
            ) : null}
            {generatedPdf ? <a href={mediaDownloadUrl(generatedPdf)}>{generatedPdf.original_filename}</a> : null}
            <Link className="button-link secondary-button" to="/app/vehicles">
              {t('vehicles.title')}
            </Link>
          </div>
        </article>
      ) : null}

      <form className="content-card form-stack" onSubmit={handleSubmit}>
        {kind === 'loan-return' ? (
          <Field label={t('workflows.fields.loan')} error={fieldErrors.loan}>
            <select value={loan} onChange={(event) => setLoan(event.target.value)}>
              <option value="">{t('workflows.placeholders.selectLoan')}</option>
              {activeLoans.map((item) => (
                <option key={item.id} value={item.id}>
                  {loanLabel(item, vehicles, t('common.unknown'))}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <SearchableSelect
            label={t('workflows.fields.vehicle')}
            options={vehicleOptions}
            value={vehicle}
            onChange={setVehicle}
            placeholder={kind === 'check-in' ? t('workflows.placeholders.searchAnnouncedVehicle') : t('workflows.placeholders.searchVehicle')}
            emptyText={t('workflows.placeholders.noVehicleMatches')}
            error={fieldErrors.vehicle}
          >
            {kind === 'check-in' && vehicleOptions.length === 0 ? (
              <small className="hint-text">{t('workflows.checkIn.noAnnounced')}</small>
            ) : null}
          </SearchableSelect>
        )}

        {kind === 'loan-checkout' ? (
          <Field label={t('workflows.fields.company')}>
            <select value={company} onChange={(event) => setCompany(event.target.value)}>
              <option value="">{t('workflows.placeholders.optionalCompany')}</option>
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {kind === 'loan-checkout' ? (
          <>
            <Field label={t('workflows.fields.driver')}>
              <select value={driver} onChange={(event) => setDriver(event.target.value)}>
                <option value="">{t('workflows.placeholders.optionalDriver')}</option>
                {drivers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {displayDriverName(item)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('workflows.fields.borrowerName')} error={fieldErrors.borrowerName}>
              <input value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} />
            </Field>
            <Field label={t('workflows.fields.borrowerPhone')} error={fieldErrors.borrowerPhone}>
              <input min="0" step="1" type="number" value={borrowerPhone} onChange={(event) => setBorrowerPhone(event.target.value)} />
            </Field>
            <Field label={t('workflows.fields.expectedReturn')} error={fieldErrors.expectedReturnAt}>
              <input type="datetime-local" value={expectedReturnAt} onChange={(event) => setExpectedReturnAt(event.target.value)} />
            </Field>
          </>
        ) : null}

        {kind === 'check-in' || kind === 'manufacturer-checkout' ? (
          <Field label={t('workflows.fields.performedAt')}>
            <input type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} />
          </Field>
        ) : null}

        {kind === 'loan-return' ? (
          <Field label={t('workflows.fields.actualReturn')}>
            <input type="datetime-local" value={actualReturnAt} onChange={(event) => setActualReturnAt(event.target.value)} />
          </Field>
        ) : null}

        <div className="form-grid form-grid--two">
          <Field label={t(kind === 'loan-return' ? 'workflows.fields.returnOdometer' : kind === 'loan-checkout' ? 'workflows.fields.checkoutOdometer' : 'workflows.fields.odometer')}>
            <input min="0" type="number" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
          </Field>
          <Field label={t(kind === 'loan-return' ? 'workflows.fields.returnHours' : kind === 'loan-checkout' ? 'workflows.fields.checkoutHours' : 'workflows.fields.hours')}>
            <input min="0" step="0.1" type="number" value={hours} onChange={(event) => setHours(event.target.value)} />
          </Field>
        </div>

        {kind === 'check-in' || kind === 'loan-return' ? (
          <Field label={t('workflows.fields.targetStatus')}>
            <select value={targetStatus} onChange={(event) => setTargetStatus(event.target.value)}>
              {targetStatuses.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label={t('workflows.fields.notes')}>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <fieldset className="fieldset-card">
          <legend>{t('workflows.damage.title')}</legend>
          <span className="field-label">
            {t(kind === 'check-in' ? 'workflows.damage.deliveryQuestion' : 'workflows.damage.occurredQuestion')}
          </span>
          <div className="radio-group">
            <label className="radio-inline">
              <input
                type="radio"
                name="workflow-has-damage"
                checked={!damageActive}
                disabled={damageRequiredByStatus}
                onChange={() => {
                  setHasDamage(false);
                  setDamageDescription('');
                  setDamageSeverity('minor');
                  setDamagePhotoIds([]);
                }}
              />
              <span>{t('common.no')}</span>
            </label>
            <label className="radio-inline">
              <input
                type="radio"
                name="workflow-has-damage"
                checked={damageActive}
                disabled={damageRequiredByStatus}
                onChange={() => setHasDamage(true)}
              />
              <span>{t('common.yes')}</span>
            </label>
          </div>
          {damageRequiredByStatus ? (
            <p className="hint-text">{t('workflows.damage.requiredForDamagedStatus')}</p>
          ) : null}
          {damageActive ? (
            <>
              <Field label={t('workflows.damage.description')} error={fieldErrors.damageDescription}>
                <textarea value={damageDescription} onChange={(event) => setDamageDescription(event.target.value)} />
              </Field>
              <Field label={t('workflows.damage.severity')}>
                <select value={damageSeverity} onChange={(event) => setDamageSeverity(event.target.value)}>
                  {severityOptions.map((severity) => (
                    <option key={severity} value={severity}>
                      {t(`severity.${severity}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <MediaUploadField
                mediaType="photo"
                vehicleId={selectedVehicleId}
                relatedType="workflow_draft"
                label={t('workflows.damage.photoLabel')}
                accept="image/*"
                capture
                onUploaded={addDamagePhoto}
              />
              {damagePhotoIds.length > 0 ? (
                <p className="hint-text">{t('workflows.damage.photoCount', { count: damagePhotoIds.length })}</p>
              ) : null}
              {fieldErrors.damagePhoto ? (
                <small className="field-error">{fieldErrors.damagePhoto}</small>
              ) : (
                <p className="hint-text">{t('workflows.damage.photoRequired')}</p>
              )}
            </>
          ) : (
            <p className="hint-text">{t('workflows.damage.optionalHint')}</p>
          )}
        </fieldset>

        <fieldset className="fieldset-card">
          <legend>{t('media.title')}</legend>
          <MediaUploadField
            mediaType="photo"
            vehicleId={selectedVehicleId}
            loanId={kind === 'loan-return' ? loan : undefined}
            relatedType="workflow_draft"
            label={t('media.photoLabel')}
            accept="image/*"
            capture
            onUploaded={addMedia}
          />
          {/* Signatures are only collected when a third party is involved
              (loan return). Internal check-in / removal workflows are signed off
              by recording the acting user on the report instead. */}
          {kind === 'loan-return' ? (
            <>
              <p className="hint-text">{t('media.signatureRequired')}</p>
              <SignatureInput
                ref={signatureRef}
                vehicleId={selectedVehicleId}
                loanId={loan}
                relatedType="workflow_draft"
                label={t('media.signatureLabel')}
                onUploaded={addMedia}
                onDrawnChange={setSignatureDrawn}
              />
              {fieldErrors.signature ? <small className="field-error">{fieldErrors.signature}</small> : null}
              <p className="hint-text">{t('media.handoffNote')}</p>
            </>
          ) : (
            <p className="hint-text">{t('media.internalWorkflowNote')}</p>
          )}
        </fieldset>

        <button
          type="submit"
          className={kind === 'check-in' ? 'success-button' : kind === 'manufacturer-checkout' ? 'danger-button' : undefined}
          disabled={isSubmitting}
        >
          {isSubmitting ? t('workflows.submitting') : t('workflows.submit')}
        </button>
      </form>
    </section>
  );
}

function translationPrefix(kind: WorkflowKind) {
  if (kind === 'check-in') return 'checkIn';
  if (kind === 'loan-checkout') return 'loanCheckout';
  if (kind === 'loan-return') return 'loanReturn';
  return 'manufacturerCheckout';
}

function assignIfPresent(payload: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined && value !== null && value !== '') {
    payload[key] = value;
  }
}

function toNumber(value: string) {
  return value === '' ? undefined : Number(value);
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

/**
 * Current local date/time formatted for a `datetime-local` input
 * (`YYYY-MM-DDTHH:mm`). Used to pre-fill "Performed at" so it always carries
 * the actual time, even when the user does not touch the field.
 */
function nowForDateTimeLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function loanLabel(loan: Loan, vehicles: Vehicle[], fallback: string) {
  const vehicle = vehicles.find((item) => item.id === loan.vehicle);
  const vehicleName = vehicle ? displayVehicleName(vehicle) : fallback;
  return `${vehicleName} · ${loan.borrower_name || fallback}`;
}
