import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  createLoanCheckout,
  displayDriverName,
  getCompany,
  getDriver,
  getReservation,
  getVehicle,
  mediaDownloadUrl,
  searchCompanies,
  searchDrivers,
  searchVehicles,
  type Company,
  type Driver,
  type MediaFile,
  type Reservation,
  type Vehicle,
  type WorkflowDraft,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { FormErrorSummary } from '../components/FormErrorSummary';
import {
  markMediaAttached,
  MediaUploadField,
  SignatureInput,
  type SignatureInputHandle,
} from '../components/MediaUploadField';
import { PageHeader } from '../components/PageHeader';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';
import {
  CurrentConditionPanel,
  VehicleContextBanner,
  VehicleContextGate,
  useVehicleContext,
  vehicleSearchLabel,
} from '../components/VehicleContextBanner';
import { DraftConflictNotice, WorkflowWizard } from '../components/WorkflowWizard';
import { useWorkflowDraft } from '../hooks/useWorkflowDraft';
import { formatDateTime, localDateTimeToIso, isValidPhone } from '../utils/format';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

type BorrowerType = 'driver' | 'company' | 'manual';
type ConditionChoice = '' | 'unchanged' | 'new_damage';
type FieldErrors = Record<string, string>;

function defaultReturnDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function randomScope() {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function dateTimeInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function LoanCheckoutPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const signatureRef = useRef<SignatureInputHandle>(null);
  const scopeRef = useRef(`loan-${randomScope()}`);
  const [step, setStep] = useState(0);
  const [vehicleId, setVehicleId] = useState(searchParams.get('vehicle') ?? '');
  const [reservationId, setReservationId] = useState(searchParams.get('reservation') ?? '');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [vehicleOptions, setVehicleOptions] = useState<SearchableOption[]>([]);
  const [driverOptions, setDriverOptions] = useState<SearchableOption[]>([]);
  const [companyOptions, setCompanyOptions] = useState<SearchableOption[]>([]);
  const [drivers, setDrivers] = useState<Record<string, Driver>>({});
  const [companies, setCompanies] = useState<Record<string, Company>>({});
  const [borrowerType, setBorrowerType] = useState<BorrowerType>('driver');
  const [driverId, setDriverId] = useState(searchParams.get('driver') ?? '');
  const [companyId, setCompanyId] = useState(searchParams.get('company') ?? '');
  const [borrowerName, setBorrowerName] = useState(searchParams.get('reserved') ?? '');
  const [borrowerPhone, setBorrowerPhone] = useState('');
  const [expectedReturnAt, setExpectedReturnAt] = useState(defaultReturnDate);
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [conditionChoice, setConditionChoice] = useState<ConditionChoice>('');
  const [notes, setNotes] = useState('');
  const [damageDescription, setDamageDescription] = useState('');
  const [damageSeverity, setDamageSeverity] = useState('minor');
  const [generalMediaIds, setGeneralMediaIds] = useState<string[]>([]);
  const [damageMediaIds, setDamageMediaIds] = useState<string[]>([]);
  const [signatureMediaIds, setSignatureMediaIds] = useState<string[]>([]);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ loanId: string; vehicleId: string; pdfId?: string | null; warnings: string[] } | null>(null);
  const vehicleState = useVehicleContext(vehicleId);
  const meterMode = vehicleState.context?.meter?.mode;
  const stagedMediaIds = useMemo(
    () => [...new Set([...generalMediaIds, ...damageMediaIds, ...signatureMediaIds])],
    [damageMediaIds, generalMediaIds, signatureMediaIds],
  );

  const hydrate = useCallback((draft: WorkflowDraft) => {
    const data = draft.form_data;
    setStep(Math.max(0, Math.min(3, draft.step || 0)));
    setVehicleId(String(data.vehicle_id || ''));
    setReservationId(String(data.reservation_id || ''));
    setBorrowerType((data.borrower_type as BorrowerType) || 'driver');
    setDriverId(String(data.driver_id || ''));
    setCompanyId(String(data.company_id || ''));
    setBorrowerName(String(data.borrower_name || ''));
    setBorrowerPhone(String(data.borrower_phone || ''));
    setExpectedReturnAt(String(data.expected_return_at || defaultReturnDate()));
    setOdometer(String(data.odometer ?? ''));
    setHours(String(data.hours ?? ''));
    setConditionChoice((data.condition_choice as ConditionChoice) || '');
    setNotes(String(data.notes || ''));
    setDamageDescription(String(data.damage_description || ''));
    setDamageSeverity(String(data.damage_severity || 'minor'));
    setGeneralMediaIds(Array.isArray(data.general_media_ids) ? data.general_media_ids.map(String) : []);
    setDamageMediaIds(Array.isArray(data.damage_media_ids) ? data.damage_media_ids.map(String) : []);
    setSignatureMediaIds(Array.isArray(data.signature_media_ids) ? data.signature_media_ids.map(String) : []);
  }, []);

  const draftFormData = useMemo(() => ({
    vehicle_id: vehicleId,
    reservation_id: reservationId,
    borrower_type: borrowerType,
    driver_id: driverId,
    company_id: companyId,
    borrower_name: borrowerName,
    borrower_phone: borrowerPhone,
    expected_return_at: expectedReturnAt,
    odometer,
    hours,
    condition_choice: conditionChoice,
    notes,
    damage_description: damageDescription,
    damage_severity: damageSeverity,
    general_media_ids: generalMediaIds,
    damage_media_ids: damageMediaIds,
    signature_media_ids: signatureMediaIds,
  }), [
    borrowerName,
    borrowerPhone,
    borrowerType,
    companyId,
    conditionChoice,
    damageDescription,
    damageMediaIds,
    damageSeverity,
    driverId,
    expectedReturnAt,
    generalMediaIds,
    hours,
    notes,
    odometer,
    reservationId,
    signatureMediaIds,
    vehicleId,
  ]);

  const draft = useWorkflowDraft({
    workflowType: 'loan_checkout',
    scopeKey: scopeRef.current,
    objectId: reservationId || vehicleId || null,
    formData: draftFormData,
    stagedMediaIds,
    step,
    enabled: !result,
    resumeId: searchParams.get('draft'),
    onHydrate: hydrate,
  });

  useDirtyFormWarning(!result && Boolean(vehicleId || driverId || companyId || borrowerName || stagedMediaIds.length), t('forms.unsaved'));

  useEffect(() => {
    if (!vehicleId) return;
    const controller = new AbortController();
    getVehicle(vehicleId, controller.signal)
      .then((vehicle) => setVehicleOptions([{
        value: vehicle.id,
        label: vehicleSearchLabel(vehicle, t(`status.${vehicle.status}`)),
      }]))
      .catch(() => undefined);
    return () => controller.abort();
  }, [t, vehicleId]);

  useEffect(() => {
    if (!vehicleState.context) return;
    if (!odometer && vehicleState.context.meter.odometer_km != null) {
      setOdometer(String(vehicleState.context.meter.odometer_km));
    }
    if (!hours && vehicleState.context.meter.operating_hours != null) {
      setHours(String(vehicleState.context.meter.operating_hours));
    }
    // Baselines only prefill untouched values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleState.context]);

  useEffect(() => {
    if (!reservationId) {
      setReservation(null);
      return;
    }
    const controller = new AbortController();
    getReservation(reservationId, controller.signal)
      .then(async (nextReservation) => {
        setReservation(nextReservation);
        setVehicleId(nextReservation.vehicle);
        setExpectedReturnAt(dateTimeInput(nextReservation.end_at));
        const party = nextReservation.snapshot?.party;
        setBorrowerName(party?.name || nextReservation.reserved_for || '');
        setBorrowerPhone(party?.phone || nextReservation.manual_phone || '');
        if (nextReservation.driver) {
          setBorrowerType('driver');
          setDriverId(nextReservation.driver);
          const driver = await getDriver(nextReservation.driver, controller.signal);
          setDrivers((current) => ({ ...current, [driver.id]: driver }));
          setDriverOptions([{ value: driver.id, label: `${displayDriverName(driver)} · ${driver.phone || ''}` }]);
        } else if (nextReservation.company) {
          setBorrowerType('company');
          setCompanyId(nextReservation.company);
          const company = await getCompany(nextReservation.company, controller.signal);
          setCompanies((current) => ({ ...current, [company.id]: company }));
          setCompanyOptions([{ value: company.id, label: `${company.name} · ${company.contact_name || ''} · ${company.phone || ''}` }]);
        } else {
          setBorrowerType('manual');
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(getApiErrorMessage(loadError, t, t('checkoutWorkflow.reservationError')));
      });
    return () => controller.abort();
  }, [reservationId, t]);

  const loadVehicles = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchVehicles(query, { is_available: true }, signal);
    return page.results.map((vehicle) => ({
      value: vehicle.id,
      label: vehicleSearchLabel(vehicle, t(`status.${vehicle.status}`)),
      keywords: [vehicle.license_plate, vehicle.serial_number, vehicle.current_location, vehicle.status].filter(Boolean).join(' '),
    }));
  }, [t]);

  const loadDrivers = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchDrivers(query, signal);
    const records: Record<string, Driver> = {};
    const options = page.results.filter((driver) => driver.is_active).map((driver) => {
      records[driver.id] = driver;
      return {
        value: driver.id,
        label: `${displayDriverName(driver)}${driver.phone ? ` · ${driver.phone}` : ''}`,
        keywords: [driver.phone, driver.email].filter(Boolean).join(' '),
      };
    });
    setDrivers((current) => ({ ...current, ...records }));
    setDriverOptions((current) => [...options, ...current.filter((item) => !options.some((next) => next.value === item.value))]);
    return options;
  }, []);

  const loadCompanies = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchCompanies(query, signal);
    const records: Record<string, Company> = {};
    const options = page.results
      .filter((company) => company.is_active && ['subcontractor', 'internal'].includes(company.company_type))
      .map((company) => {
        records[company.id] = company;
        return {
          value: company.id,
          label: `${company.name}${company.contact_name ? ` · ${company.contact_name}` : ''}${company.phone ? ` · ${company.phone}` : ''}`,
        };
      });
    setCompanies((current) => ({ ...current, ...records }));
    setCompanyOptions((current) => [...options, ...current.filter((item) => !options.some((next) => next.value === item.value))]);
    return options;
  }, []);

  function selectDriver(id: string) {
    setDriverId(id);
    const driver = drivers[id];
    if (driver) {
      setBorrowerName(displayDriverName(driver));
      setBorrowerPhone(driver.phone || '');
      setCompanyId(driver.company || '');
    }
  }

  function selectCompany(id: string) {
    setCompanyId(id);
    const company = companies[id];
    if (company) {
      setBorrowerName(company.contact_name || company.name);
      setBorrowerPhone(company.phone || '');
    }
  }

  function validateStep(target: number) {
    const next: FieldErrors = {};
    if (target === 0) {
      if (!vehicleId) next.vehicle = t('workflows.validation.vehicleRequired');
      else if (!vehicleState.context || vehicleState.context.vehicle.status !== 'available') {
        next.vehicle = t('workflows.validation.vehicleNotEligible');
      }
      if (reservationId && reservation?.status !== 'active') {
        next.vehicle = t('checkoutWorkflow.validation.reservationInactive');
      }
    }
    if (target === 1) {
      if (borrowerType === 'driver' && !driverId) next.party = t('loanCheckout.validation.driverRequired');
      if (borrowerType === 'company' && !companyId) next.party = t('loanCheckout.validation.companyRequired');
      if (!borrowerName.trim()) next.borrowerName = t('workflows.validation.borrowerRequired');
      if (!isValidPhone(borrowerPhone)) next.borrowerPhone = t('workflows.validation.phoneInvalid');
      if (!expectedReturnAt || !localDateTimeToIso(expectedReturnAt) || new Date(expectedReturnAt).getTime() <= Date.now()) {
        next.expectedReturnAt = t('workflows.validation.expectedReturnFuture');
      }
    }
    if (target === 2) {
      if ((meterMode === 'odometer' || meterMode === 'both') && odometer === '') {
        next.odometer = t('workflowRedesign.validation.odometerRequired');
      }
      if ((meterMode === 'hours' || meterMode === 'both') && hours === '') {
        next.hours = t('workflowRedesign.validation.hoursRequired');
      }
      if (vehicleState.context?.meter.odometer_km != null && odometer && Number(odometer) < Number(vehicleState.context.meter.odometer_km)) {
        next.odometer = t('workflows.validation.odometerDecrease');
      }
      if (vehicleState.context?.meter.operating_hours != null && hours && Number(hours) < Number(vehicleState.context.meter.operating_hours)) {
        next.hours = t('workflows.validation.hoursDecrease');
      }
      if (!conditionChoice) next.condition = t('checkoutWorkflow.validation.damageChoiceRequired');
      if (conditionChoice === 'new_damage' && !damageDescription.trim()) {
        next.damageDescription = t('workflows.validation.damageDescriptionRequired');
      }
      if (conditionChoice === 'new_damage' && !damageMediaIds.length) {
        next.damagePhoto = t('workflows.validation.damagePhotoRequired');
      }
      if (!signatureDrawn && !signatureMediaIds.length) {
        next.signature = t('workflows.validation.checkoutSignatureRequired');
      }
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function nextStep() {
    if (!validateStep(step)) return;
    if (step === 2 && signatureDrawn) {
      try {
        const drawn = await signatureRef.current?.commit();
        if (drawn) {
          setSignatureMediaIds((current) => current.includes(drawn.id) ? current : [...current, drawn.id]);
        }
      } catch (uploadError) {
        setError(getApiErrorMessage(uploadError, t, t('media.uploadError')));
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 3) {
      nextStep();
      return;
    }
    if (isSubmitting) return;
    for (const requiredStep of [0, 1, 2]) {
      if (!validateStep(requiredStep)) {
        setStep(requiredStep);
        return;
      }
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const drawn = await signatureRef.current?.commit();
      const mediaIds = [...new Set([...generalMediaIds, ...signatureMediaIds, ...(drawn ? [drawn.id] : [])])];
      const payload: Record<string, unknown> = {
        vehicle: vehicleId,
        borrower_name: borrowerName.trim(),
        borrower_phone: borrowerPhone.trim(),
        expected_return_at: localDateTimeToIso(expectedReturnAt),
        media_file_ids: mediaIds,
      };
      if (reservationId) payload.reservation_id = reservationId;
      if (borrowerType === 'driver') {
        payload.driver = driverId;
        if (companyId) payload.company = companyId;
      }
      if (borrowerType === 'company') payload.company = companyId;
      if (meterMode === 'odometer' || meterMode === 'both') payload.checkout_odometer_km = Number(odometer);
      if (meterMode === 'hours' || meterMode === 'both') payload.checkout_operating_hours = hours;
      if (notes.trim()) payload.checkout_notes = notes.trim();
      if (conditionChoice === 'new_damage') {
        payload.damage_reports = [{
          description: damageDescription.trim(),
          severity: damageSeverity,
          media_file_ids: damageMediaIds,
        }];
      }
      const loan = await createLoanCheckout(payload);
      markMediaAttached([...mediaIds, ...damageMediaIds]);
      setResult({
        loanId: loan.id,
        vehicleId,
        pdfId: loan.checkout_pdf_media,
        warnings: (loan.warnings || []).map((warning) => t(`checkoutWorkflow.warnings.${warning.code}`, {
          date: warning.start_at ? formatDateTime(warning.start_at, i18n.language) : '',
        })),
      });
      await draft.completed();
    } catch (submitError) {
      const message = getApiErrorMessage(submitError, t, t('workflows.submitError'));
      setError(submitError instanceof TypeError ? `${message} ${t('workflowRedesign.ambiguousFailure')}` : message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const reservationWarning = useMemo(() => {
    if (reservationId || !vehicleState.context || !expectedReturnAt) return null;
    const expected = new Date(expectedReturnAt).getTime();
    const conflict = vehicleState.context.reservations.find((item) => new Date(item.start_at).getTime() < expected);
    return conflict ? t('checkoutWorkflow.upcomingReservationWarning', {
      party: conflict.reserved_for,
      date: formatDateTime(conflict.start_at, i18n.language),
    }) : null;
  }, [expectedReturnAt, i18n.language, reservationId, t, vehicleState.context]);

  if (result) {
    return (
      <section className="page-stack">
        <PageHeader title={t('workflowRedesign.completed.loanCheckout')} eyebrow={t('workflows.eyebrow')} />
        <article className="content-card success-card" role="status" aria-live="polite">
          <h3 tabIndex={-1} autoFocus>{t('workflowRedesign.completed.loanCheckout')}</h3>
          {result.warnings.map((warning) => <p className="warning-panel" key={warning}>{warning}</p>)}
          <div className="action-row">
            {result.pdfId ? <a className="button-link" href={mediaDownloadUrl({ id: result.pdfId })}>{t('workflowRedesign.openReceipt')}</a> : null}
            <Link className="button-link secondary-button" to={`/app/vehicles/${result.vehicleId}`}>{t('workflowRedesign.openHistory')}</Link>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <PageHeader
        title={t('workflowRedesign.titles.loanCheckout')}
        eyebrow={t('workflows.eyebrow')}
        description={t('workflowRedesign.titles.loanCheckoutDescription')}
      />
      {error ? <ErrorState message={error} /> : null}
      {draft.conflictingDraft ? <DraftConflictNotice onUseServer={draft.useServerVersion} onOverwrite={draft.overwriteServerVersion} /> : null}
      <form className="content-card form-stack" noValidate onSubmit={handleSubmit}>
        <FormErrorSummary errors={fieldErrors} />
        <WorkflowWizard
          currentStep={step}
          onBack={() => setStep((current) => Math.max(0, current - 1))}
          onNext={nextStep}
          onGoToStep={setStep}
          submitLabel={t('workflowRedesign.titles.loanCheckout')}
          submitting={isSubmitting}
          saveStatus={draft.status}
          navigationDisabled={Boolean(vehicleId && (vehicleState.isLoading || vehicleState.error))}
          onRetrySave={draft.retry}
          consequence={t('workflowRedesign.consequences.loanCheckout')}
        >
          {step === 0 ? (
            <SearchableSelect
              label={t('workflows.fields.vehicle')}
              value={vehicleId}
              options={vehicleOptions}
              onChange={(value) => { setVehicleId(value); setReservationId(''); setReservation(null); }}
              loadOptions={loadVehicles}
              loadingText={t('states.loading')}
              placeholder={t('loanCheckout.searchVehicle')}
              emptyText={t('loanCheckout.noVehicles')}
              error={fieldErrors.vehicle}
              required
              disabled={Boolean(reservationId)}
            >
              {reservation ? <small className="success-text">{t('checkoutWorkflow.fromReservation')}</small> : null}
            </SearchableSelect>
          ) : null}

          {vehicleId ? (
            <VehicleContextGate state={vehicleState}>
              {vehicleState.context ? (
                <>
                  <VehicleContextBanner context={vehicleState.context} category={vehicleState.category} thumbnailUrl={vehicleState.thumbnailUrl} />
                  <CurrentConditionPanel context={vehicleState.context} media={vehicleState.media} />
                </>
              ) : null}
            </VehicleContextGate>
          ) : null}

          {step === 1 ? (
            <>
              <fieldset className="fieldset-card">
                <legend>{t('loanCheckout.borrowerType.label')}</legend>
                <div className="segmented">
                  {(['driver', 'company', 'manual'] as BorrowerType[]).map((type) => (
                    <button
                      type="button"
                      key={type}
                      aria-pressed={borrowerType === type}
                      className={`segmented__option${borrowerType === type ? ' is-active' : ''}`}
                      disabled={Boolean(reservationId)}
                      onClick={() => setBorrowerType(type)}
                    >
                      {t(`checkoutWorkflow.partyTypes.${type}`)}
                    </button>
                  ))}
                </div>
                {borrowerType === 'driver' ? (
                  <SearchableSelect
                    label={t('workflows.fields.driver')}
                    value={driverId}
                    options={driverOptions}
                    onChange={selectDriver}
                    loadOptions={loadDrivers}
                    loadingText={t('states.loading')}
                    placeholder={t('loanCheckout.searchDriver')}
                    emptyText={t('loanCheckout.noMatches')}
                    error={fieldErrors.party}
                    disabled={Boolean(reservationId)}
                  />
                ) : null}
                {borrowerType === 'company' ? (
                  <SearchableSelect
                    label={t('workflows.fields.company')}
                    value={companyId}
                    options={companyOptions}
                    onChange={selectCompany}
                    loadOptions={loadCompanies}
                    loadingText={t('states.loading')}
                    placeholder={t('loanCheckout.searchCompany')}
                    emptyText={t('loanCheckout.noMatches')}
                    error={fieldErrors.party}
                    disabled={Boolean(reservationId)}
                  />
                ) : null}
                <Field label={t('workflows.fields.borrowerName')} error={fieldErrors.borrowerName} required>
                  <input value={borrowerName} disabled={Boolean(reservationId)} onChange={(event) => setBorrowerName(event.target.value)} />
                </Field>
                <Field label={t('workflows.fields.borrowerPhone')} error={fieldErrors.borrowerPhone} required>
                  <input type="tel" value={borrowerPhone} onChange={(event) => setBorrowerPhone(event.target.value)} />
                </Field>
              </fieldset>
              <Field label={t('workflows.fields.expectedReturn')} error={fieldErrors.expectedReturnAt} required>
                <input type="datetime-local" value={expectedReturnAt} onChange={(event) => setExpectedReturnAt(event.target.value)} />
              </Field>
              {reservationWarning ? <p className="warning-panel" role="alert">{reservationWarning}</p> : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="form-grid form-grid--two">
                {meterMode === 'odometer' || meterMode === 'both' ? (
                  <Field label={t('workflows.fields.checkoutOdometer')} error={fieldErrors.odometer} required>
                    <input min="0" type="number" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
                  </Field>
                ) : null}
                {meterMode === 'hours' || meterMode === 'both' ? (
                  <Field label={t('workflows.fields.checkoutHours')} error={fieldErrors.hours} required>
                    <input min="0" step="0.1" type="number" value={hours} onChange={(event) => setHours(event.target.value)} />
                  </Field>
                ) : null}
              </div>
              <fieldset className="fieldset-card">
                <legend>{t('checkoutWorkflow.damageChoice')}</legend>
                <div className="condition-options">
                  {(['unchanged', 'new_damage'] as ConditionChoice[]).map((choice) => (
                    <label className="condition-option" key={choice}>
                      <input
                        type="radio"
                        name="checkout-condition"
                        checked={conditionChoice === choice}
                        onChange={() => setConditionChoice(choice)}
                      />
                      <span>{t(`checkoutWorkflow.condition.${choice}`)}</span>
                    </label>
                  ))}
                </div>
                {fieldErrors.condition ? <small className="field-error">{fieldErrors.condition}</small> : null}
                {conditionChoice === 'new_damage' ? (
                  <>
                    <Field label={t('workflows.damage.description')} error={fieldErrors.damageDescription} required>
                      <textarea value={damageDescription} onChange={(event) => setDamageDescription(event.target.value)} />
                    </Field>
                    <Field label={t('workflows.damage.severity')}>
                      <select value={damageSeverity} onChange={(event) => setDamageSeverity(event.target.value)}>
                        {['unknown', 'minor', 'major', 'critical'].map((severity) => (
                          <option value={severity} key={severity}>{t(`severity.${severity}`)}</option>
                        ))}
                      </select>
                    </Field>
                    <MediaUploadField
                      mediaType="photo"
                      label={t('workflows.damage.photoLabel')}
                      accept="image/*"
                      capture
                      preserveOnUnmount
                      required
                      validationError={fieldErrors.damagePhoto}
                      onUploaded={(media) => setDamageMediaIds((current) => [...current, media.id])}
                      onRemoved={(media) => setDamageMediaIds((current) => current.filter((id) => id !== media.id))}
                    />
                  </>
                ) : null}
              </fieldset>
              <Field label={t('workflows.fields.notes')}>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <MediaUploadField
                mediaType="photo"
                label={t('media.generalPhotoLabel')}
                accept="image/*"
                capture
                preserveOnUnmount
                onUploaded={(media) => setGeneralMediaIds((current) => [...current, media.id])}
                onRemoved={(media) => setGeneralMediaIds((current) => current.filter((id) => id !== media.id))}
              />
              <SignatureInput
                ref={signatureRef}
                label={t('media.signatureLabel')}
                preserveOnUnmount
                required
                validationError={fieldErrors.signature}
                onDrawnChange={setSignatureDrawn}
                onUploaded={(media: MediaFile) => setSignatureMediaIds((current) => [...current, media.id])}
                onRemoved={(media) => setSignatureMediaIds((current) => current.filter((id) => id !== media.id))}
              />
            </>
          ) : null}

          {step === 3 ? (
            <section className="review-panel">
              <h4>{t('workflowRedesign.reviewTitle')}</h4>
              <dl className="detail-list detail-list--wide">
                <div><dt>{t('workflows.fields.vehicle')}</dt><dd>{vehicleState.context?.vehicle.internal_number}</dd></div>
                <div><dt>{t('workflows.fields.borrowerName')}</dt><dd>{borrowerName}</dd></div>
                <div><dt>{t('workflows.fields.borrowerPhone')}</dt><dd>{borrowerPhone}</dd></div>
                <div><dt>{t('workflows.fields.expectedReturn')}</dt><dd>{formatDateTime(localDateTimeToIso(expectedReturnAt), i18n.language)}</dd></div>
                <div><dt>{t('checkoutWorkflow.damageChoice')}</dt><dd>{t(`checkoutWorkflow.condition.${conditionChoice}`)}</dd></div>
                <div><dt>{t('workflowRedesign.evidenceCount')}</dt><dd>{stagedMediaIds.length}</dd></div>
              </dl>
            </section>
          ) : null}
        </WorkflowWizard>
      </form>
    </section>
  );
}
