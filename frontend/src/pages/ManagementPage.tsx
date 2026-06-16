import { type FormEvent, useEffect, useState } from 'react';
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

export function CompanyManagementPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canMutate = user?.role === 'admin' || user?.role === 'operations';
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState('');
  const [companyType, setCompanyType] = useState<CompanyType>('subcontractor');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCompanies() {
    setIsLoading(true);
    setError(null);
    try {
      setCompanies(await listCompanies());
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('management.loadError')));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('management.validation.nameRequired'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createCompany({ name: name.trim(), company_type: companyType, contact_name: contactName, phone, email, is_active: true });
      setName('');
      setContactName('');
      setPhone('');
      setEmail('');
      await loadCompanies();
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('management.saveError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('management.companies.eyebrow')}</p>
        <h2>{t('management.companies.title')}</h2>
        <p>{t('management.companies.description')}</p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {canMutate ? (
        <form className="content-card form-stack" onSubmit={handleSubmit}>
        <div className="form-grid form-grid--two">
          <label>
            <span>{t('management.fields.name')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.companyType')}</span>
            <select value={companyType} onChange={(event) => setCompanyType(event.target.value as CompanyType)}>
              <option value="subcontractor">{t('companyTypes.subcontractor')}</option>
              <option value="manufacturer">{t('companyTypes.manufacturer')}</option>
              <option value="supplier">{t('companyTypes.supplier')}</option>
              <option value="internal">{t('companyTypes.internal')}</option>
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
            <input min="0" step="1" type="number" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.email')}</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        </div>
        <button type="submit" className="success-button" disabled={isSubmitting}>{isSubmitting ? t('management.saving') : t('management.addCompany')}</button>
        </form>
      ) : null}
      {isLoading ? (
        <LoadingState />
      ) : (
        <CompanyList companies={companies} canEdit={user?.role === 'admin'} onSaved={loadCompanies} />
      )}
    </section>
  );
}

export function DriverManagementPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canMutate = user?.role === 'admin' || user?.role === 'operations';
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [licenseClasses, setLicenseClasses] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDrivers() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextDrivers, nextCompanies] = await Promise.all([listDrivers(), listCompanies()]);
      setDrivers(nextDrivers);
      setCompanies(nextCompanies);
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('management.loadError')));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDrivers();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError(t('management.validation.driverNameRequired'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createDriver({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        company: company || null,
        phone,
        email,
        license_classes: licenseClasses,
        is_active: true,
      });
      setFirstName('');
      setLastName('');
      setCompany('');
      setPhone('');
      setEmail('');
      setLicenseClasses('');
      await loadDrivers();
    } catch (error) {
      setError(getApiErrorMessage(error, t, t('management.saveError')));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('management.drivers.eyebrow')}</p>
        <h2>{t('management.drivers.title')}</h2>
        <p>{t('management.drivers.description')}</p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {canMutate ? (
        <form className="content-card form-stack" onSubmit={handleSubmit}>
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
        <label>
          <span>{t('management.fields.company')}</span>
          <select value={company} onChange={(event) => setCompany(event.target.value)}>
            <option value="">{t('management.fields.noCompany')}</option>
            {companies.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <div className="form-grid form-grid--three">
          <label>
            <span>{t('management.fields.phone')}</span>
            <input min="0" step="1" type="number" value={phone} onChange={(event) => setPhone(event.target.value)} />
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
        <button type="submit" className="success-button" disabled={isSubmitting}>{isSubmitting ? t('management.saving') : t('management.addDriver')}</button>
        </form>
      ) : null}
      {isLoading ? (
        <LoadingState />
      ) : (
        <DriverList
          drivers={drivers}
          companies={companies}
          canEdit={user?.role === 'admin'}
          onSaved={loadDrivers}
        />
      )}
    </section>
  );
}

