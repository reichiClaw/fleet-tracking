import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { Field } from '../components/Field';

import {
  createLoanCheckout,
  displayDriverName,
  displayVehicleName,
  generateLoanCheckoutPdf,
  listCompanies,
  listDrivers,
  listVehicles,
  mediaDownloadUrl,
  type Company,
  type Driver,
  type MediaFile,
  type Vehicle,
} from '../api/fleet';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { MediaUploadField, SignatureInput } from '../components/MediaUploadField';

type BorrowerType = 'driver' | 'company' | 'other';
type FieldErrors = Record<string, string>;

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [vehicle, setVehicle] = useState(searchParams.get('vehicle') ?? '');
  const [borrowerType, setBorrowerType] = useState<BorrowerType>('driver');
  const [driver, setDriver] = useState('');
  const [company, setCompany] = useState('');
  const [borrowerName, setBorrowerName] = useState('');
  const [borrowerPhone, setBorrowerPhone] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState(defaultReturnDate());
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [showHandover, setShowHandover] = useState(false);
  const [mediaFileIds, setMediaFileIds] = useState<string[]>([]);

  const [result, setResult] = useState<{ id: string; detail: string } | null>(null);
  const [generatedPdf, setGeneratedPdf] = useState<MediaFile | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextVehicles, nextDrivers, nextCompanies] = await Promise.all([
          listVehicles(),
          listDrivers(),
          listCompanies(),
        ]);
        if (isMounted) {
          setVehicles(nextVehicles);
          setDrivers(nextDrivers.filter((item) => item.is_active));
          setCompanies(nextCompanies.filter((item) => item.is_active));
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
    load();
    return () => {
      isMounted = false;
    };
  }, [t]);

  const loanableVehicles = useMemo(
    () => vehicles.filter((item) => item.status === 'available' || item.id === vehicle),
    [vehicles, vehicle],
  );
  const selectedDriver = useMemo(() => drivers.find((item) => item.id === driver), [driver, drivers]);
  const selectedCompany = useMemo(() => companies.find((item) => item.id === company), [company, companies]);

  function addMedia(media: MediaFile) {
    setMediaFileIds((current) => [...current, media.id]);
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
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
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
      const borrower = resolveBorrower();
      const payload: Record<string, unknown> = {
        vehicle,
        borrower_name: borrower.name,
        borrower_phone: borrower.phone,
        expected_return_at: new Date(expectedReturnAt).toISOString(),
        media_file_ids: mediaFileIds,
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
      const loan = await createLoanCheckout(payload);
      setResult({ id: loan.id, detail: loan.borrower_name || borrower.name || t('common.unknown') });
    } catch {
      setError(t('workflows.submitError'));
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
        <h2>{t('workflows.loanCheckout.title')}</h2>
        <p>{t('loanCheckout.intro')}</p>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {pdfError ? <ErrorState message={pdfError} /> : null}

      {result ? (
        <article className="content-card success-card">
          <h3>{t('workflows.loanCheckout.completed')}</h3>
          <p>{result.detail}</p>
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
        <form className="content-card form-stack" onSubmit={handleSubmit}>
          <Field label={t('workflows.fields.vehicle')} error={fieldErrors.vehicle}>
            <select value={vehicle} onChange={(event) => setVehicle(event.target.value)}>
              <option value="">{t('workflows.placeholders.selectVehicle')}</option>
              {loanableVehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {displayVehicleName(item)}
                </option>
              ))}
            </select>
            {loanableVehicles.length === 0 ? <small className="hint-text">{t('loanCheckout.noVehicles')}</small> : null}
          </Field>

          <fieldset className="fieldset-card">
            <legend>{t('loanCheckout.borrowerType.label')}</legend>
            <div className="segmented">
              {(['driver', 'company', 'other'] as BorrowerType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`segmented__option${borrowerType === type ? ' is-active' : ''}`}
                  onClick={() => setBorrowerType(type)}
                >
                  {t(`loanCheckout.borrowerType.${type}`)}
                </button>
              ))}
            </div>

            {borrowerType === 'driver' ? (
              <Field label={t('workflows.fields.driver')} error={fieldErrors.driver}>
                <select value={driver} onChange={(event) => setDriver(event.target.value)}>
                  <option value="">{t('loanCheckout.selectDriver')}</option>
                  {drivers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {displayDriverName(item)}
                      {item.phone ? ` (${item.phone})` : ''}
                    </option>
                  ))}
                </select>
                {drivers.length === 0 ? (
                  <small className="hint-text">
                    {t('loanCheckout.noDrivers')} <Link to="/app/drivers">{t('navigation.drivers')}</Link>
                  </small>
                ) : null}
              </Field>
            ) : null}

            {borrowerType === 'company' ? (
              <>
                <Field label={t('workflows.fields.company')} error={fieldErrors.company}>
                  <select value={company} onChange={(event) => setCompany(event.target.value)}>
                    <option value="">{t('loanCheckout.selectCompany')}</option>
                    {companies.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  {companies.length === 0 ? (
                    <small className="hint-text">
                      {t('loanCheckout.noCompanies')} <Link to="/app/companies">{t('navigation.companies')}</Link>
                    </small>
                  ) : null}
                </Field>
                <Field label={t('loanCheckout.contactPersonOptional')}>
                  <input value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} />
                </Field>
                <Field label={t('loanCheckout.phoneOptional')}>
                  <input min="0" step="1" type="number" value={borrowerPhone} onChange={(event) => setBorrowerPhone(event.target.value)} />
                </Field>
              </>
            ) : null}

            {borrowerType === 'other' ? (
              <>
                <Field label={t('workflows.fields.borrowerName')} error={fieldErrors.borrowerName}>
                  <input value={borrowerName} onChange={(event) => setBorrowerName(event.target.value)} />
                </Field>
                <Field label={t('loanCheckout.phoneOptional')}>
                  <input min="0" step="1" type="number" value={borrowerPhone} onChange={(event) => setBorrowerPhone(event.target.value)} />
                </Field>
              </>
            ) : null}
          </fieldset>

          <Field label={t('workflows.fields.expectedReturn')} error={fieldErrors.expectedReturnAt}>
            <input type="datetime-local" value={expectedReturnAt} onChange={(event) => setExpectedReturnAt(event.target.value)} />
          </Field>

          <button type="button" className="disclosure" onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? '▾' : '▸'} {t('loanCheckout.moreDetails')}
          </button>
          {showDetails ? (
            <div className="form-grid form-grid--two">
              <Field label={t('workflows.fields.checkoutOdometer')}>
                <input min="0" type="number" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
              </Field>
              <Field label={t('workflows.fields.checkoutHours')}>
                <input min="0" step="0.1" type="number" value={hours} onChange={(event) => setHours(event.target.value)} />
              </Field>
              <div className="form-grid__full">
                <Field label={t('workflows.fields.notes')}>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
              </div>
            </div>
          ) : null}

          <button type="button" className="disclosure" onClick={() => setShowHandover((value) => !value)}>
            {showHandover ? '▾' : '▸'} {t('loanCheckout.documentHandover')}
          </button>
          {showHandover ? (
            <fieldset className="fieldset-card">
              <MediaUploadField
                mediaType="photo"
                vehicleId={vehicle || undefined}
                relatedType="workflow_draft"
                label={t('media.photoLabel')}
                accept="image/*"
                capture
                onUploaded={addMedia}
              />
              <SignatureInput
                vehicleId={vehicle || undefined}
                relatedType="workflow_draft"
                label={t('media.signatureLabel')}
                onUploaded={addMedia}
              />
              <p className="hint-text">{t('media.handoffNote')}</p>
            </fieldset>
          ) : null}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('workflows.submitting') : t('loanCheckout.submit')}
          </button>
        </form>
      ) : null}
    </section>
  );
}

