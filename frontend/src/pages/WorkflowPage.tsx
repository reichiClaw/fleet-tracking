import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  createCheckIn,
  createManufacturerCheckout,
  getLoanReturnContext,
  getVehicle,
  mediaDownloadUrl,
  returnLoan,
  searchCompanies,
  searchLoans,
  searchVehicles,
  type Company,
  type ConditionOutcome,
  type LoanReturnContext,
  type MediaFile,
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
import { ProtocolReceipt } from '../components/ProtocolReceipt';
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
import { formatDateOnly, formatDateTime, formatNumber, localDateTimeToIso } from '../utils/format';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

export type WorkflowKind = 'check-in' | 'loan-return' | 'manufacturer-checkout';
type FieldErrors = Record<string, string>;
type ManufacturerCondition = '' | 'fit' | 'new_damage';

type WorkflowResult = {
  title: string;
  detail: string;
  vehicleId: string;
  recordId: string;
  documentType: string;
  receiptId?: string | null;
  pdfError?: string;
};

function nowLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function randomKey(prefix: string) {
  return typeof crypto?.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function WorkflowPage({ kind }: { kind: WorkflowKind }) {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const signatureRef = useRef<SignatureInputHandle>(null);
  const draftScopeRef = useRef(randomKey(kind));
  const [step, setStep] = useState(0);
  const [vehicleId, setVehicleId] = useState(kind === 'loan-return' ? '' : searchParams.get('vehicle') ?? '');
  const [loanId, setLoanId] = useState(kind === 'loan-return' ? searchParams.get('loan') ?? '' : '');
  const [selectedVehicleOptions, setSelectedVehicleOptions] = useState<SearchableOption[]>([]);
  const [selectedLoanOptions, setSelectedLoanOptions] = useState<SearchableOption[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [companyOptions, setCompanyOptions] = useState<SearchableOption[]>([]);
  const [performedAt, setPerformedAt] = useState(nowLocal);
  const [actualReturnAt, setActualReturnAt] = useState(nowLocal);
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [conditionOutcome, setConditionOutcome] = useState<ConditionOutcome | ''>('');
  const [manufacturerCondition, setManufacturerCondition] = useState<ManufacturerCondition>('');
  const [notes, setNotes] = useState('');
  const [damageDescription, setDamageDescription] = useState('');
  const [damageSeverity, setDamageSeverity] = useState('minor');
  const [generalMediaIds, setGeneralMediaIds] = useState<string[]>([]);
  const [damageMediaIds, setDamageMediaIds] = useState<string[]>([]);
  const [signatureMediaIds, setSignatureMediaIds] = useState<string[]>([]);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [returnContext, setReturnContext] = useState<LoanReturnContext | null>(null);
  const [returnContextLoading, setReturnContextLoading] = useState(false);
  const [returnContextError, setReturnContextError] = useState<string | null>(null);
  const [returnContextReload, setReturnContextReload] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => randomKey('check-in'));

  const selectedVehicleId = kind === 'loan-return' ? returnContext?.vehicle.id ?? '' : vehicleId;
  const vehicleState = useVehicleContext(selectedVehicleId);
  const meterMode = kind === 'loan-return'
    ? returnContext?.vehicle.meter_mode
    : vehicleState.context?.meter?.mode;
  const workflowType = kind === 'check-in'
    ? 'check_in'
    : kind === 'loan-return'
      ? 'loan_return'
      : 'manufacturer_return';
  const allStagedMediaIds = useMemo(
    () => [...new Set([...generalMediaIds, ...damageMediaIds, ...signatureMediaIds])],
    [damageMediaIds, generalMediaIds, signatureMediaIds],
  );

  const hydrateDraft = useCallback((draft: WorkflowDraft) => {
    const data = draft.form_data;
    setStep(Math.max(0, Math.min(3, draft.step || 0)));
    setVehicleId(String(data.vehicle_id || ''));
    setLoanId(String(data.loan_id || ''));
    setCompanyId(String(data.company_id || ''));
    setPerformedAt(String(data.performed_at || nowLocal()));
    setActualReturnAt(String(data.actual_return_at || nowLocal()));
    setOdometer(String(data.odometer ?? ''));
    setHours(String(data.hours ?? ''));
    setConditionOutcome((data.condition_outcome as ConditionOutcome) || '');
    setManufacturerCondition((data.manufacturer_condition as ManufacturerCondition) || '');
    setNotes(String(data.notes || ''));
    setDamageDescription(String(data.damage_description || ''));
    setDamageSeverity(String(data.damage_severity || 'minor'));
    setGeneralMediaIds(Array.isArray(data.general_media_ids) ? data.general_media_ids.map(String) : []);
    setDamageMediaIds(Array.isArray(data.damage_media_ids) ? data.damage_media_ids.map(String) : []);
    setSignatureMediaIds(Array.isArray(data.signature_media_ids) ? data.signature_media_ids.map(String) : []);
    if (data.idempotency_key) setIdempotencyKey(String(data.idempotency_key));
  }, []);

  const draftFormData = useMemo(() => ({
    vehicle_id: vehicleId,
    loan_id: loanId,
    company_id: companyId,
    performed_at: performedAt,
    actual_return_at: actualReturnAt,
    odometer,
    hours,
    condition_outcome: conditionOutcome,
    manufacturer_condition: manufacturerCondition,
    notes,
    damage_description: damageDescription,
    damage_severity: damageSeverity,
    general_media_ids: generalMediaIds,
    damage_media_ids: damageMediaIds,
    signature_media_ids: signatureMediaIds,
    idempotency_key: idempotencyKey,
  }), [
    actualReturnAt,
    companyId,
    conditionOutcome,
    damageDescription,
    damageMediaIds,
    damageSeverity,
    generalMediaIds,
    hours,
    idempotencyKey,
    loanId,
    manufacturerCondition,
    notes,
    odometer,
    performedAt,
    signatureMediaIds,
    vehicleId,
  ]);

  const draft = useWorkflowDraft({
    workflowType,
    scopeKey: draftScopeRef.current,
    objectId: loanId || vehicleId || null,
    formData: draftFormData,
    stagedMediaIds: allStagedMediaIds,
    step,
    enabled: !result,
    resumeId: searchParams.get('draft'),
    onHydrate: hydrateDraft,
  });

  useDirtyFormWarning(!result && Boolean(vehicleId || loanId || companyId || notes || allStagedMediaIds.length), t('forms.unsaved'));

  useEffect(() => {
    const preset = kind === 'loan-return' ? loanId : vehicleId;
    if (!preset) return;
    const controller = new AbortController();
    if (kind === 'loan-return') {
      setReturnContextLoading(true);
      setReturnContextError(null);
      getLoanReturnContext(preset, controller.signal)
        .then((context) => {
          setReturnContext(context);
          setSelectedLoanOptions([{
            value: preset,
            label: `${context.vehicle.internal_number} · ${context.borrower.name} · ${t(`status.${context.status}`)}`,
          }]);
          if (!odometer && context.vehicle.current_odometer_km != null) setOdometer(String(context.vehicle.current_odometer_km));
          if (!hours && context.vehicle.current_operating_hours != null) setHours(String(context.vehicle.current_operating_hours));
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setReturnContext(null);
            setReturnContextError(getApiErrorMessage(error, t, t('returnWorkflow.contextError')));
          }
        })
        .finally(() => setReturnContextLoading(false));
    } else {
      getVehicle(preset, controller.signal)
        .then((vehicle) => setSelectedVehicleOptions([{
          value: vehicle.id,
          label: vehicleSearchLabel(vehicle, t(`status.${vehicle.status}`)),
        }]))
        .catch(() => undefined);
    }
    return () => controller.abort();
    // Meter values are deliberately not dependencies: a context load only prefills untouched inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, loanId, returnContextReload, t, vehicleId]);

  useEffect(() => {
    const context = vehicleState.context;
    if (!context || kind === 'loan-return') return;
    if (!odometer && context.meter.odometer_km != null) setOdometer(String(context.meter.odometer_km));
    if (!hours && context.meter.operating_hours != null) setHours(String(context.meter.operating_hours));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, vehicleState.context]);

  const loadVehicles = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchVehicles(
      query,
      kind === 'check-in' ? { status: 'announced' } : { active: true },
      signal,
    );
    return page.results.map((vehicle) => ({
      value: vehicle.id,
      label: vehicleSearchLabel(vehicle, t(`status.${vehicle.status}`)),
      keywords: [vehicle.license_plate, vehicle.serial_number, vehicle.current_location, vehicle.status].filter(Boolean).join(' '),
    }));
  }, [kind, t]);

  const loadLoans = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchLoans(query, { status: 'active' }, signal);
    return page.results.map((loan) => ({
      value: loan.id,
      label: `${loan.borrower_name || t('common.unknown')} · ${loan.borrower_phone || ''} · ${loan.vehicle}`,
    }));
  }, [t]);

  const loadCompanies = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchCompanies(query, signal);
    const allowed = new Set<Company['company_type']>(['supplier', 'manufacturer']);
    const options = page.results
      .filter((company) => company.is_active && allowed.has(company.company_type))
      .map((company) => ({
        value: company.id,
        label: `${company.name}${company.contact_name ? ` · ${company.contact_name}` : ''}${company.phone ? ` · ${company.phone}` : ''}`,
      }));
    setCompanyOptions((current) => [...options, ...current.filter((item) => !options.some((next) => next.value === item.value))]);
    return options;
  }, []);

  function validateMeter(next: FieldErrors) {
    if ((meterMode === 'odometer' || meterMode === 'both') && odometer === '') {
      next.odometer = t('workflowRedesign.validation.odometerRequired');
    }
    if ((meterMode === 'hours' || meterMode === 'both') && hours === '') {
      next.hours = t('workflowRedesign.validation.hoursRequired');
    }
    const baselineOdometer = kind === 'loan-return'
      ? returnContext?.vehicle.current_odometer_km
      : vehicleState.context?.meter.odometer_km;
    const baselineHours = kind === 'loan-return'
      ? returnContext?.vehicle.current_operating_hours
      : vehicleState.context?.meter.operating_hours;
    if (baselineOdometer != null && odometer && Number(odometer) < Number(baselineOdometer)) {
      next.odometer = t('workflows.validation.odometerDecrease');
    }
    if (baselineHours != null && hours && Number(hours) < Number(baselineHours)) {
      next.hours = t('workflows.validation.hoursDecrease');
    }
  }

  function validateStep(targetStep: number) {
    const next: FieldErrors = {};
    if (targetStep === 0) {
      if (kind === 'loan-return') {
        if (!loanId) next.loan = t('workflows.validation.loanRequired');
        else if (!returnContext || returnContext.status !== 'active') next.loan = t('workflows.validation.loanNotEligible');
      } else {
        if (!vehicleId) next.vehicle = t('workflows.validation.vehicleRequired');
        else if (!vehicleState.context) next.vehicle = t('vehicleContext.loadError');
        else if (kind === 'check-in' && vehicleState.context.vehicle.status !== 'announced') {
          next.vehicle = t('workflows.validation.vehicleNotEligible');
        } else if (
          kind === 'manufacturer-checkout'
          && (!['available', 'damaged'].includes(vehicleState.context.vehicle.status)
            || vehicleState.context.active_loan
            || vehicleState.context.active_maintenance)
        ) {
          next.vehicle = t('workflows.validation.vehicleNotEligible');
        }
      }
    }
    if (targetStep === 1) {
      if (kind !== 'loan-return' && !companyId) {
        next.company = t(kind === 'check-in' ? 'workflows.validation.supplierRequired' : 'workflows.validation.recipientRequired');
      }
      const timestamp = kind === 'loan-return' ? actualReturnAt : performedAt;
      const parsed = localDateTimeToIso(timestamp);
      if (!parsed || new Date(parsed).getTime() > Date.now()) {
        next.timestamp = t('workflows.validation.futureTimestamp');
      }
    }
    if (targetStep === 2) {
      validateMeter(next);
      if (kind === 'manufacturer-checkout') {
        if (!manufacturerCondition) next.condition = t('workflowRedesign.validation.conditionRequired');
      } else if (!conditionOutcome) {
        next.condition = t('workflowRedesign.validation.conditionRequired');
      }
      const newDamage = kind === 'manufacturer-checkout'
        ? manufacturerCondition === 'new_damage'
        : conditionOutcome === 'new_damage';
      if (newDamage && !damageDescription.trim()) {
        next.damageDescription = t('workflows.validation.damageDescriptionRequired');
      }
      if (newDamage && damageMediaIds.length === 0) {
        next.damagePhoto = t('workflows.validation.damagePhotoRequired');
      }
      if (conditionOutcome === 'maintenance' && !notes.trim()) {
        next.notes = t('workflowRedesign.validation.maintenanceReasonRequired');
      }
      if (kind === 'check-in' && generalMediaIds.length === 0) {
        next.generalPhoto = t('workflows.validation.generalPhotoRequired');
      }
      if (kind === 'loan-return' && returnContext?.signature_required && !signatureDrawn && signatureMediaIds.length === 0) {
        next.signature = t('workflows.validation.signatureRequired');
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
        setSubmitError(getApiErrorMessage(uploadError, t, t('media.uploadError')));
        return;
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  function damageReports() {
    const newDamage = kind === 'manufacturer-checkout'
      ? manufacturerCondition === 'new_damage'
      : conditionOutcome === 'new_damage';
    return newDamage
      ? [{ description: damageDescription.trim(), severity: damageSeverity, media_file_ids: damageMediaIds }]
      : undefined;
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
    setSubmitError(null);
    try {
      const drawn = await signatureRef.current?.commit();
      const mediaIds = [...new Set([...generalMediaIds, ...signatureMediaIds, ...(drawn ? [drawn.id] : [])])];
      let nextResult: WorkflowResult;
      if (kind === 'check-in') {
        const protocol = await createCheckIn({
          vehicle: vehicleId,
          supplier_company: companyId,
          performed_at: localDateTimeToIso(performedAt),
          condition_outcome: conditionOutcome,
          condition_notes: notes.trim(),
          ...(meterMode === 'odometer' || meterMode === 'both' ? { odometer_km: Number(odometer) } : {}),
          ...(meterMode === 'hours' || meterMode === 'both' ? { operating_hours: hours } : {}),
          media_file_ids: mediaIds,
          ...(damageReports() ? { damage_reports: damageReports() } : {}),
        }, idempotencyKey);
        nextResult = {
          title: t('workflowRedesign.completed.checkIn'),
          detail: vehicleState.context?.vehicle.internal_number || vehicleId,
          vehicleId,
          recordId: protocol.id,
          documentType: 'check_in_protocol_pdf',
          receiptId: protocol.pdf_media,
          pdfError: protocol.pdf_generation_error,
        };
      } else if (kind === 'loan-return') {
        const loan = await returnLoan(loanId, {
          actual_return_at: localDateTimeToIso(actualReturnAt),
          condition_outcome: conditionOutcome,
          return_notes: notes.trim(),
          ...(meterMode === 'odometer' || meterMode === 'both' ? { return_odometer_km: Number(odometer) } : {}),
          ...(meterMode === 'hours' || meterMode === 'both' ? { return_operating_hours: hours } : {}),
          media_file_ids: mediaIds,
          ...(damageReports() ? { damage_reports: damageReports() } : {}),
        });
        nextResult = {
          title: t('workflowRedesign.completed.loanReturn'),
          detail: t('returnWorkflow.result', { status: t('status.returned') }),
          vehicleId: returnContext!.vehicle.id,
          recordId: loan.id,
          documentType: 'loan_return_pdf',
          receiptId: loan.return_pdf_media,
          pdfError: loan.return_pdf_generation_error,
        };
      } else {
        const protocol = await createManufacturerCheckout({
          vehicle: vehicleId,
          recipient_company: companyId,
          performed_at: localDateTimeToIso(performedAt),
          condition_notes: notes.trim(),
          ...(meterMode === 'odometer' || meterMode === 'both' ? { odometer_km: Number(odometer) } : {}),
          ...(meterMode === 'hours' || meterMode === 'both' ? { operating_hours: hours } : {}),
          media_file_ids: mediaIds,
          ...(damageReports() ? { damage_reports: damageReports() } : {}),
        });
        nextResult = {
          title: t('workflowRedesign.completed.manufacturerReturn'),
          detail: vehicleState.context?.vehicle.internal_number || vehicleId,
          vehicleId,
          recordId: protocol.id,
          documentType: 'manufacturer_checkout_protocol_pdf',
          receiptId: protocol.pdf_media,
          pdfError: protocol.pdf_generation_error,
        };
      }
      markMediaAttached([...mediaIds, ...damageMediaIds]);
      setResult(nextResult);
      await draft.completed();
    } catch (error) {
      const base = getApiErrorMessage(error, t, t('workflows.submitError'));
      setSubmitError(error instanceof TypeError ? `${base} ${t('workflowRedesign.ambiguousFailure')}` : base);
    } finally {
      setIsSubmitting(false);
    }
  }

  const titleKey = kind === 'check-in'
    ? 'workflowRedesign.titles.checkIn'
    : kind === 'loan-return'
      ? 'workflowRedesign.titles.loanReturn'
      : 'workflowRedesign.titles.manufacturerReturn';
  const condition = kind === 'manufacturer-checkout' ? manufacturerCondition : conditionOutcome;
  const usageOdometer = kind === 'loan-return' && returnContext?.checkout.odometer_km != null && odometer
    ? Number(odometer) - Number(returnContext.checkout.odometer_km)
    : null;
  const usageHours = kind === 'loan-return' && returnContext?.checkout.operating_hours != null && hours
    ? Number(hours) - Number(returnContext.checkout.operating_hours)
    : null;
  const checkoutPerformedAt = typeof returnContext?.checkout.snapshot?.performed_at === 'string'
    ? returnContext.checkout.snapshot.performed_at
    : null;

  if (result) {
    return (
      <section className="page-stack">
        <PageHeader title={result.title} eyebrow={t('workflows.eyebrow')} />
        <article className="content-card success-card" role="status" aria-live="polite">
          <h3 tabIndex={-1} autoFocus>{result.title}</h3>
          <p>{result.detail}</p>
          <ProtocolReceipt
            mediaId={result.receiptId}
            error={result.pdfError}
            documentType={result.documentType}
            recordId={result.recordId}
          />
          <div className="action-row">
            <Link className="button-link secondary-button" to={`/app/vehicles/${result.vehicleId}`}>
              {t('workflowRedesign.openHistory')}
            </Link>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <PageHeader title={t(titleKey)} eyebrow={t('workflows.eyebrow')} description={t(`${titleKey}Description`)} />
      {submitError ? <ErrorState message={submitError} /> : null}
      {returnContextError ? (
        <ErrorState
          message={returnContextError}
          onRetry={() => setReturnContextReload((value) => value + 1)}
        />
      ) : null}
      {draft.conflictingDraft ? (
        <DraftConflictNotice onUseServer={draft.useServerVersion} onOverwrite={draft.overwriteServerVersion} />
      ) : null}
      <form className="content-card form-stack" noValidate onSubmit={handleSubmit}>
        <FormErrorSummary errors={fieldErrors} />
        <WorkflowWizard
          currentStep={step}
          onBack={() => setStep((current) => Math.max(0, current - 1))}
          onNext={nextStep}
          onGoToStep={setStep}
          submitLabel={t(titleKey)}
          submitting={isSubmitting}
          saveStatus={draft.status}
          navigationDisabled={Boolean(
            (selectedVehicleId && (vehicleState.isLoading || vehicleState.error))
            || (kind === 'loan-return' && loanId && (returnContextLoading || returnContextError)),
          )}
          onRetrySave={draft.retry}
          consequence={t(`workflowRedesign.consequences.${kind === 'manufacturer-checkout' ? 'manufacturerReturn' : kind === 'loan-return' ? 'loanReturn' : 'checkIn'}`)}
        >
          {step === 0 ? (
            kind === 'loan-return' ? (
              <SearchableSelect
                label={t('workflows.fields.loan')}
                value={loanId}
                options={selectedLoanOptions}
                onChange={(value) => { setLoanId(value); setReturnContext(null); }}
                loadOptions={loadLoans}
                loadingText={t('states.loading')}
                placeholder={t('returnWorkflow.searchLoan')}
                emptyText={t('workflows.loanReturn.noActiveLoans')}
                error={fieldErrors.loan}
                required
              />
            ) : (
              <SearchableSelect
                label={t('workflows.fields.vehicle')}
                value={vehicleId}
                options={selectedVehicleOptions}
                onChange={setVehicleId}
                loadOptions={loadVehicles}
                loadingText={t('states.loading')}
                placeholder={t('workflows.placeholders.searchVehicle')}
                emptyText={t('workflows.placeholders.noVehicleMatches')}
                error={fieldErrors.vehicle}
                required
              />
            )
          ) : null}

          {returnContextLoading ? <p role="status">{t('states.loading')}</p> : null}
          {selectedVehicleId ? (
            <VehicleContextGate state={vehicleState}>
              {vehicleState.context ? (
                <>
                  <VehicleContextBanner
                    context={vehicleState.context}
                    category={vehicleState.category}
                    thumbnailUrl={vehicleState.thumbnailUrl}
                  />
                  <CurrentConditionPanel context={vehicleState.context} media={vehicleState.media} />
                  {kind === 'manufacturer-checkout' && vehicleState.context.vehicle.manufacturer_return_due ? (
                    <p className="warning-panel">
                      {t('workflowRedesign.manufacturerWarnings.due', {
                        date: formatDateOnly(
                          vehicleState.context.vehicle.manufacturer_return_due,
                          i18n.language,
                          t('common.notAvailable'),
                        ),
                      })}
                    </p>
                  ) : null}
                  {kind === 'manufacturer-checkout' && vehicleState.context.reservations.length ? (
                    <p className="warning-panel">
                      {t('workflowRedesign.manufacturerWarnings.reservations', {
                        count: vehicleState.context.reservations.length,
                      })}
                    </p>
                  ) : null}
                </>
              ) : null}
            </VehicleContextGate>
          ) : null}

          {step === 1 ? (
            <>
              {kind === 'loan-return' && returnContext ? (
                <section className="comparison-panel">
                  <h4>{t('returnWorkflow.checkoutContext')}</h4>
                  <dl className="detail-list">
                    <div><dt>{t('workflows.fields.borrowerName')}</dt><dd>{returnContext.borrower.name}</dd></div>
                    <div><dt>{t('workflows.fields.company')}</dt><dd>{returnContext.borrower.company_name || t('common.notAvailable')}</dd></div>
                    <div><dt>{t('workflows.fields.borrowerPhone')}</dt><dd>{returnContext.borrower.phone}</dd></div>
                    <div><dt>{t('workflows.fields.expectedReturn')}</dt><dd>{formatDateTime(returnContext.expected_return_at, i18n.language)}</dd></div>
                    <div>
                      <dt>{t('returnWorkflow.checkoutTime')}</dt>
                      <dd>{formatDateTime(checkoutPerformedAt, i18n.language, t('common.notAvailable'))}</dd>
                    </div>
                    <div><dt>{t('workflows.fields.checkoutOdometer')}</dt><dd>{formatNumber(returnContext.checkout.odometer_km, i18n.language, t('common.notAvailable'))}</dd></div>
                    <div><dt>{t('workflows.fields.checkoutHours')}</dt><dd>{formatNumber(returnContext.checkout.operating_hours, i18n.language, t('common.notAvailable'))}</dd></div>
                  </dl>
                  {returnContext.checkout.media.length ? (
                    <ul className="evidence-links">
                      {returnContext.checkout.media.map((media) => (
                        <li key={media.id}><a href={mediaDownloadUrl(media)}>{t(`media.types.${media.media_type}`)} · {media.original_filename}</a></li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}
              {kind !== 'loan-return' ? (
                <SearchableSelect
                  label={t(kind === 'check-in' ? 'workflows.fields.supplierCompany' : 'workflows.fields.recipientCompany')}
                  value={companyId}
                  options={companyOptions}
                  onChange={setCompanyId}
                  loadOptions={loadCompanies}
                  loadingText={t('states.loading')}
                  placeholder={t('workflows.placeholders.selectCompany')}
                  emptyText={t('loanCheckout.noMatches')}
                  error={fieldErrors.company}
                  required
                />
              ) : null}
              <Field
                label={t(kind === 'loan-return' ? 'workflows.fields.actualReturn' : 'workflows.fields.performedAt')}
                error={fieldErrors.timestamp}
                required
              >
                <input
                  type="datetime-local"
                  value={kind === 'loan-return' ? actualReturnAt : performedAt}
                  onChange={(event) => kind === 'loan-return' ? setActualReturnAt(event.target.value) : setPerformedAt(event.target.value)}
                />
              </Field>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="form-grid form-grid--two">
                {meterMode === 'odometer' || meterMode === 'both' ? (
                  <Field label={t(kind === 'loan-return' ? 'workflows.fields.returnOdometer' : 'workflows.fields.odometer')} error={fieldErrors.odometer} required>
                    <input min="0" type="number" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
                  </Field>
                ) : null}
                {meterMode === 'hours' || meterMode === 'both' ? (
                  <Field label={t(kind === 'loan-return' ? 'workflows.fields.returnHours' : 'workflows.fields.hours')} error={fieldErrors.hours} required>
                    <input min="0" step="0.1" type="number" value={hours} onChange={(event) => setHours(event.target.value)} />
                  </Field>
                ) : null}
              </div>
              {kind === 'loan-return' && (usageOdometer != null || usageHours != null) ? (
                <p className="usage-delta" aria-live="polite">
                  {t('returnWorkflow.usageDelta', {
                    odometer: usageOdometer == null ? '—' : formatNumber(usageOdometer, i18n.language),
                    hours: usageHours == null ? '—' : formatNumber(usageHours, i18n.language),
                  })}
                </p>
              ) : null}
              <fieldset className="fieldset-card">
                <legend>{t('workflowRedesign.conditionLegend')}</legend>
                <div className="condition-options">
                  {(kind === 'manufacturer-checkout'
                    ? (['fit', 'new_damage'] as ManufacturerCondition[])
                    : (['fit', 'new_damage', 'maintenance'] as ConditionOutcome[])
                  ).map((outcome) => (
                    <label key={outcome} className="condition-option">
                      <input
                        type="radio"
                        name="condition-outcome"
                        value={outcome}
                        checked={condition === outcome}
                        onChange={() => kind === 'manufacturer-checkout'
                          ? setManufacturerCondition(outcome as ManufacturerCondition)
                          : setConditionOutcome(outcome as ConditionOutcome)}
                      />
                      <span>{t(`workflowRedesign.outcomes.${outcome}`)}</span>
                    </label>
                  ))}
                </div>
                {fieldErrors.condition ? <small className="field-error">{fieldErrors.condition}</small> : null}
              </fieldset>
              <Field label={t('workflows.fields.notes')} error={fieldErrors.notes}>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              {condition === 'new_damage' ? (
                <fieldset className="fieldset-card">
                  <legend>{t('workflows.damage.title')}</legend>
                  <Field label={t('workflows.damage.description')} error={fieldErrors.damageDescription} required>
                    <textarea value={damageDescription} onChange={(event) => setDamageDescription(event.target.value)} />
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
                    preserveOnUnmount
                    required
                    validationError={fieldErrors.damagePhoto}
                    onUploaded={(media) => setDamageMediaIds((current) => [...current, media.id])}
                    onRemoved={(media) => setDamageMediaIds((current) => current.filter((id) => id !== media.id))}
                  />
                </fieldset>
              ) : null}
              <MediaUploadField
                mediaType="photo"
                label={t('media.generalPhotoLabel')}
                accept="image/*"
                capture
                preserveOnUnmount
                required={kind === 'check-in'}
                validationError={fieldErrors.generalPhoto}
                onUploaded={(media) => setGeneralMediaIds((current) => [...current, media.id])}
                onRemoved={(media) => setGeneralMediaIds((current) => current.filter((id) => id !== media.id))}
              />
              <SignatureInput
                ref={signatureRef}
                label={returnContext?.signature_required ? t('media.signatureLabel') : t('media.optionalSignatureLabel')}
                preserveOnUnmount
                required={Boolean(returnContext?.signature_required)}
                validationError={fieldErrors.signature}
                onDrawnChange={setSignatureDrawn}
                onUploaded={(media) => setSignatureMediaIds((current) => [...current, media.id])}
                onRemoved={(media) => setSignatureMediaIds((current) => current.filter((id) => id !== media.id))}
              />
            </>
          ) : null}

          {step === 3 ? (
            <section className="review-panel">
              <h4>{t('workflowRedesign.reviewTitle')}</h4>
              <dl className="detail-list detail-list--wide">
                <div><dt>{t('workflows.fields.vehicle')}</dt><dd>{vehicleState.context?.vehicle.internal_number || returnContext?.vehicle.internal_number}</dd></div>
                {kind !== 'loan-return' ? <div><dt>{t('workflows.fields.company')}</dt><dd>{companyOptions.find((item) => item.value === companyId)?.label || companyId}</dd></div> : null}
                <div><dt>{t('workflowRedesign.conditionLegend')}</dt><dd>{condition ? t(`workflowRedesign.outcomes.${condition}`) : ''}</dd></div>
                {meterMode === 'odometer' || meterMode === 'both' ? <div><dt>{t('workflows.fields.odometer')}</dt><dd>{odometer}</dd></div> : null}
                {meterMode === 'hours' || meterMode === 'both' ? <div><dt>{t('workflows.fields.hours')}</dt><dd>{hours}</dd></div> : null}
                <div><dt>{t('workflowRedesign.evidenceCount')}</dt><dd>{allStagedMediaIds.length}</dd></div>
              </dl>
            </section>
          ) : null}
        </WorkflowWizard>
      </form>
    </section>
  );
}
