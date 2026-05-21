import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createCompany,
  createDriver,
  displayDriverName,
  listCompanies,
  listDrivers,
  type Company,
  type CompanyType,
  type Driver,
} from '../api/fleet';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';

export function CompanyManagementPage() {
  const { t } = useTranslation();
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
    } catch {
      setError(t('management.loadError'));
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
    } catch {
      setError(t('management.saveError'));
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
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.email')}</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        </div>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? t('management.saving') : t('management.addCompany')}</button>
      </form>
      {isLoading ? <LoadingState /> : <CompanyList companies={companies} />}
    </section>
  );
}

export function DriverManagementPage() {
  const { t } = useTranslation();
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
    } catch {
      setError(t('management.loadError'));
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
    } catch {
      setError(t('management.saveError'));
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
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
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
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? t('management.saving') : t('management.addDriver')}</button>
      </form>
      {isLoading ? <LoadingState /> : <DriverList drivers={drivers} companies={companies} />}
    </section>
  );
}

function CompanyList({ companies }: { companies: Company[] }) {
  const { t } = useTranslation();
  if (!companies.length) {
    return <p className="hint-text">{t('management.companies.empty')}</p>;
  }
  return (
    <div className="card-grid card-grid--two">
      {companies.map((company) => (
        <article className="content-card" key={company.id}>
          <h3>{company.name}</h3>
          <p>{t(`companyTypes.${company.company_type}`)}</p>
          <p className="hint-text">{company.contact_name || company.email || company.phone || t('common.notAvailable')}</p>
        </article>
      ))}
    </div>
  );
}

function DriverList({ drivers, companies }: { drivers: Driver[]; companies: Company[] }) {
  const { t } = useTranslation();
  const companiesById = new Map(companies.map((company) => [company.id, company.name]));
  if (!drivers.length) {
    return <p className="hint-text">{t('management.drivers.empty')}</p>;
  }
  return (
    <div className="card-grid card-grid--two">
      {drivers.map((driver) => (
        <article className="content-card" key={driver.id}>
          <h3>{displayDriverName(driver)}</h3>
          <p>{driver.company ? companiesById.get(driver.company) || t('common.unknown') : t('management.fields.noCompany')}</p>
          <p className="hint-text">{driver.phone || driver.email || driver.license_classes || t('common.notAvailable')}</p>
        </article>
      ))}
    </div>
  );
}