function CompanyList({
  companies,
  canEdit,
  onSaved,
}: {
  companies: Company[];
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  if (!companies.length) {
    return <p className="hint-text">{t('management.companies.empty')}</p>;
  }
  return (
    <div className="card-grid card-grid--two">
      {companies.map((company) => (
        <CompanyCard key={company.id} company={company} canEdit={canEdit} onSaved={onSaved} />
      ))}
    </div>
  );
}

function CompanyCard({
  company,
  canEdit,
  onSaved,
}: {
  company: Company;
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(company.name);
  const [companyType, setCompanyType] = useState<CompanyType>(company.company_type);
  const [contactName, setContactName] = useState(company.contact_name ?? '');
  const [phone, setPhone] = useState(company.phone ?? '');
  const [email, setEmail] = useState(company.email ?? '');
  const [address, setAddress] = useState(company.address ?? '');
  const [notes, setNotes] = useState(company.notes ?? '');
  const [isActive, setIsActive] = useState(company.is_active);

  function startEditing() {
    setName(company.name);
    setCompanyType(company.company_type);
    setContactName(company.contact_name ?? '');
    setPhone(company.phone ?? '');
    setEmail(company.email ?? '');
    setAddress(company.address ?? '');
    setNotes(company.notes ?? '');
    setIsActive(company.is_active);
    setError(null);
    setIsEditing(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('management.validation.nameRequired'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateCompany(company.id, {
        name: name.trim(),
        company_type: companyType,
        contact_name: contactName,
        phone,
        email,
        address,
        notes,
        is_active: isActive,
      });
      setIsEditing(false);
      await onSaved();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('management.saveError')));
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <form className="content-card form-stack" onSubmit={handleSave}>
        {error ? <ErrorState message={error} /> : null}
        <div className="form-grid form-grid--two">
          <label>
            <span>{t('management.fields.name')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.companyType')}</span>
            <select value={companyType} onChange={(event) => setCompanyType(event.target.value as CompanyType)}>
              <option value="subcontractor">{t('companyTypes.subcontractor')}</option>
              <option value="manufacturer">{t('companyTypes.manufacturer')}</option>
              <option value="supplier">{t('companyTypes.supplier')}</option>
              <option value="internal">{t('companyTypes.internal')}</option>
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
            <input min="0" step="1" type="number" value={phone} onChange={(event) => setPhone(event.target.value)} />
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
            {isSaving ? t('management.saving') : t('management.save')}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isSaving}
            onClick={() => setIsEditing(false)}
          >
            {t('management.cancel')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="content-card">
      <h3>{company.name}</h3>
      <p>
        {t(`companyTypes.${company.company_type}`)}
        {!company.is_active ? ` · ${t('management.inactiveBadge')}` : ''}
      </p>
      <p className="hint-text">{company.contact_name || company.email || company.phone || t('common.notAvailable')}</p>
      {canEdit ? (
        <div className="action-row">
          <button type="button" className="secondary-button" onClick={startEditing}>
            {t('management.edit')}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function DriverList({
  drivers,
  companies,
  canEdit,
  onSaved,
}: {
  drivers: Driver[];
  companies: Company[];
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const companiesById = new Map(companies.map((company) => [company.id, company.name]));
  if (!drivers.length) {
    return <p className="hint-text">{t('management.drivers.empty')}</p>;
  }
  return (
    <div className="card-grid card-grid--two">
      {drivers.map((driver) => (
        <DriverCard
          key={driver.id}
          driver={driver}
          companies={companies}
          companiesById={companiesById}
          canEdit={canEdit}
          onSaved={onSaved}
        />
      ))}
    </div>
  );
}

function DriverCard({
  driver,
  companies,
  companiesById,
  canEdit,
  onSaved,
}: {
  driver: Driver;
  companies: Company[];
  companiesById: Map<string, string>;
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstName, setFirstName] = useState(driver.first_name);
  const [lastName, setLastName] = useState(driver.last_name);
  const [company, setCompany] = useState(driver.company ?? '');
  const [phone, setPhone] = useState(driver.phone ?? '');
  const [email, setEmail] = useState(driver.email ?? '');
  const [licenseClasses, setLicenseClasses] = useState(driver.license_classes ?? '');
  const [notes, setNotes] = useState(driver.notes ?? '');
  const [isActive, setIsActive] = useState(driver.is_active);

  function startEditing() {
    setFirstName(driver.first_name);
    setLastName(driver.last_name);
    setCompany(driver.company ?? '');
    setPhone(driver.phone ?? '');
    setEmail(driver.email ?? '');
    setLicenseClasses(driver.license_classes ?? '');
    setNotes(driver.notes ?? '');
    setIsActive(driver.is_active);
    setError(null);
    setIsEditing(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError(t('management.validation.driverNameRequired'));
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await updateDriver(driver.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        company: company || null,
        phone,
        email,
        license_classes: licenseClasses,
        notes,
        is_active: isActive,
      });
      setIsEditing(false);
      await onSaved();
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, t, t('management.saveError')));
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <form className="content-card form-stack" onSubmit={handleSave}>
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
        <div className="form-grid form-grid--three">
          <label>
            <span>{t('management.fields.phone')}</span>
            <input min="0" step="1" type="number" value={phone} onChange={(event) => setPhone(event.target.value)} />
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
            {isSaving ? t('management.saving') : t('management.save')}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isSaving}
            onClick={() => setIsEditing(false)}
          >
            {t('management.cancel')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="content-card">
      <h3>
        {displayDriverName(driver)}
        {!driver.is_active ? ` · ${t('management.inactiveBadge')}` : ''}
      </h3>
      <p>{driver.company ? companiesById.get(driver.company) || t('common.unknown') : t('management.fields.noCompany')}</p>
      <p className="hint-text">{driver.phone || driver.email || driver.license_classes || t('common.notAvailable')}</p>
      {canEdit ? (
        <div className="action-row">
          <button type="button" className="secondary-button" onClick={startEditing}>
            {t('management.edit')}
          </button>
        </div>
      ) : null}
    </article>
  );
}
