import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  cancelReservation,
  createReservation,
  displayDriverName,
  listReservationPage,
  markReservationNoShow,
  searchCompanies,
  searchDrivers,
  searchVehicles,
  updateReservation,
  type Company,
  type Driver,
  type PageResult,
  type Reservation,
  type WorkflowDraft,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { ErrorState } from '../components/ErrorState';
import { Field } from '../components/Field';
import { FormErrorSummary } from '../components/FormErrorSummary';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
import { SearchableSelect, type SearchableOption } from '../components/SearchableSelect';
import { StatusBadge } from '../components/StatusBadge';
import {
  CurrentConditionPanel,
  VehicleContextBanner,
  VehicleContextGate,
  useVehicleContext,
  vehicleSearchLabel,
} from '../components/VehicleContextBanner';
import { DraftConflictNotice, WorkflowWizard } from '../components/WorkflowWizard';
import { useWorkflowDraft } from '../hooks/useWorkflowDraft';
import { formatDateTime, localDateTimeToIso } from '../utils/format';

type PartyMode = 'driver' | 'company' | 'manual';
type FieldErrors = Record<string, string>;

function localInput(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (!value) date.setDate(date.getDate() + 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function defaultEnd() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(17, 0, 0, 0);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function ReservationsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const scopeRef = useRef(`reservation-${Date.now()}-${Math.random()}`);
  const [step, setStep] = useState(0);
  const [vehicleId, setVehicleId] = useState(searchParams.get('vehicle') || '');
  const [vehicleOptions, setVehicleOptions] = useState<SearchableOption[]>([]);
  const [partyMode, setPartyMode] = useState<PartyMode>('driver');
  const [driverId, setDriverId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [manualName, setManualName] = useState('');
  const [phone, setPhone] = useState('');
  const [drivers, setDrivers] = useState<Record<string, Driver>>({});
  const [companies, setCompanies] = useState<Record<string, Company>>({});
  const [driverOptions, setDriverOptions] = useState<SearchableOption[]>([]);
  const [companyOptions, setCompanyOptions] = useState<SearchableOption[]>([]);
  const [startAt, setStartAt] = useState(localInput);
  const [endAt, setEndAt] = useState(defaultEnd);
  const [notes, setNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [created, setCreated] = useState<Reservation | null>(null);
  const [reservationPage, setReservationPage] = useState<PageResult<Reservation> | null>(null);
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const vehicleState = useVehicleContext(vehicleId);

  const hydrate = useCallback((draft: WorkflowDraft) => {
    const data = draft.form_data;
    setStep(Math.max(0, Math.min(3, draft.step || 0)));
    setVehicleId(String(data.vehicle_id || ''));
    setPartyMode((data.party_mode as PartyMode) || 'driver');
    setDriverId(String(data.driver_id || ''));
    setCompanyId(String(data.company_id || ''));
    setManualName(String(data.manual_name || ''));
    setPhone(String(data.phone || ''));
    setStartAt(String(data.start_at || localInput()));
    setEndAt(String(data.end_at || defaultEnd()));
    setNotes(String(data.notes || ''));
  }, []);

  const formData = useMemo(() => ({
    vehicle_id: vehicleId,
    party_mode: partyMode,
    driver_id: driverId,
    company_id: companyId,
    manual_name: manualName,
    phone,
    start_at: startAt,
    end_at: endAt,
    notes,
  }), [companyId, driverId, endAt, manualName, notes, partyMode, phone, startAt, vehicleId]);

  const draft = useWorkflowDraft({
    workflowType: 'reservation',
    scopeKey: scopeRef.current,
    objectId: vehicleId || null,
    formData,
    stagedMediaIds: [],
    step,
    enabled: !created,
    resumeId: searchParams.get('draft'),
    onHydrate: hydrate,
  });

  useEffect(() => {
    if (!vehicleId) {
      setReservationPage(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    listReservationPage({ vehicle: vehicleId }, page, controller.signal)
      .then((next) => active && setReservationPage(next))
      .catch((loadError) => {
        if (active && !controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, t, t('reservations.saveError')));
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [page, reloadToken, t, vehicleId]);

  const loadVehicles = useCallback(async (query: string, signal: AbortSignal) => {
    const response = await searchVehicles(query, { active: true }, signal);
    const options = response.results.map((vehicle) => ({
      value: vehicle.id,
      label: vehicleSearchLabel(vehicle, t(`status.${vehicle.status}`)),
      keywords: [vehicle.license_plate, vehicle.serial_number, vehicle.current_location, vehicle.status].filter(Boolean).join(' '),
    }));
    setVehicleOptions((current) => [...options, ...current.filter((item) => !options.some((next) => next.value === item.value))]);
    return options;
  }, [t]);

  const loadDrivers = useCallback(async (query: string, signal: AbortSignal) => {
    const response = await searchDrivers(query, signal);
    const records: Record<string, Driver> = {};
    const options = response.results.filter((driver) => driver.is_active).map((driver) => {
      records[driver.id] = driver;
      return { value: driver.id, label: `${displayDriverName(driver)} · ${driver.phone || ''}` };
    });
    setDrivers((current) => ({ ...current, ...records }));
    setDriverOptions((current) => [...options, ...current.filter((item) => !options.some((next) => next.value === item.value))]);
    return options;
  }, []);

  const loadCompanies = useCallback(async (query: string, signal: AbortSignal) => {
    const response = await searchCompanies(query, signal);
    const records: Record<string, Company> = {};
    const options = response.results.filter((company) => company.is_active && company.contact_name).map((company) => {
      records[company.id] = company;
      return { value: company.id, label: `${company.name} · ${company.contact_name} · ${company.phone || ''}` };
    });
    setCompanies((current) => ({ ...current, ...records }));
    setCompanyOptions((current) => [...options, ...current.filter((item) => !options.some((next) => next.value === item.value))]);
    return options;
  }, []);

  const overlap = useMemo(() => {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return vehicleState.context?.reservations.find((item) => (
      new Date(item.start_at).getTime() < end && new Date(item.end_at).getTime() > start
    )) || null;
  }, [endAt, startAt, vehicleState.context?.reservations]);

  function selectDriver(id: string) {
    setDriverId(id);
    const driver = drivers[id];
    if (driver) {
      setPhone(driver.phone || '');
      setCompanyId(driver.company || '');
    }
  }

  function selectCompany(id: string) {
    setCompanyId(id);
    const company = companies[id];
    if (company) {
      setManualName(company.contact_name || '');
      setPhone(company.phone || '');
    }
  }

  function validateStep(target: number) {
    const next: FieldErrors = {};
    if (target === 0) {
      if (!vehicleId) next.vehicle = t('workflows.validation.vehicleRequired');
      else if (!vehicleState.context?.capabilities.can_reserve) next.vehicle = t('workflows.validation.vehicleNotEligible');
    }
    if (target === 1) {
      if (partyMode === 'driver' && !driverId) next.party = t('loanCheckout.validation.driverRequired');
      if (partyMode === 'company' && !companyId) next.party = t('loanCheckout.validation.companyRequired');
      if (partyMode === 'manual' && !manualName.trim()) next.party = t('reservations.validation.manualRequired');
      if (!phone.trim()) next.phone = t('workflows.validation.phoneRequired');
      const start = localDateTimeToIso(startAt);
      const end = localDateTimeToIso(endAt);
      if (!start || !end || new Date(end).getTime() <= new Date(start).getTime()) next.timing = t('reservations.validation.chronology');
      if (overlap) next.timing = t('reservations.validation.overlap');
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
    const payload: Record<string, unknown> = {
      vehicle: vehicleId,
      start_at: localDateTimeToIso(startAt),
      end_at: localDateTimeToIso(endAt),
      notes: notes.trim(),
    };
    if (partyMode === 'driver') payload.driver = driverId;
    if (partyMode === 'company') payload.company = companyId;
    if (partyMode === 'manual') {
      payload.reserved_for = manualName.trim();
      payload.manual_phone = phone.trim();
    }
    try {
      const next = await createReservation(payload);
      setCreated(next);
      setReloadToken((value) => value + 1);
      await draft.completed();
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, t, t('reservations.saveError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changeReservation(id: string, action: 'cancel' | 'noShow' | 'edit') {
    setPendingId(id);
    setError(null);
    try {
      if (action === 'cancel') await cancelReservation(id);
      if (action === 'noShow') await markReservationNoShow(id);
      if (action === 'edit') {
        await updateReservation(id, {
          start_at: localDateTimeToIso(editStart),
          end_at: localDateTimeToIso(editEnd),
          notes: editNotes,
        });
        setEditingId(null);
      }
      setReloadToken((value) => value + 1);
    } catch (actionError) {
      setError(getApiErrorMessage(actionError, t, t('reservations.saveError')));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader title={t('reservationWizard.title')} eyebrow={t('workflows.eyebrow')} description={t('reservationWizard.description')} />
      {error ? <ErrorState message={error} /> : null}
      {created ? (
        <p className="success-text" role="status" aria-live="polite">{t('reservationWizard.created')}</p>
      ) : null}
      {draft.conflictingDraft ? <DraftConflictNotice onUseServer={draft.useServerVersion} onOverwrite={draft.overwriteServerVersion} /> : null}
      {!created ? (
        <form className="content-card form-stack" noValidate onSubmit={handleSubmit}>
          <FormErrorSummary errors={fieldErrors} />
          <WorkflowWizard
            currentStep={step}
            onBack={() => setStep((current) => Math.max(0, current - 1))}
            onNext={nextStep}
            onGoToStep={setStep}
            submitLabel={t('reservations.submit')}
            submitting={isSubmitting}
            saveStatus={draft.status}
            navigationDisabled={Boolean(vehicleId && (vehicleState.isLoading || vehicleState.error))}
            onRetrySave={draft.retry}
            consequence={t('reservationWizard.consequence')}
          >
            {step === 0 ? (
              <SearchableSelect
                label={t('workflows.fields.vehicle')}
                value={vehicleId}
                options={vehicleOptions}
                onChange={(id) => { setVehicleId(id); setPage(1); }}
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
                  <legend>{t('reservationWizard.partyLegend')}</legend>
                  <div className="segmented">
                    {(['driver', 'company', 'manual'] as PartyMode[]).map((mode) => (
                      <button type="button" key={mode} aria-pressed={partyMode === mode} className={`segmented__option${partyMode === mode ? ' is-active' : ''}`} onClick={() => setPartyMode(mode)}>
                        {t(`checkoutWorkflow.partyTypes.${mode}`)}
                      </button>
                    ))}
                  </div>
                  {partyMode === 'driver' ? (
                    <SearchableSelect label={t('workflows.fields.driver')} value={driverId} options={driverOptions} onChange={selectDriver} loadOptions={loadDrivers} loadingText={t('states.loading')} placeholder={t('loanCheckout.searchDriver')} emptyText={t('loanCheckout.noMatches')} error={fieldErrors.party} />
                  ) : null}
                  {partyMode === 'company' ? (
                    <SearchableSelect label={t('workflows.fields.company')} value={companyId} options={companyOptions} onChange={selectCompany} loadOptions={loadCompanies} loadingText={t('states.loading')} placeholder={t('loanCheckout.searchCompany')} emptyText={t('loanCheckout.noMatches')} error={fieldErrors.party} />
                  ) : null}
                  {partyMode === 'manual' ? (
                    <Field label={t('reservations.fields.reservedFor')} error={fieldErrors.party} required>
                      <input value={manualName} onChange={(event) => setManualName(event.target.value)} />
                    </Field>
                  ) : null}
                  <Field label={t('workflows.fields.borrowerPhone')} error={fieldErrors.phone} required>
                    <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
                  </Field>
                </fieldset>
                <div className="form-grid form-grid--two">
                  <Field label={t('reservations.fields.start')} error={fieldErrors.timing} required>
                    <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
                  </Field>
                  <Field label={t('reservations.fields.end')} required>
                    <input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
                  </Field>
                </div>
                <p className={overlap ? 'warning-panel' : 'success-text'} role="status" aria-live="polite">
                  {overlap ? t('reservationWizard.overlap', { party: overlap.reserved_for }) : t('reservationWizard.eligible')}
                </p>
              </>
            ) : null}
            {step === 2 ? (
              <>
                <Field label={t('reservations.fields.notes')}>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                </Field>
                <p className="hint-text">{t('reservationWizard.snapshotNotice')}</p>
              </>
            ) : null}
            {step === 3 ? (
              <section className="review-panel">
                <h4>{t('workflowRedesign.reviewTitle')}</h4>
                <dl className="detail-list">
                  <div><dt>{t('workflows.fields.vehicle')}</dt><dd>{vehicleState.context?.vehicle.internal_number}</dd></div>
                  <div><dt>{t('reservations.fields.reservedFor')}</dt><dd>{partyMode === 'driver' ? displayDriverName(drivers[driverId]) : partyMode === 'company' ? companies[companyId]?.contact_name : manualName}</dd></div>
                  <div><dt>{t('reservations.fields.start')}</dt><dd>{formatDateTime(localDateTimeToIso(startAt), i18n.language)}</dd></div>
                  <div><dt>{t('reservations.fields.end')}</dt><dd>{formatDateTime(localDateTimeToIso(endAt), i18n.language)}</dd></div>
                </dl>
              </section>
            ) : null}
          </WorkflowWizard>
        </form>
      ) : (
        <button type="button" onClick={() => { setCreated(null); setStep(0); }}>{t('reservationWizard.createAnother')}</button>
      )}

      {reservationPage ? (
        <section className="content-card">
          <h3>{t('reservationWizard.historyTitle')}</h3>
          {reservationPage.results.length ? (
            <ul className="list-stack list-stack--actions">
              {reservationPage.results.map((item) => (
                <li key={item.id}>
                  {editingId === item.id ? (
                    <div className="form-stack reservation-edit">
                      <div className="form-grid form-grid--two">
                        <Field label={t('reservations.fields.start')}><input type="datetime-local" value={editStart} onChange={(event) => setEditStart(event.target.value)} /></Field>
                        <Field label={t('reservations.fields.end')}><input type="datetime-local" value={editEnd} onChange={(event) => setEditEnd(event.target.value)} /></Field>
                      </div>
                      <Field label={t('reservations.fields.notes')}><textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} /></Field>
                      <button type="button" disabled={pendingId === item.id} onClick={() => void changeReservation(item.id, 'edit')}>{t('common.save')}</button>
                    </div>
                  ) : (
                    <>
                      <div>
                        <strong>{item.reserved_for || t('reservations.untitled')}</strong>
                        <small>{formatDateTime(item.start_at, i18n.language)} – {formatDateTime(item.end_at, i18n.language)}</small>
                      </div>
                      <StatusBadge status={item.status} />
                      {item.status === 'active' ? (
                        <div className="action-row">
                          <Link className="button-link" to={`/app/workflows/loan-checkout?vehicle=${item.vehicle}&reservation=${item.id}`}>{t('tasks.actions.loan')}</Link>
                          <button type="button" className="secondary-button" onClick={() => {
                            setEditingId(item.id);
                            setEditStart(localInput(item.start_at));
                            setEditEnd(localInput(item.end_at));
                            setEditNotes(item.notes || '');
                          }}>{t('common.edit')}</button>
                          {new Date(item.start_at).getTime() <= Date.now() ? <button type="button" className="warning-button" disabled={pendingId === item.id} onClick={() => void changeReservation(item.id, 'noShow')}>{t('reservationWizard.noShow')}</button> : null}
                          <button type="button" className="danger-button" disabled={pendingId === item.id} onClick={() => void changeReservation(item.id, 'cancel')}>{t('reservations.cancel')}</button>
                        </div>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="hint-text">{t('reservations.empty')}</p>}
          {reservationPage.count > 0 ? <PaginationControls page={reservationPage} onPageChange={setPage} /> : null}
        </section>
      ) : null}
    </section>
  );
}
