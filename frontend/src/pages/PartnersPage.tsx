import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  createCompany,
  createDriver,
  deactivateCompany,
  deactivateDriver,
  displayDriverName,
  listCompanyPage,
  listCompanyDuplicates,
  listDriverPage,
  listDriverDuplicates,
  mergeCompany,
  mergeDriver,
  searchCompanies,
  updateCompany,
  updateDriver,
  type Company,
  type CompanyType,
  type Driver,
  type MergePreview,
  type PageResult,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';
import { PaginationControls } from '../components/PaginationControls';
import { SearchableSelect } from '../components/SearchableSelect';
import { useDirtyFormWarning } from '../utils/useDirtyFormWarning';

const COMPANY_TYPES: CompanyType[] = ['subcontractor', 'manufacturer', 'supplier', 'internal'];

type Reload = () => Promise<void> | void;

export function PartnersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCreate = user?.role === 'admin' || user?.role === 'operations';
  const canEdit = canCreate;
  const canDeactivate = user?.role === 'admin';

  const [companies, setCompanies] = useState<Company[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [companyResult, setCompanyResult] = useState<PageResult<Company> | null>(null);
  const [driverResult, setDriverResult] = useState<PageResult<Driver> | null>(null);
  const [companyPage, setCompanyPage] = useState(1);
  const [driverPage, setDriverPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'companies' | 'drivers'>('companies');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [isCreatingDriver, setIsCreatingDriver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    setIsLoading(true);
    setError(null);
    try {
      const active = activeFilter === 'active' ? true : activeFilter === 'inactive' ? false : undefined;
      const [nextCompanies, nextDrivers] = await Promise.all([
        listCompanyPage(
          { search: search.trim(), active, company_type: typeFilter as CompanyType | '' },
          companyPage,
          signal,
        ),
        listDriverPage(
          {
            search: search.trim(),
            active,
            company: companyFilter,
            company_type: typeFilter as CompanyType | '',
          },
          driverPage,
          signal,
        ),
      ]);
      setCompanies(nextCompanies.results);
      setDrivers(nextDrivers.results);
      setCompanyResult(nextCompanies);
      setDriverResult(nextDrivers);
    } catch (loadError) {
      if (!signal?.aborted) setError(getApiErrorMessage(loadError, t, t('management.loadError')));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeFilter, companyFilter, companyPage, driverPage, search, typeFilter]);

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow={t('partners.eyebrow')}
        title={t('partners.title')}
        description={t('partners.intro')}
      />

      {error ? <ErrorState message={error} /> : null}
      {notice ? <p className="success-panel" role="status" aria-live="polite">{notice}</p> : null}

      <div className="partners-toolbar">
        <input
          type="search"
          className="partners-search"
          placeholder={t('partners.searchPlaceholder')}
          value={search}
          onChange={(event) => { setSearch(event.target.value); setCompanyPage(1); setDriverPage(1); }}
          aria-label={t('partners.searchPlaceholder')}
        />
        <span className="hint-text">
          {t('partners.summary', { companies: companyResult?.count ?? 0, drivers: driverResult?.count ?? 0 })}
        </span>
        {canCreate && activeTab === 'companies' ? (
          <button type="button" className="success-button" onClick={() => setIsCreatingCompany((value) => !value)}>
            {isCreatingCompany ? t('management.cancel') : t('partners.newCompany')}
          </button>
        ) : null}
        {canCreate && activeTab === 'drivers' ? (
          <button type="button" className="success-button" onClick={() => setIsCreatingDriver((value) => !value)}>
            {isCreatingDriver ? t('management.cancel') : t('partners.addDriver')}
          </button>
        ) : null}
      </div>
      <div className="tab-list" role="tablist" aria-label={t('partners.tabs.label')}>
        {(['companies', 'drivers'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'is-active' : 'secondary-button'}
            onClick={() => setActiveTab(tab)}
          >
            {t(`partners.tabs.${tab}`)}
          </button>
        ))}
      </div>
      <section className="filter-panel admin-filter-grid" aria-label={t('partners.filters.label')}>
        <label><span>{t('partners.filters.status')}</span><select value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value); setCompanyPage(1); setDriverPage(1); }}>
          <option value="">{t('partners.filters.allStatuses')}</option>
          <option value="active">{t('management.activeBadge')}</option>
          <option value="inactive">{t('management.inactiveBadge')}</option>
        </select></label>
        <label><span>{t('partners.filters.type')}</span><select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setCompanyPage(1); setDriverPage(1); }}>
          <option value="">{t('partners.filters.allTypes')}</option>
          {COMPANY_TYPES.map((type) => <option value={type} key={type}>{t(`companyTypes.${type}`)}</option>)}
        </select></label>
        <SearchableSelect
          label={t('partners.filters.company')}
          value={companyFilter}
          onChange={(value) => { setCompanyFilter(value); setDriverPage(1); }}
          options={[
            { value: '', label: t('partners.filters.allCompanies') },
            { value: 'independent', label: t('partners.independentTitle') },
            ...companies.map((company) => ({ value: company.id, label: company.name })),
          ]}
          loadOptions={async (query, signal) => {
            const result = await searchCompanies(query, signal);
            return [
              { value: '', label: t('partners.filters.allCompanies') },
              { value: 'independent', label: t('partners.independentTitle') },
              ...result.results.map((company) => ({ value: company.id, label: company.name })),
            ];
          }}
          emptyText={t('partners.emptyCompanies')}
          loadingText={t('states.loading')}
        />
      </section>

      {user?.role === 'admin' ? <DuplicateManagement onMerged={async () => { await load(); setNotice(t('partners.merge.success')); }} /> : null}

      {canCreate && isCreatingCompany ? (
        <CompanyForm
          onCancel={() => setIsCreatingCompany(false)}
          onSaved={async () => {
            setIsCreatingCompany(false);
            await load();
            setNotice(t('management.saved'));
          }}
        />
      ) : null}
      {canCreate && isCreatingDriver ? (
        <DriverForm
          defaultCompany={companyFilter === 'independent' ? '' : companyFilter}
          companies={companies}
          onCancel={() => setIsCreatingDriver(false)}
          onSaved={async () => {
            setIsCreatingDriver(false);
            await load();
            setNotice(t('management.saved'));
          }}
        />
      ) : null}

      {activeTab === 'companies' ? (
        companies.length ? (
          <div className="group-stack">
            {companies.map((company) => (
            <GroupCard
              key={company.id}
              company={company}
              drivers={[]}
              driverCount={company.driver_count ?? 0}
              hideDrivers
              companies={companies}
              canCreate={canCreate}
              canEdit={canEdit}
              canDeactivate={canDeactivate}
              onChanged={async () => { await load(); setNotice(t('management.saved')); }}
            />
            ))}
            {companyResult ? <PaginationControls page={companyResult} onPageChange={setCompanyPage} /> : null}
          </div>
        ) : <p className="hint-text">{t('partners.emptyCompanies')}</p>
      ) : (
        drivers.length ? (
          <section className="content-card">
            <div className="driver-directory-list">
              {drivers.map((driver) => (
                <DriverRow
                  key={driver.id}
                  driver={driver}
                  companies={companies}
                  canEdit={canEdit}
                  canDeactivate={canDeactivate}
                  onChanged={async () => { await load(); setNotice(t('management.saved')); }}
                />
              ))}
            </div>
            {driverResult ? <PaginationControls page={driverResult} onPageChange={setDriverPage} /> : null}
          </section>
        ) : <p className="hint-text">{t('partners.emptyDrivers')}</p>
      )}
    </section>
  );
}

