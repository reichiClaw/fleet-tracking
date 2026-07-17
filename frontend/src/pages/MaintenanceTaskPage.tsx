import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  completeVehicleMaintenance,
  resolveDamage,
  searchVehicles,
  sendVehicleToMaintenance,
  type WorkflowDraft,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { FormErrorSummary } from '../components/FormErrorSummary';
import { markMediaAttached, MediaUploadField } from '../components/MediaUploadField';
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
import { localDateTimeToIso } from '../utils/format';

type RecoveryAction = '' | 'resolve' | 'start' | 'complete';
type FieldErrors = Record<string, string>;

function nowLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function MaintenanceTaskPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const scopeRef = useRef(`maintenance-${Date.now()}-${Math.random()}`);
  const [step, setStep] = useState(0);
  const [vehicleId, setVehicleId] = useState(searchParams.get('vehicle') || '');
  const [vehicleOptions, setVehicleOptions] = useState<SearchableOption[]>([]);
  const [action, setAction] = useState<RecoveryAction>((searchParams.get('action') as RecoveryAction) || '');
  const [damageId, setDamageId] = useState(searchParams.get('damage') || '');
  const [performedAt, setPerformedAt] = useState(nowLocal);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [odometer, setOdometer] = useState('');
  const [hours, setHours] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ vehicleId: string; status: string } | null>(null);
  const vehicleState = useVehicleContext(vehicleId);
  const meterMode = vehicleState.context?.meter?.mode;

  useEffect(() => {
    if (!vehicleState.context) return;
    if (!odometer && vehicleState.context.meter.odometer_km != null) setOdometer(String(vehicleState.context.meter.odometer_km));
    if (!hours && vehicleState.context.meter.operating_hours != null) setHours(String(vehicleState.context.meter.operating_hours));
    if (damageId && !vehicleState.context.open_damages.some((item) => item.id === damageId)) setDamageId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleState.context]);

  const hydrate = useCallback((draft: WorkflowDraft) => {
    const data = draft.form_data;
    setStep(Math.max(0, Math.min(3, draft.step || 0)));
    setVehicleId(String(data.vehicle_id || ''));
    setAction((data.action as RecoveryAction) || '');
    setDamageId(String(data.damage_id || ''));
    setPerformedAt(String(data.performed_at || nowLocal()));
    setReason(String(data.reason || ''));
    setNotes(String(data.notes || ''));
    setOdometer(String(data.odometer ?? ''));
    setHours(String(data.hours ?? ''));
    setMediaIds(Array.isArray(data.media_ids) ? data.media_ids.map(String) : []);
  }, []);

  const formData = useMemo(() => ({
    vehicle_id: vehicleId,
    action,
    damage_id: damageId,
    performed_at: performedAt,
    reason,
    notes,
    odometer,
    hours,
    media_ids: mediaIds,
  }), [action, damageId, hours, mediaIds, notes, odometer, performedAt, reason, vehicleId]);

  const draft = useWorkflowDraft({
    workflowType: 'maintenance',
    scopeKey: scopeRef.current,
    objectId: vehicleId || null,
    formData,
    stagedMediaIds: mediaIds,
    step,
    enabled: !result,
    resumeId: searchParams.get('draft'),
    onHydrate: hydrate,
  });

  const loadVehicles = useCallback(async (query: string, signal: AbortSignal) => {
    const page = await searchVehicles(query, { active: true }, signal);
    return page.results.map((vehicle) => ({
      value: vehicle.id,
      label: vehicleSearchLabel(vehicle, t(`status.${vehicle.status}`)),
      keywords: [vehicle.license_plate, vehicle.serial_number, vehicle.current_location, vehicle.status].filter(Boolean).join(' '),
    }));
  }, [t]);

  function actionAllowed(candidate: RecoveryAction) {
    const context = vehicleState.context;
    if (!context) return false;
    if (candidate === 'start') return Boolean(context.capabilities.can_send_to_maintenance);
    if (candidate === 'complete') return Boolean(context.capabilities.can_complete_maintenance);
    if (candidate === 'resolve') return context.open_damages.length > 0;
    return false;
  }

  function validateStep(target: number) {
    const next: FieldErrors = {};
    if (target === 0) {
      if (!vehicleId) next.vehicle = t('workflows.validation.vehicleRequired');
      else if (!vehicleState.context) next.vehicle = t('vehicleContext.loadError');
    }
    if (target === 1) {
      if (!action || !actionAllowed(action)) next.action = t('maintenance.validation.actionRequired');
      if (action === 'resolve' && !damageId) next.damage = t('maintenance.validation.damageRequired');
      if (action === 'start' && !reason.trim()) next.reason = t('maintenance.validation.reasonRequired');
      const performed = localDateTimeToIso(performedAt);
      if (!performed || new Date(performed).getTime() > Date.now()) next.performedAt = t('workflows.validation.futureTimestamp');
    }
    if (target === 2 && action !== 'resolve') {
      if ((meterMode === 'odometer' || meterMode === 'both') && odometer === '') next.odometer = t('workflowRedesign.validation.odometerRequired');
      if ((meterMode === 'hours' || meterMode === 'both') && hours === '') next.hours = t('workflowRedesign.validation.hoursRequired');
      if (vehicleState.context?.meter.odometer_km != null && odometer && Number(odometer) < Number(vehicleState.context.meter.odometer_km)) {
        next.odometer = t('workflows.validation.odometerDecrease');
      }
      if (vehicleState.context?.meter.operating_hours != null && hours && Number(hours) < Number(vehicleState.context.meter.operating_hours)) {
        next.hours = t('workflows.validation.hoursDecrease');
      }
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  function nextStep() {
    if (validateStep(step)) setStep((current) => Math.min(3, current + 1));
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
      let status: string;
      if (action === 'resolve') {
        await resolveDamage(damageId, notes.trim());
        status = t('maintenance.serverDerivedStatus');
      } else {
        const payload = {
          performed_at: localDateTimeToIso(performedAt),
          notes: notes.trim(),
          media_file_ids: mediaIds,
          ...(action === 'start' ? { reason: reason.trim() } : {}),
          ...(meterMode === 'odometer' || meterMode === 'both' ? { odometer_km: Number(odometer) } : {}),
          ...(meterMode === 'hours' || meterMode === 'both' ? { operating_hours: hours } : {}),
        };
        const response = action === 'start'
          ? await sendVehicleToMaintenance(vehicleId, payload)
          : await completeVehicleMaintenance(vehicleId, payload);
        status = t(`status.${response.vehicle.status}`);
        markMediaAttached(mediaIds);
      }
      setResult({ vehicleId, status });
      await draft.completed();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, t, t('maintenance.submitError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (result) {
    return (
      <section className="page-stack">
        <PageHeader title={t('maintenance.completed')} eyebrow={t('tasks.eyebrow')} />
        <article className="content-card success-card" role="status" aria-live="polite">
          <h3 tabIndex={-1} autoFocus>{t('maintenance.completed')}</h3>
          <p>{t('maintenance.resultingStatus', { status: result.status })}</p>
          <Link className="button-link" to={`/app/vehicles/${result.vehicleId}`}>{t('workflowRedesign.openHistory')}</Link>
        </article>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <PageHeader title={t('maintenance.title')} eyebrow={t('tasks.eyebrow')} description={t('maintenance.description')} />
      {error ? <ErrorState message={error} /> : null}
      {draft.conflictingDraft ? <DraftConflictNotice onUseServer={draft.useServerVersion} onOverwrite={draft.overwriteServerVersion} /> : null}
      <form className="content-card form-stack" noValidate onSubmit={handleSubmit}>
        <FormErrorSummary errors={fieldErrors} />
        <WorkflowWizard
          currentStep={step}
          onBack={() => setStep((current) => Math.max(0, current - 1))}
          onNext={nextStep}
          onGoToStep={setStep}
          submitLabel={t(`maintenance.actions.${action || 'open'}`)}
          submitting={isSubmitting}
          saveStatus={draft.status}
          navigationDisabled={Boolean(vehicleId && (vehicleState.isLoading || vehicleState.error))}
          onRetrySave={draft.retry}
          consequence={t(`maintenance.consequences.${action || 'open'}`)}
        >
          {step === 0 ? (
            <SearchableSelect
              label={t('workflows.fields.vehicle')}
              value={vehicleId}
              options={vehicleOptions}
              onChange={setVehicleId}
              loadOptions={loadVehicles}
              loadingText={t('states.loading')}
              placeholder={t('workflows.placeholders.searchVehicle')}
              emptyText={t('workflows.placeholders.noVehicleMatches')}
              error={fieldErrors.vehicle}
              required
            />
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
                <legend>{t('maintenance.actionLegend')}</legend>
                <div className="condition-options">
                  {(['resolve', 'start', 'complete'] as RecoveryAction[]).map((candidate) => (
                    <label className="condition-option" key={candidate}>
                      <input
                        type="radio"
                        name="recovery-action"
                        checked={action === candidate}
                        disabled={!actionAllowed(candidate)}
                        onChange={() => setAction(candidate)}
                      />
                      <span>{t(`maintenance.actions.${candidate}`)}</span>
                    </label>
                  ))}
                </div>
                {fieldErrors.action ? <small className="field-error">{fieldErrors.action}</small> : null}
              </fieldset>
              {action === 'resolve' ? (
                <Field label={t('maintenance.damageLabel')} error={fieldErrors.damage} required>
                  <select value={damageId} onChange={(event) => setDamageId(event.target.value)}>
                    <option value="">{t('maintenance.selectDamage')}</option>
                    {(vehicleState.context?.open_damages || []).map((damage) => (
                      <option value={damage.id} key={damage.id}>{damage.description}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {action === 'start' ? (
                <Field label={t('maintenance.reason')} error={fieldErrors.reason} required>
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
                </Field>
              ) : null}
              <Field label={t('workflows.fields.performedAt')} error={fieldErrors.performedAt} required>
                <input type="datetime-local" value={performedAt} onChange={(event) => setPerformedAt(event.target.value)} />
              </Field>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <Field label={action === 'resolve' ? t('maintenance.resolutionNotes') : t('workflows.fields.notes')}>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </Field>
              {action !== 'resolve' ? (
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
                  <MediaUploadField
                    mediaType="photo"
                    label={t('media.generalPhotoLabel')}
                    accept="image/*"
                    capture
                    preserveOnUnmount
                    onUploaded={(media) => setMediaIds((current) => [...current, media.id])}
                    onRemoved={(media) => setMediaIds((current) => current.filter((id) => id !== media.id))}
                  />
                </>
              ) : (
                <p className="hint-text">{t('maintenance.resolveMediaLimitation')}</p>
              )}
            </>
          ) : null}
          {step === 3 ? (
            <section className="review-panel">
              <h4>{t('workflowRedesign.reviewTitle')}</h4>
              <dl className="detail-list">
                <div><dt>{t('workflows.fields.vehicle')}</dt><dd>{vehicleState.context?.vehicle.internal_number}</dd></div>
                <div><dt>{t('maintenance.actionLegend')}</dt><dd>{t(`maintenance.actions.${action}`)}</dd></div>
                <div><dt>{t('maintenance.result')}</dt><dd>{t(`maintenance.results.${action}`)}</dd></div>
              </dl>
            </section>
          ) : null}
        </WorkflowWizard>
      </form>
    </section>
  );
}
