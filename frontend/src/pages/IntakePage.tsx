import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  createAndCheckIn,
  listVehicleCategories,
  searchCompanies,
  type Company,
  type ConditionOutcome,
  type MediaFile,
  type VehicleCategory,
  type WorkflowDraft,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { FormErrorSummary } from '../components/FormErrorSummary';
import { markMediaAttached, MediaUploadField, SignatureInput, type SignatureInputHandle } from '../components/MediaUploadField';
import { PageHeader } from '../components/PageHeader';
import { ProtocolReceipt } from '../components/ProtocolReceipt';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';
import { DraftConflictNotice, WorkflowWizard } from '../components/WorkflowWizard';
import { useWorkflowDraft } from '../hooks/useWorkflowDraft';
import { localDateTimeToIso } from '../utils/format';

type FieldErrors = Record<string, string>;

function nowLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function randomKey(prefix: string) {
  return typeof crypto?.randomUUID === 'function' ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}`;
}

export function IntakePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const signatureRef = useRef<SignatureInputHandle>(null);
  const scopeRef = useRef(randomKey('intake'));
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [companyOptions, setCompanyOptions] = useState<SearchableOption[]>([]);
  const [supportError, setSupportError] = useState<string | null>(null);
  const [supportLoading, setSupportLoading] = useState(true);
  const [supportReload, setSupportReload] = useState(0);
  const [step, setStep] = useState(0);
  const [categoryId, setCategoryId] = useState('');
  const [internalNumber, setInternalNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [location, setLocation] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [performedAt, setPerformedAt] = useState(nowLocal);
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [conditionOutcome, setConditionOutcome] = useState<ConditionOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [generalMediaIds, setGeneralMediaIds] = useState<string[]>([]);
  const [damageDescription, setDamageDescription] = useState('');
  const [damageSeverity, setDamageSeverity] = useState('minor');
  const [damageMediaIds, setDamageMediaIds] = useState<string[]>([]);
  const [signatureMediaIds, setSignatureMediaIds] = useState<string[]>([]);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    protocolId: string;
    vehicleId: string;
    label: string;
    pdfId?: string | null;
    pdfError?: string;
  } | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => randomKey('intake-submit'));
  const category = categories.find((item) => item.id === categoryId);
  const meterMode = category?.meter_mode || 'none';
  const stagedMediaIds = useMemo(
    () => [...new Set([...generalMediaIds, ...damageMediaIds, ...signatureMediaIds])],
    [damageMediaIds, generalMediaIds, signatureMediaIds],
  );

  useEffect(() => {
    let active = true;
    setSupportLoading(true);
    setSupportError(null);
    listVehicleCategories()
      .then((items) => {
        if (!active) return;
        const available = items.filter((item) => item.is_active);
        setCategories(available);
        if (available.length === 1) setCategoryId(available[0].id);
      })
      .catch((loadError) => active && setSupportError(getApiErrorMessage(loadError, t, t('intake.loadError'))))
      .finally(() => active && setSupportLoading(false));
    return () => { active = false; };
  }, [supportReload, t]);

  const hydrate = useCallback((draft: WorkflowDraft) => {
    const data = draft.form_data;
    setStep(Math.max(0, Math.min(3, draft.step || 0)));
    setCategoryId(String(data.category_id || ''));
    setInternalNumber(String(data.internal_number || ''));
    setManufacturer(String(data.manufacturer || ''));
    setModel(String(data.model || ''));
    setSerialNumber(String(data.serial_number || ''));
    setLicensePlate(String(data.license_plate || ''));
    setLocation(String(data.location || ''));
    setSupplierId(String(data.supplier_id || ''));
    setPerformedAt(String(data.performed_at || nowLocal()));
    setOdometer(String(data.odometer ?? ''));
    setHours(String(data.hours ?? ''));
    setConditionOutcome((data.condition_outcome as ConditionOutcome) || '');
    setNotes(String(data.notes || ''));
    setGeneralMediaIds(Array.isArray(data.general_media_ids) ? data.general_media_ids.map(String) : []);
    setDamageDescription(String(data.damage_description || ''));
    setDamageSeverity(String(data.damage_severity || 'minor'));
    setDamageMediaIds(Array.isArray(data.damage_media_ids) ? data.damage_media_ids.map(String) : []);
    setSignatureMediaIds(Array.isArray(data.signature_media_ids) ? data.signature_media_ids.map(String) : []);
    if (data.idempotency_key) setIdempotencyKey(String(data.idempotency_key));
  }, []);

  const formData = useMemo(() => ({
    intake: true,
    category_id: categoryId,
    internal_number: internalNumber,
    manufacturer,
    model,
    serial_number: serialNumber,
    license_plate: licensePlate,
    location,
    supplier_id: supplierId,
    performed_at: performedAt,
    odometer,
    hours,
    condition_outcome: conditionOutcome,
    notes,
    general_media_ids: generalMediaIds,
    damage_description: damageDescription,
    damage_severity: damageSeverity,
    damage_media_ids: damageMediaIds,
    signature_media_ids: signatureMediaIds,
    idempotency_key: idempotencyKey,
  }), [
    categoryId,
    conditionOutcome,
    damageDescription,
    damageMediaIds,
    damageSeverity,
    generalMediaIds,
    hours,
    idempotencyKey,
    internalNumber,
    licensePlate,
    location,
    manufacturer,
    model,
    notes,
    odometer,
    performedAt,
    serialNumber,
    signatureMediaIds,
    supplierId,
  ]);

  const draft = useWorkflowDraft({
    workflowType: 'check_in',
    scopeKey: scopeRef.current,
    formData,
    stagedMediaIds,
    step,
    enabled: !result,
    resumeId: searchParams.get('draft'),
    onHydrate: hydrate,
    storageKey: 'intake',
  });

  const loadSuppliers = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchCompanies(query, signal);
    const options = page.results
      .filter((company: Company) => company.is_active && ['supplier', 'manufacturer'].includes(company.company_type))
      .map((company) => ({
        value: company.id,
        label: `${company.name}${company.contact_name ? ` · ${company.contact_name}` : ''}${company.phone ? ` · ${company.phone}` : ''}`,
      }));
    setCompanyOptions((current) => [...options, ...current.filter((item) => !options.some((next) => next.value === item.value))]);
    return options;
  }, []);

  function validateStep(target: number) {
    const next: FieldErrors = {};
    if (target === 0) {
      if (!categoryId) next.category = t('addVehicle.validation.categoryRequired');
      if (!manufacturer.trim()) next.manufacturer = t('addVehicle.validation.manufacturerRequired');
      if (!model.trim()) next.model = t('addVehicle.validation.modelRequired');
    }
    if (target === 1) {
      if (!supplierId) next.supplier = t('workflows.validation.supplierRequired');
      const performed = localDateTimeToIso(performedAt);
      if (!performed || new Date(performed).getTime() > Date.now()) next.performedAt = t('workflows.validation.futureTimestamp');
    }
    if (target === 2) {
      if ((meterMode === 'odometer' || meterMode === 'both') && odometer === '') {
        next.odometer = t('workflowRedesign.validation.odometerRequired');
      }
      if ((meterMode === 'hours' || meterMode === 'both') && hours === '') {
        next.hours = t('workflowRedesign.validation.hoursRequired');
      }
      if (!conditionOutcome) next.condition = t('workflowRedesign.validation.conditionRequired');
      if (!generalMediaIds.length) next.generalPhoto = t('workflows.validation.generalPhotoRequired');
      if (conditionOutcome === 'new_damage' && !damageDescription.trim()) next.damageDescription = t('workflows.validation.damageDescriptionRequired');
      if (conditionOutcome === 'new_damage' && !damageMediaIds.length) next.damagePhoto = t('workflows.validation.damagePhotoRequired');
      if (conditionOutcome === 'maintenance' && !notes.trim()) next.notes = t('workflowRedesign.validation.maintenanceReasonRequired');
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
      const protocol = await createAndCheckIn({
        category: categoryId,
        manufacturer: manufacturer.trim(),
        model: model.trim(),
        ...(internalNumber.trim() ? { internal_number: internalNumber.trim() } : {}),
        ...(serialNumber.trim() ? { serial_number: serialNumber.trim() } : {}),
        ...(licensePlate.trim() ? { license_plate: licensePlate.trim() } : {}),
        ...(location.trim() ? { current_location: location.trim() } : {}),
        supplier_company: supplierId,
        performed_at: localDateTimeToIso(performedAt),
        condition_outcome: conditionOutcome,
        condition_notes: notes.trim(),
        ...(meterMode === 'odometer' || meterMode === 'both' ? { odometer_km: Number(odometer) } : {}),
        ...(meterMode === 'hours' || meterMode === 'both' ? { operating_hours: hours } : {}),
        media_file_ids: mediaIds,
        ...(conditionOutcome === 'new_damage' ? {
          damage_reports: [{
            description: damageDescription.trim(),
            severity: damageSeverity,
            media_file_ids: damageMediaIds,
          }],
        } : {}),
      }, idempotencyKey);
      markMediaAttached([...mediaIds, ...damageMediaIds]);
      setResult({
        protocolId: protocol.id,
        vehicleId: protocol.vehicle,
        label: [internalNumber, manufacturer, model].filter(Boolean).join(' · '),
        pdfId: protocol.pdf_media,
        pdfError: protocol.pdf_generation_error,
      });
      await draft.completed();
    } catch (submitError) {
      const message = getApiErrorMessage(submitError, t, t('workflows.submitError'));
      setError(submitError instanceof TypeError ? `${message} ${t('workflowRedesign.ambiguousFailure')}` : message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (supportLoading) return <p role="status">{t('states.loading')}</p>;
  if (supportError) {
    return <ErrorState message={supportError} onRetry={() => setSupportReload((value) => value + 1)} />;
  }
  if (result) {
    return (
      <section className="page-stack">
        <PageHeader title={t('intake.completed')} eyebrow={t('workflows.eyebrow')} />
        <article className="content-card success-card" role="status" aria-live="polite">
          <h3 tabIndex={-1} autoFocus>{t('intake.completed')}</h3>
          <p>{result.label}</p>
          <ProtocolReceipt
            mediaId={result.pdfId}
            error={result.pdfError}
            documentType="check_in_protocol_pdf"
            recordId={result.protocolId}
          />
          <div className="action-row">
            <Link className="button-link secondary-button" to={`/app/vehicles/${result.vehicleId}`}>{t('workflowRedesign.openHistory')}</Link>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <PageHeader title={t('intake.title')} eyebrow={t('workflows.eyebrow')} description={t('intake.description')} />
      {error ? <ErrorState message={error} /> : null}
      {draft.conflictingDraft ? <DraftConflictNotice onUseServer={draft.useServerVersion} onOverwrite={draft.overwriteServerVersion} /> : null}
      <form className="content-card form-stack" noValidate onSubmit={handleSubmit}>
        <FormErrorSummary errors={fieldErrors} />
        <WorkflowWizard
          currentStep={step}
          onBack={() => setStep((current) => Math.max(0, current - 1))}
          onNext={nextStep}
          onGoToStep={setStep}
          submitLabel={t('intake.title')}
          submitting={isSubmitting}
          saveStatus={draft.status}
          onRetrySave={draft.retry}
          consequence={t('intake.consequence')}
        >
          {step === 0 ? (
            <>
              <Field label={t('addVehicle.fields.category')} error={fieldErrors.category} required>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
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
            </>
          ) : null}
          {step === 1 ? (
            <>
              <SearchableSelect
                label={t('workflows.fields.supplierCompany')}
                value={supplierId}
                options={companyOptions}
                onChange={setSupplierId}
                loadOptions={loadSuppliers}
                loadingText={t('states.loading')}
                placeholder={t('workflows.placeholders.selectCompany')}
                emptyText={t('loanCheckout.noMatches')}
                error={fieldErrors.supplier}
                required
              />
              <Field label={t('workflows.fields.performedAt')} error={fieldErrors.performedAt} required>
                <input type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} />
              </Field>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <div className="form-grid form-grid--two">
                {meterMode === 'odometer' || meterMode === 'both' ? (
                  <Field label={t('workflows.fields.odometer')} error={fieldErrors.odometer} required>
                    <input type="number" min="0" value={odometer} onChange={(event) => setOdometer(event.target.value)} />
                  </Field>
                ) : null}
                {meterMode === 'hours' || meterMode === 'both' ? (
                  <Field label={t('workflows.fields.hours')} error={fieldErrors.hours} required>
                    <input type="number" min="0" step="0.1" value={hours} onChange={(event) => setHours(event.target.value)} />
                  </Field>
                ) : null}
              </div>
              <fieldset className="fieldset-card">
                <legend>{t('workflowRedesign.conditionLegend')}</legend>
                <div className="condition-options">
                  {(['fit', 'new_damage', 'maintenance'] as ConditionOutcome[]).map((outcome) => (
                    <label className="condition-option" key={outcome}>
                      <input type="radio" name="intake-condition" checked={conditionOutcome === outcome} onChange={() => setConditionOutcome(outcome)} />
                      <span>{t(`workflowRedesign.outcomes.${outcome}`)}</span>
                    </label>
                  ))}
                </div>
                {fieldErrors.condition ? <small className="field-error">{fieldErrors.condition}</small> : null}
              </fieldset>
              <Field label={t('workflows.fields.notes')} error={fieldErrors.notes}>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              <MediaUploadField
                mediaType="photo"
                label={t('media.generalPhotoLabel')}
                accept="image/*"
                capture
                preserveOnUnmount
                required
                validationError={fieldErrors.generalPhoto}
                onUploaded={(media) => setGeneralMediaIds((current) => [...current, media.id])}
                onRemoved={(media) => setGeneralMediaIds((current) => current.filter((id) => id !== media.id))}
              />
              {conditionOutcome === 'new_damage' ? (
                <fieldset className="fieldset-card">
                  <legend>{t('workflows.damage.title')}</legend>
                  <Field label={t('workflows.damage.description')} error={fieldErrors.damageDescription} required>
                    <textarea value={damageDescription} onChange={(event) => setDamageDescription(event.target.value)} />
                  </Field>
                  <Field label={t('workflows.damage.severity')}>
                    <select value={damageSeverity} onChange={(event) => setDamageSeverity(event.target.value)}>
                      {['unknown', 'minor', 'major', 'critical'].map((severity) => <option value={severity} key={severity}>{t(`severity.${severity}`)}</option>)}
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
              <SignatureInput
                ref={signatureRef}
                label={t('media.optionalSignatureLabel')}
                preserveOnUnmount
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
                <div><dt>{t('addVehicle.fields.category')}</dt><dd>{category?.name}</dd></div>
                <div><dt>{t('addVehicle.fields.manufacturer')}</dt><dd>{manufacturer}</dd></div>
                <div><dt>{t('addVehicle.fields.model')}</dt><dd>{model}</dd></div>
                <div><dt>{t('workflows.fields.supplierCompany')}</dt><dd>{companyOptions.find((item) => item.value === supplierId)?.label || supplierId}</dd></div>
                <div><dt>{t('workflowRedesign.conditionLegend')}</dt><dd>{conditionOutcome ? t(`workflowRedesign.outcomes.${conditionOutcome}`) : ''}</dd></div>
                <div><dt>{t('workflowRedesign.evidenceCount')}</dt><dd>{stagedMediaIds.length}</dd></div>
              </dl>
            </section>
          ) : null}
        </WorkflowWizard>
      </form>
    </section>
  );
}