function GroupCard({
  company,
  drivers,
  driverCount,
  hideDrivers = false,
  companies,
  canCreate,
  canEdit,
  canDeactivate,
  onChanged,
}: {
  company: Company | null;
  drivers: Driver[];
  driverCount?: number;
  hideDrivers?: boolean;
  companies: Company[];
  canCreate: boolean;
  canEdit: boolean;
  canDeactivate: boolean;
  onChanged: Reload;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingDriver, setIsAddingDriver] = useState(false);
  const [isConfirmingDeactivate, setIsConfirmingDeactivate] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const isIndependent = company === null;
  const title = isIndependent ? t('partners.independentTitle') : company.name;

  async function handleDeactivate() {
    if (isIndependent || isDeactivating) {
      return;
    }
    setIsDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateCompany(company.id);
      setIsConfirmingDeactivate(false);
      await onChanged();
    } catch (error) {
      setDeactivateError(getApiErrorMessage(error, t, t('partners.deactivateError')));
    } finally {
      setIsDeactivating(false);
    }
  }

  return (
    <article className="group-card">
      <header className="group-card__header">
        <div>
          <h3>
            {title}
            {!isIndependent && !company.is_active ? ` · ${t('management.inactiveBadge')}` : ''}
          </h3>
          {isIndependent ? (
            <p className="hint-text">{t('partners.independentHint')}</p>
          ) : (
            <p className="group-card__meta">
              <span className="type-badge">{t(`companyTypes.${company.company_type}`)}</span>
              <span className="hint-text">
                {company.contact_name || company.email || company.phone || t('common.notAvailable')}
              </span>
            </p>
          )}
        </div>
        <div className="group-card__header-actions">
          <span className="driver-count">{t('partners.driverCount', { count: driverCount ?? drivers.length })}</span>
          {!isIndependent && canEdit ? (
            <button type="button" className="secondary-button" onClick={() => setIsEditing((value) => !value)}>
              {isEditing ? t('management.cancel') : t('management.edit')}
            </button>
          ) : null}
          {!isIndependent && canDeactivate && company.is_active ? (
            <button
              type="button"
              className="danger-button"
              aria-label={t('partners.deactivateCompanyLabel', { company: company.name })}
              disabled={isDeactivating}
              onClick={() => setIsConfirmingDeactivate(true)}
            >
              {t('partners.deactivate')}
            </button>
          ) : null}
          {!isIndependent && canCreate && company.is_active ? (
            <>
              <Link className="button-link secondary-button" to={`/app/reservations?company=${company.id}`}>
                {t('partners.useInReservation')}
              </Link>
              <Link className="button-link secondary-button" to={`/app/workflows/loan-checkout?company=${company.id}`}>
                {t('partners.useInCheckout')}
              </Link>
            </>
          ) : null}
        </div>
      </header>

      {deactivateError ? <ErrorState message={deactivateError} /> : null}

      {!isIndependent && isEditing ? (
        <CompanyForm
          initial={company}
          canReactivate={canDeactivate}
          onCancel={() => setIsEditing(false)}
          onSaved={async () => {
            setIsEditing(false);
            await onChanged();
          }}
        />
      ) : null}

      {!hideDrivers ? <div className="group-card__drivers">
        {drivers.length === 0 ? (
          <p className="hint-text">{t('partners.emptyDrivers')}</p>
        ) : (
          drivers.map((driver) => (
            <DriverRow
              key={driver.id}
              driver={driver}
              companies={companies}
              canEdit={canEdit}
              canDeactivate={canDeactivate}
              onChanged={onChanged}
            />
          ))
        )}
      </div> : null}

      {canCreate ? (
        isAddingDriver ? (
          <DriverForm
            defaultCompany={isIndependent ? '' : company.id}
            lockCompany
            companies={companies}
            onCancel={() => setIsAddingDriver(false)}
            onSaved={async () => {
              setIsAddingDriver(false);
              await onChanged();
            }}
          />
        ) : (
          <button type="button" className="ghost-button add-driver-button" onClick={() => setIsAddingDriver(true)}>
            {`+ ${t('partners.addDriver')}`}
          </button>
        )
      ) : null}
      <ConfirmDialog
        open={!isIndependent && isConfirmingDeactivate}
        title={t('partners.confirmDeactivateTitle')}
        description={t('partners.deactivateWarning', { company: title, count: driverCount ?? drivers.length })}
        confirmLabel={t('partners.confirmDeactivate')}
        busy={isDeactivating}
        onCancel={() => {
          setIsConfirmingDeactivate(false);
          setDeactivateError(null);
        }}
        onConfirm={() => void handleDeactivate()}
      />
    </article>
  );
}

