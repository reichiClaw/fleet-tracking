import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createUser,
  createCompany,
  createDriver,
  createVehicle,
  createVehicleCategory,
  displayDriverName,
  displayVehicleName,
  listAuditLogs,
  listCompanies,
  listDrivers,
  listUsers,
  listVehicleCategories,
  listVehicles,
  type AuditLog,
  type Company,
  type CompanyType,
  type Driver,
  type UserRecord,
  type UserRole,
  type Vehicle,
  type VehicleCategory,
  type VehicleStatus,
} from '../api/fleet';
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
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.email')}</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
        </div>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? t('management.saving') : t('management.addCompany')}</button>
        </form>
      ) : null}
      {isLoading ? <LoadingState /> : <CompanyList companies={companies} />}
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
      ) : null}
      {isLoading ? <LoadingState /> : <DriverList drivers={drivers} companies={companies} />}
    </section>
  );
}

const vehicleStatuses: VehicleStatus[] = ['announced', 'checked_in', 'available', 'maintenance', 'damaged', 'manufacturer_checkout', 'archived'];
const userRoles: UserRole[] = ['admin', 'operations', 'readonly'];

export function AdminManagementPage() {
  const { t, i18n } = useTranslation();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operations');
  const [categoryName, setCategoryName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleCategory, setVehicleCategory] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [vehicleStatus, setVehicleStatus] = useState<VehicleStatus>('announced');

  async function loadAdminData() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextUsers, nextCategories, nextVehicles, nextAuditLogs] = await Promise.all([
        listUsers(),
        listVehicleCategories(),
        listVehicles(),
        listAuditLogs(),
      ]);
      setUsers(nextUsers);
      setCategories(nextCategories);
      setVehicles(nextVehicles);
      setAuditLogs(nextAuditLogs.slice(0, 10));
    } catch {
      setError(t('management.loadError'));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAdminData();
  }, []);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError(t('management.validation.userRequired'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createUser({ username: username.trim(), password, role, is_active: true });
      setUsername('');
      setPassword('');
      await loadAdminData();
    } catch {
      setError(t('management.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!categoryName.trim()) {
      setError(t('management.validation.categoryRequired'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createVehicleCategory({ name: categoryName.trim(), is_active: true });
      setCategoryName('');
      await loadAdminData();
    } catch {
      setError(t('management.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicleNumber.trim() || !vehicleCategory || !manufacturer.trim() || !model.trim()) {
      setError(t('management.validation.vehicleRequired'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createVehicle({
        internal_number: vehicleNumber.trim(),
        category: vehicleCategory,
        manufacturer: manufacturer.trim(),
        model: model.trim(),
        status: vehicleStatus,
      });
      setVehicleNumber('');
      setManufacturer('');
      setModel('');
      await loadAdminData();
    } catch {
      setError(t('management.saveError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <p className="eyebrow">{t('management.admin.eyebrow')}</p>
        <h2>{t('management.admin.title')}</h2>
        <p>{t('management.admin.description')}</p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      <section className="card-grid card-grid--two">
        <form className="content-card form-stack" onSubmit={handleCreateUser}>
          <h3>{t('management.admin.usersTitle')}</h3>
          <label>
            <span>{t('management.fields.username')}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.password')}</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.role')}</span>
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {userRoles.map((item) => (
                <option key={item} value={item}>{t(`roles.${item}`)}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={isSubmitting}>{t('management.admin.addUser')}</button>
        </form>

        <form className="content-card form-stack" onSubmit={handleCreateCategory}>
          <h3>{t('management.admin.categoriesTitle')}</h3>
          <label>
            <span>{t('management.fields.category')}</span>
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
          </label>
          <button type="submit" disabled={isSubmitting}>{t('management.admin.addCategory')}</button>
        </form>
      </section>

      <form className="content-card form-stack" onSubmit={handleCreateVehicle}>
        <h3>{t('management.admin.vehiclesTitle')}</h3>
        <div className="form-grid form-grid--two">
          <label>
            <span>{t('management.fields.internalNumber')}</span>
            <input value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.category')}</span>
            <select value={vehicleCategory} onChange={(event) => setVehicleCategory(event.target.value)}>
              <option value="">{t('vehicles.filters.allCategories')}</option>
              {categories.filter((category) => category.is_active).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('management.fields.manufacturer')}</span>
            <input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} />
          </label>
          <label>
            <span>{t('management.fields.model')}</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label>
            <span>{t('vehicles.filters.status')}</span>
            <select value={vehicleStatus} onChange={(event) => setVehicleStatus(event.target.value as VehicleStatus)}>
              {vehicleStatuses.map((status) => (
                <option key={status} value={status}>{t(`status.${status}`)}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={isSubmitting}>{t('management.admin.addVehicle')}</button>
      </form>

      {isLoading ? (
        <LoadingState />
      ) : (
        <section className="card-grid card-grid--two">
          <AdminList title={t('management.admin.usersTitle')} items={users.map((user) => `${user.username} · ${t(`roles.${user.role}`)}`)} />
          <AdminList title={t('management.admin.categoriesTitle')} items={categories.map((category) => category.name)} />
          <AdminList title={t('management.admin.vehiclesTitle')} items={vehicles.map((vehicle) => displayVehicleName(vehicle))} />
          <AdminList
            title={t('management.admin.auditTitle')}
            items={auditLogs.map((entry) => `${entry.action} · ${entry.created_at ? new Intl.DateTimeFormat(i18n.language).format(new Date(entry.created_at)) : ''}`)}
          />
        </section>
      )}
    </section>
  );
}

function AdminList({ title, items }: { title: string; items: string[] }) {
  const { t } = useTranslation();
  return (
    <article className="content-card">
      <h3>{title}</h3>
      {items.length ? (
        <ul className="list-stack">
          {items.slice(0, 10).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="hint-text">{t('common.notAvailable')}</p>
      )}
    </article>
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
