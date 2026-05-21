import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

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
  listVehicles,
  mediaDownloadUrl,
  returnLoan,
  type Company,
  type Driver,
  type Loan,
  type MediaFile,
  type Vehicle,
} from '../api/fleet';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { MediaUploadField, SignatureInput } from '../components/MediaUploadField';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [generatedPdf, setGeneratedPdf] = useState<MediaFile | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [mediaFileIds, setMediaFileIds] = useState<string[]>([]);

  const initialVehicle = searchParams.get('vehicle') ?? '';
  const initialLoan = searchParams.get('loan') ?? '';
  const [vehicle, setVehicle] = useState(initialVehicle);
  const [loan, setLoan] = useState(initialLoan);
  const [company, setCompany] = useState('');
  const [driver, setDriver] = useState('');
  const [borrowerName, setBorrowerName] = useState('');
  const [borrowerPhone, setBorrowerPhone] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState('');
  const [performedAt, setPerformedAt] = useState('');
  const [actualReturnAt, setActualReturnAt] = useState('');
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const [targetStatus, setTargetStatus] = useState('available');
  const [damageDescription, setDamageDescription] = useState('');
  const [damageSeverity, setDamageSeverity] = useState('minor');

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextCompanies, nextDrivers, nextLoans] = await Promise.all([
          listVehicles(),
          listCompanies(),
          listDrivers(),
          listLoans(),
        ]);
        if (isMounted) {
          setVehicles(nextVehicles);
          setCompanies(nextCompanies);
          setDrivers(nextDrivers);
          setLoans(nextLoans);
        }
      } catch {
        if (isMounted) {
          setError(t('workflows.loadError'));
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
  const selectableVehicles = useMemo(() => {
    if (kind === 'loan-checkout') {
      return vehicles.filter((item) => item.status === 'available');
    }
    if (kind === 'manufacturer-checkout') {
      return vehicles.filter(
        (item) => !['announced', 'loaned', 'manufacturer_checkout', 'archived'].includes(item.status),
      );
    }
    return vehicles.filter((item) => item.status !== 'archived');
  }, [kind, vehicles]);
  const selectedLoan = useMemo(() => loans.find((item) => item.id === loan), [loan, loans]);
  const selectedVehicleId = kind === 'loan-return' ? selectedLoan?.vehicle : vehicle;
  const currentTitleKey = `workflows.${translationPrefix(kind)}.title`;
  const language = i18n.language.startsWith('de') ? 'de' : 'en';

  useEffect(() => {
    if (kind !== 'loan-checkout' || !driver) {
      return;
    }
    const selectedDriver = drivers.find((item) => item.id === driver);
    if (!selectedDriver) {
      return;
    }
    setBorrowerName(displayDriverName(selectedDriver));
    setBorrowerPhone(selectedDriver.phone || '');
  }, [driver, drivers, kind]);

  function addMedia(media: MediaFile) {
    setMediaFileIds((current) => [...current, media.id]);
  }

  function validate() {
    const nextErrors: FieldErrors = {};
    if (kind === 'loan-return') {
      if (!loan) {
        nextErrors.loan = t('workflows.validation.loanRequired');
      }
    } else if (!vehicle) {
      nextErrors.vehicle = t('workflows.validation.vehicleRequired');
    } else if (!selectableVehicles.some((item) => item.id === vehicle)) {
      nextErrors.vehicle = t('workflows.validation.vehicleUnavailable');
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

    if (damageSeverity !== 'unknown' && !damageDescription.trim() && targetStatus === 'damaged') {
      nextErrors.damageDescription = t('workflows.validation.damageDescriptionRequired');
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
      const payload = buildPayload();
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
    } catch {
      setError(t('workflows.submitError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildPayload() {
    const payload: Record<string, unknown> = {
      media_file_ids: mediaFileIds,
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

    if (damageDescription.trim()) {
      payload.damage_reports = [{ description: damageDescription.trim(), severity: damageSeverity }];
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
    } catch {
      setPdfError(t('pdf.error'));
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
          <Field label={t('workflows.fields.vehicle')} error={fieldErrors.vehicle}>
            <select value={vehicle} onChange={(event) => setVehicle(event.target.value)}>
              <option value="">{t('workflows.placeholders.selectVehicle')}</option>
              {selectableVehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {displayVehicleName(item)}
                </option>
              ))}
            </select>
          </Field>
        )}

        {kind === 'loan-checkout' || kind === 'check-in' || kind === 'manufacturer-checkout' ? (
          <Field label={t(kind === 'manufacturer-checkout' ? 'workflows.fields.recipientCompany' : 'workflows.fields.company')}>
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
              <input value={borrowerPhone} onChange={(event) => setBorrowerPhone(event.target.value)} />
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
          <SignatureInput
            vehicleId={selectedVehicleId}
            loanId={kind === 'loan-return' ? loan : undefined}
            relatedType="workflow_draft"
            label={t('media.signatureLabel')}
            onUploaded={addMedia}
          />
          <p className="hint-text">{t('media.handoffNote')}</p>
        </fieldset>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('workflows.submitting') : t('workflows.submit')}
        </button>
      </form>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label>
      <span>{label}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
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

function loanLabel(loan: Loan, vehicles: Vehicle[], fallback: string) {
  const vehicle = vehicles.find((item) => item.id === loan.vehicle);
  const vehicleName = vehicle ? displayVehicleName(vehicle) : fallback;
  return `${vehicleName} · ${loan.borrower_name || fallback}`;
}