function DriverRow({
  driver,
  companies,
  canEdit,
  canDeactivate,
  onChanged,
}: {
  driver: Driver;
  companies: Company[];
  canEdit: boolean;
  canDeactivate: boolean;
  onChanged: Reload;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDeactivate, setIsConfirmingDeactivate] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  async function handleDeactivate() {
    if (isDeactivating) return;
    setIsDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateDriver(driver.id);
      setIsConfirmingDeactivate(false);
      await onChanged();
    } catch (error) {
      setDeactivateError(getApiErrorMessage(error, t, t('partners.deactivateDriverError')));
    } finally {
      setIsDeactivating(false);
    }
  }

  if (isEditing) {
    return (
      <DriverForm
        initial={driver}
        defaultCompany={driver.company ?? ''}
        companies={companies}
        canReactivate={canDeactivate}
        onCancel={() => setIsEditing(false)}
        onSaved={async () => {
          setIsEditing(false);
          await onChanged();
        }}
      />
    );
  }

  return (
    <div className="driver-row">
      <div>
        <strong>
          {displayDriverName(driver)}
          {!driver.is_active ? ` · ${t('management.inactiveBadge')}` : ''}
        </strong>
        <span className="hint-text">
          {[driver.company_name, driver.license_classes, driver.phone || driver.email].filter(Boolean).join(' · ') ||
            t('common.notAvailable')}
        </span>
        {deactivateError ? <span className="field-error">{deactivateError}</span> : null}
      </div>
      <div className="action-row">
        {canEdit ? (
          <button type="button" className="secondary-button" onClick={() => setIsEditing(true)}>
            {t('management.edit')}
          </button>
        ) : null}
        {canDeactivate && driver.is_active ? (
          <button
            type="button"
            className="danger-button"
            aria-label={t('partners.deactivateDriverLabel', { driver: displayDriverName(driver) })}
            disabled={isDeactivating}
            onClick={() => setIsConfirmingDeactivate(true)}
          >
            {t('partners.deactivateDriver')}
          </button>
        ) : null}
        {canEdit && driver.is_active ? (
          <>
            <Link className="button-link secondary-button" to={`/app/reservations?driver=${driver.id}`}>
              {t('partners.useInReservation')}
            </Link>
            <Link className="button-link secondary-button" to={`/app/workflows/loan-checkout?driver=${driver.id}`}>
              {t('partners.useInCheckout')}
            </Link>
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={isConfirmingDeactivate}
        title={t('partners.confirmDeactivateDriverTitle')}
        description={t('partners.deactivateDriverWarning', { driver: displayDriverName(driver) })}
        confirmLabel={t('partners.confirmDeactivateDriver')}
        busy={isDeactivating}
        onCancel={() => {
          setIsConfirmingDeactivate(false);
          setDeactivateError(null);
        }}
        onConfirm={() => void handleDeactivate()}
      />
    </div>
  );
}

function CompanyForm({
  initial,
  canReactivate,
  onCancel,
  onSaved,
}: {
  initial?: Company | null;
  canReactivate?: boolean;
  onCancel: () => void;
  onSaved: Reload;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [companyType, setCompanyType] = useState<CompanyType>(initial?.company_type ?? 'subcontractor');
  const [contactName, setContactName] = useState(initial?.contact_name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(initial);
  const dirty = name !== (initial?.name ?? '')
    || companyType !== (initial?.company_type ?? 'subcontractor')
    || contactName !== (initial?.contact_name ?? '')
    || phone !== (initial?.phone ?? '')
    || email !== (initial?.email ?? '')
    || address !== (initial?.address ?? '')
    || notes !== (initial?.notes ?? '')
    || isActive !== (initial?.is_active ?? true);
  useDirtyFormWarning(dirty, t('forms.unsaved'));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    if (!name.trim()) {
      setError(t('management.validation.nameRequired'));
      return;
    }
    setIsSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      company_type: companyType,
      contact_name: contactName,
      phone,
      email,
      address,
      notes,
      ...(canReactivate && initial && !initial.is_active ? { is_active: isActive } : {}),
    };
    try {
      if (isEdit && initial) {
        await updateCompany(initial.id, payload);
      } else {
        await createCompany(payload);
      }
      await onSaved();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('management.saveError')));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="content-card form-stack" onSubmit={handleSubmit}>
      <h4 className="form-section-title">{isEdit ? t('partners.editCompany') : t('partners.newCompany')}</h4>
      {error ? <ErrorState message={error} /> : null}
      <div className="form-grid form-grid--two">
        <label>
          <span>{t('management.fields.name')}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>{t('management.fields.companyType')}</span>
          <select value={companyType} onChange={(event) => setCompanyType(event.target.value as CompanyType)}>
            {COMPANY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`companyTypes.${type}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid form-grid--three">
        <label>
          <span>{t('management.fields.contactName')}</span>
          <input value={contactName} onChange={(event) => setContactName(event.target.value)} />
        </label>
        <label>
          <span>{t('management.fields.phone')}</span>
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label>
          <span>{t('management.fields.email')}</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>
      <label>
        <span>{t('management.fields.address')}</span>
        <input value={address} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <label>
        <span>{t('management.fields.notes')}</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {canReactivate && initial && !initial.is_active ? (
        <label className="checkbox-inline">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          <span>{t('management.fields.active')}</span>
        </label>
      ) : null}
      <div className="action-row">
        <button type="submit" className="success-button" disabled={isSaving}>
          {isSaving ? t('management.saving') : isEdit ? t('management.save') : t('management.addCompany')}
        </button>
        <button type="button" className="secondary-button" disabled={isSaving} onClick={onCancel}>
          {t('management.cancel')}
        </button>
      </div>
    </form>
  );
}

function DriverForm({
  initial,
  defaultCompany,
  lockCompany,
  companies,
  canReactivate,
  onCancel,
  onSaved,
}: {
  initial?: Driver | null;
  defaultCompany: string;
  lockCompany?: boolean;
  companies: Company[];
  canReactivate?: boolean;
  onCancel: () => void;
  onSaved: Reload;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState(initial?.first_name ?? '');
  const [lastName, setLastName] = useState(initial?.last_name ?? '');
  const [company, setCompany] = useState(defaultCompany);
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [licenseClasses, setLicenseClasses] = useState(initial?.license_classes ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(initial);
  const dirty = firstName !== (initial?.first_name ?? '')
    || lastName !== (initial?.last_name ?? '')
    || company !== defaultCompany
    || phone !== (initial?.phone ?? '')
    || email !== (initial?.email ?? '')
    || licenseClasses !== (initial?.license_classes ?? '')
    || notes !== (initial?.notes ?? '')
    || isActive !== (initial?.is_active ?? true);
  useDirtyFormWarning(dirty, t('forms.unsaved'));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    if (!firstName.trim() || !lastName.trim()) {
      setError(t('management.validation.driverNameRequired'));
      return;
    }
    setIsSaving(true);
    setError(null);
    const payload = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      company: company || null,
      phone,
      email,
      license_classes: licenseClasses,
      notes,
      ...(canReactivate && initial && !initial.is_active ? { is_active: isActive } : {}),
    };
    try {
      if (isEdit && initial) {
        await updateDriver(initial.id, payload);
      } else {
        await createDriver(payload);
      }
      await onSaved();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('management.saveError')));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="content-card form-stack driver-form" onSubmit={handleSubmit}>
      <h4 className="form-section-title">{isEdit ? t('partners.editDriver') : t('partners.addDriver')}</h4>
      {error ? <ErrorState message={error} /> : null}
      <div className="form-grid form-grid--two">
        <label>
          <span>{t('management.fields.firstName')}</span>
          <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <label>
          <span>{t('management.fields.lastName')}</span>
          <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
        </label>
      </div>
      {!lockCompany ? (
        <SearchableSelect
          label={t('management.fields.company')}
          value={company}
          onChange={setCompany}
          options={[
            { value: '', label: t('management.fields.noCompany') },
            ...companies.map((item) => ({ value: item.id, label: item.name })),
            ...(initial?.company && !companies.some((item) => item.id === initial.company)
              ? [{ value: initial.company, label: initial.company_name || initial.company }]
              : []),
          ]}
          loadOptions={async (query, signal) => {
            const result = await searchCompanies(query, signal);
            return [
              { value: '', label: t('management.fields.noCompany') },
              ...result.results.map((item) => ({ value: item.id, label: item.name })),
            ];
          }}
          emptyText={t('partners.emptyCompanies')}
          loadingText={t('states.loading')}
        />
      ) : null}
      <div className="form-grid form-grid--three">
        <label>
          <span>{t('management.fields.phone')}</span>
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label>
          <span>{t('management.fields.email')}</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          <span>{t('management.fields.licenseClasses')}</span>
          <input value={licenseClasses} onChange={(event) => setLicenseClasses(event.target.value)} />
        </label>
      </div>
      <label>
        <span>{t('management.fields.notes')}</span>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      {canReactivate && initial && !initial.is_active ? (
        <label className="checkbox-inline">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          <span>{t('management.fields.active')}</span>
        </label>
      ) : null}
      <div className="action-row">
        <button type="submit" className="success-button" disabled={isSaving}>
          {isSaving ? t('management.saving') : isEdit ? t('management.save') : t('management.addDriver')}
        </button>
        <button type="button" className="secondary-button" disabled={isSaving} onClick={onCancel}>
          {t('management.cancel')}
        </button>
      </div>
    </form>
  );
}

function DuplicateManagement({ onMerged }: { onMerged: Reload }) {
  const { t } = useTranslation();
  const [companyGroups, setCompanyGroups] = useState<Company[][]>([]);
  const [driverGroups, setDriverGroups] = useState<Driver[][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listCompanyDuplicates(), listDriverDuplicates()])
      .then(([companies, drivers]) => {
        if (!active) return;
        setCompanyGroups(companies.map((group) => group.companies ?? []));
        setDriverGroups(drivers.map((group) => group.drivers ?? []));
      })
      .catch((loadError) => {
        if (active) setError(getApiErrorMessage(loadError, t, t('partners.merge.loadError')));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  return (
    <section className="content-card">
      <div>
        <h3>{t('partners.merge.title')}</h3>
        <p className="hint-text">{t('partners.merge.description')}</p>
      </div>
      {loading ? <LoadingState variant="skeleton" rows={2} /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && !companyGroups.length && !driverGroups.length ? <p className="success-text">{t('partners.merge.empty')}</p> : null}
      {companyGroups.map((items, index) => <DuplicateGroup key={`company-${index}`} kind="company" items={items} onMerged={onMerged} />)}
      {driverGroups.map((items, index) => <DuplicateGroup key={`driver-${index}`} kind="driver" items={items} onMerged={onMerged} />)}
    </section>
  );
}

function DuplicateGroup({
  kind,
  items,
  onMerged,
}: {
  kind: 'company' | 'driver';
  items: Array<Company | Driver>;
  onMerged: Reload;
}) {
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState(items[0]?.id ?? '');
  const [targetId, setTargetId] = useState(items[1]?.id ?? '');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (item: Company | Driver) => 'company_type' in item ? item.name : displayDriverName(item);

  async function requestPreview() {
    if (!sourceId || !targetId || sourceId === targetId || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = kind === 'company'
        ? await mergeCompany(sourceId, targetId)
        : await mergeDriver(sourceId, targetId);
      if ('confirmation_required' in result) setPreview(result);
    } catch (previewError) {
      setError(getApiErrorMessage(previewError, t, t('partners.merge.error')));
    } finally {
      setPending(false);
    }
  }

  async function confirmMerge() {
    if (!preview || pending) return;
    setPending(true);
    setError(null);
    try {
      if (kind === 'company') await mergeCompany(sourceId, targetId, preview.confirmation_token);
      else await mergeDriver(sourceId, targetId, preview.confirmation_token);
      setPreview(null);
      await onMerged();
    } catch (mergeError) {
      setError(getApiErrorMessage(mergeError, t, t('partners.merge.error')));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="duplicate-group">
      <strong>{t(`partners.merge.${kind}Candidate`)}</strong>
      {error ? <span className="field-error">{error}</span> : null}
      <div className="form-grid form-grid--two">
        <label><span>{t('partners.merge.source')}</span><select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setPreview(null); }}>
          {items.map((item) => <option key={item.id} value={item.id}>{label(item)}</option>)}
        </select></label>
        <label><span>{t('partners.merge.target')}</span><select value={targetId} onChange={(event) => { setTargetId(event.target.value); setPreview(null); }}>
          {items.filter((item) => item.id !== sourceId).map((item) => <option key={item.id} value={item.id}>{label(item)}</option>)}
        </select></label>
      </div>
      <button type="button" className="secondary-button" disabled={pending || sourceId === targetId} onClick={() => void requestPreview()}>{t('partners.merge.preview')}</button>
      <ConfirmDialog
        open={Boolean(preview)}
        title={t('partners.merge.confirmTitle')}
        description={t('partners.merge.confirmDescription', {
          count: Object.values(preview?.reassignment_counts ?? {}).reduce((sum, count) => sum + count, 0),
        })}
        confirmLabel={t('partners.merge.confirm')}
        busy={pending}
        onCancel={() => setPreview(null)}
        onConfirm={() => void confirmMerge()}
      />
    </div>
  );
}
