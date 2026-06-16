import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { Field } from '../components/Field';

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
import { MediaUploadField, SignatureInput } from '../components/MediaUploadField';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';

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

  const [result, setResult] = useState<{ id: string; detail: string } | null>(null);
  const [generatedPdf, setGeneratedPdf] = useState<MediaFile | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Quick-add driver inline so a loan is not blocked by a missing driver record.
  const [isAddingDriver, setIsAddingDriver] = useState(false);
  const [newDriverFirstName, setNewDriverFirstName] = useState('');
  const [newDriverLastName, setNewDriverLastName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [isSavingDriver, setIsSavingDriver] = useState(false);
  const [quickDriverError, setQuickDriverError] = useState<string | null>(null);

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
          setVehicles(nextVehicles);
          setDrivers(nextDrivers.filter((item) => item.is_active));
          setCompanies(nextCompanies.filter((item) => item.is_active));
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
          <SearchableSelect
            label={t('workflows.fields.vehicle')}
            options={vehicleOptions}
            value={vehicle}
            onChange={setVehicle}
            placeholder={t('loanCheckout.searchVehicle')}
            emptyText={t('loanCheckout.noMatches')}
            error={fieldErrors.vehicle}
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

          <fieldset className="fieldset-card">
            <legend>{t('loanCheckout.moreDetails')}</legend>
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

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('workflows.submitting') : t('loanCheckout.submit')}
          </button>
        </form>
      ) : null}
    </section>
  );
}

