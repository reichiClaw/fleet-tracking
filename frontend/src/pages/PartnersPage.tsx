import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createCompany,
  createDriver,
  displayDriverName,
  listCompanies,
  listDrivers,
  updateCompany,
  updateDriver,
  type Company,
  type CompanyType,
  type Driver,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { PageHeader } from '../components/PageHeader';

const COMPANY_TYPES: CompanyType[] = ['subcontractor', 'manufacturer', 'supplier', 'internal'];

type Reload = () => Promise<void> | void;

export function PartnersPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canCreate = user?.role === 'admin' || user?.role === 'operations';
  const canEdit = user?.role === 'admin';

  const [companies, setCompanies] = useState<Company[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextCompanies, nextDrivers] = await Promise.all([listCompanies(), listDrivers()]);
      setCompanies(nextCompanies);
      setDrivers(nextDrivers);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError, t, t('management.loadError')));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const { byCompany, independent } = useMemo(() => {
    const map = new Map<string, Driver[]>();
    const loose: Driver[] = [];
    drivers.forEach((driver) => {
      if (driver.company) {
        const current = map.get(driver.company) ?? [];
        current.push(driver);
        map.set(driver.company, current);
      } else {
        loose.push(driver);
      }
    });
    return { byCompany: map, independent: loose };
  }, [drivers]);

  const query = search.trim().toLowerCase();

  function visibleDrivers(list: Driver[], companyMatches: boolean) {
    if (!query || companyMatches) {
      return list;
    }
    return list.filter((driver) => displayDriverName(driver).toLowerCase().includes(query));
  }

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

      <div className="partners-toolbar">
        <input
          type="search"
          className="partners-search"
          placeholder={t('partners.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={t('partners.searchPlaceholder')}
        />
        <span className="hint-text">
          {t('partners.summary', { companies: companies.length, drivers: drivers.length })}
        </span>
        {canCreate ? (
          <button type="button" className="success-button" onClick={() => setIsCreatingCompany((value) => !value)}>
            {isCreatingCompany ? t('management.cancel') : t('partners.newCompany')}
          </button>
        ) : null}
      </div>

      {canCreate && isCreatingCompany ? (
        <CompanyForm
          onCancel={() => setIsCreatingCompany(false)}
          onSaved={async () => {
            setIsCreatingCompany(false);
            await load();
          }}
        />
      ) : null}

      {companies.length === 0 && independent.length === 0 ? (
        <p className="hint-text">{t('partners.emptyCompanies')}</p>
      ) : null}

      <div className="group-stack">
        {companies.map((company) => {
          const companyMatches = !query || company.name.toLowerCase().includes(query);
          const groupDrivers = byCompany.get(company.id) ?? [];
          const shownDrivers = visibleDrivers(groupDrivers, companyMatches);
          if (query && !companyMatches && shownDrivers.length === 0) {
            return null;
          }
          return (
            <GroupCard
              key={company.id}
              company={company}
              drivers={shownDrivers}
              companies={companies}
              canCreate={canCreate}
              canEdit={canEdit}
              onChanged={load}
            />
          );
        })}

        {(() => {
          const shownIndependent = visibleDrivers(independent, false);
          const showIndependent = query ? shownIndependent.length > 0 : independent.length > 0 || canCreate;
          if (!showIndependent) {
            return null;
          }
          return (
            <GroupCard
              company={null}
              drivers={shownIndependent}
              companies={companies}
              canCreate={canCreate}
              canEdit={canEdit}
              onChanged={load}
            />
          );
        })()}
      </div>
    </section>
  );
}

function GroupCard({
  company,
  drivers,
  companies,
  canCreate,
  canEdit,
  onChanged,
}: {
  company: Company | null;
  drivers: Driver[];
  companies: Company[];
  canCreate: boolean;
  canEdit: boolean;
  onChanged: Reload;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingDriver, setIsAddingDriver] = useState(false);

  const isIndependent = company === null;
  const title = isIndependent ? t('partners.independentTitle') : company.name;

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
          <span className="driver-count">{t('partners.driverCount', { count: drivers.length })}</span>
          {!isIndependent && canEdit ? (
            <button type="button" className="secondary-button" onClick={() => setIsEditing((value) => !value)}>
              {isEditing ? t('management.cancel') : t('management.edit')}
            </button>
          ) : null}
        </div>
      </header>

      {!isIndependent && isEditing ? (
        <CompanyForm
          initial={company}
          onCancel={() => setIsEditing(false)}
          onSaved={async () => {
            setIsEditing(false);
            await onChanged();
          }}
        />
      ) : null}

      <div className="group-card__drivers">
        {drivers.length === 0 ? (
          <p className="hint-text">{t('partners.emptyDrivers')}</p>
        ) : (
          drivers.map((driver) => (
            <DriverRow
              key={driver.id}
              driver={driver}
              companies={companies}
              canEdit={canEdit}
              onChanged={onChanged}
            />
          ))
        )}
      </div>

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
    </article>
  );
}

function DriverRow({
  driver,
  companies,
  canEdit,
  onChanged,
}: {
  driver: Driver;
  companies: Company[];
  canEdit: boolean;
  onChanged: Reload;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing) {
    return (
      <DriverForm
        initial={driver}
        defaultCompany={driver.company ?? ''}
        companies={companies}
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
          {[driver.license_classes, driver.phone || driver.email].filter(Boolean).join(' · ') ||
            t('common.notAvailable')}
        </span>
      </div>
      {canEdit ? (
        <button type="button" className="secondary-button" onClick={() => setIsEditing(true)}>
          {t('management.edit')}
        </button>
      ) : null}
    </div>
  );
}

function CompanyForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: Company | null;
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      is_active: isActive,
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
      <label className="checkbox-inline">
        <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        <span>{t('management.fields.active')}</span>
      </label>
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
  onCancel,
  onSaved,
}: {
  initial?: Driver | null;
  defaultCompany: string;
  lockCompany?: boolean;
  companies: Company[];
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      is_active: isActive,
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
        <label>
          <span>{t('management.fields.company')}</span>
          <select value={company} onChange={(event) => setCompany(event.target.value)}>
            <option value="">{t('management.fields.noCompany')}</option>
            {companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
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
      <label className="checkbox-inline">
        <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        <span>{t('management.fields.active')}</span>
      </label>
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
