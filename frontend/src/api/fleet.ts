import { apiClient, buildApiUrl } from './client';
import { fetchAllPages, normalizePage, type PageResult, type PaginatedResponse } from './pagination';

export type { PageResult, PaginatedResponse } from './pagination';

export type UserRole = 'admin' | 'operations' | 'readonly';

export type CurrentUser = {
  id?: string;
  username: string;
  email?: string;
  full_name?: string;
  display_name?: string;
  role: UserRole;
  is_active?: boolean;
};

export type ManagedUser = {
  id: string;
  username: string;
  email?: string;
  full_name?: string;
  role: UserRole;
  is_active: boolean;
  is_staff?: boolean;
  is_superuser?: boolean;
  last_login?: string | null;
  date_joined?: string;
};

export type CreateUserPayload = {
  username: string;
  full_name?: string;
  email?: string;
  role: UserRole;
  password: string;
};

export type VehicleStatus =
  | 'announced'
  | 'checked_in'
  | 'available'
  | 'reserved'
  | 'loaned'
  | 'maintenance'
  | 'damaged'
  | 'manufacturer_checkout'
  | 'archived';

export type LoanStatus = 'active' | 'returned' | 'cancelled';
export type ReservationStatus = 'active' | 'cancelled';
export type CompanyType = 'subcontractor' | 'manufacturer' | 'supplier' | 'internal';
export type MediaType = 'photo' | 'signature' | 'pdf' | 'import';

export type VehicleCategory = {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
};

export type Vehicle = {
  id: string;
  qr_code: string;
  internal_number: string;
  category: string | VehicleCategory | null;
  manufacturer: string;
  model: string;
  serial_number?: string;
  license_plate?: string;
  status: VehicleStatus;
  current_odometer_km?: number | null;
  current_operating_hours?: string | number | null;
  current_location?: string;
  notes?: string;
  manufacturer_return_due?: string | null;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Reservation = {
  id: string;
  vehicle: string;
  start_at: string;
  end_at: string;
  driver?: string | null;
  company?: string | null;
  reserved_for?: string;
  notes?: string;
  status: ReservationStatus;
  created_by?: string;
  created_at?: string;
};

export type Company = {
  id: string;
  name: string;
  company_type: CompanyType;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  is_active: boolean;
};

export type Driver = {
  id: string;
  company?: string | null;
  first_name: string;
  last_name: string;
  full_name?: string;
  phone?: string;
  email?: string;
  license_classes?: string;
  notes?: string;
  is_active: boolean;
};

export type MediaFile = {
  id: string;
  vehicle?: string | null;
  loan?: string | null;
  damage_report?: string | null;
  related_type?: string;
  related_id?: string | null;
  media_type: MediaType;
  original_filename: string;
  content_type?: string;
  size_bytes?: number;
  language?: string;
  download_url?: string;
  created_at?: string;
};

export type Loan = {
  id: string;
  vehicle: string;
  company?: string | null;
  driver?: string | null;
  borrower_name?: string;
  borrower_phone?: string;
  expected_return_at: string;
  actual_return_at?: string | null;
  status: LoanStatus;
  checkout_odometer_km?: number | null;
  checkout_operating_hours?: string | number | null;
  return_odometer_km?: number | null;
  return_operating_hours?: string | number | null;
  checkout_notes?: string;
  return_notes?: string;
  checkout_pdf_media?: string | null;
  return_pdf_media?: string | null;
  checkout_snapshot?: Record<string, unknown>;
  return_snapshot?: Record<string, unknown>;
  checkout_pdf_generation_error?: string;
  return_pdf_generation_error?: string;
  created_at?: string;
};

export type CheckInProtocol = {
  id: string;
  vehicle: string;
  performed_at: string;
  supplier_company?: string | null;
  odometer_km?: number | null;
  operating_hours?: string | number | null;
  condition_notes?: string;
  pdf_media?: string | null;
  snapshot?: Record<string, unknown>;
  pdf_generation_error?: string;
  created_at?: string;
};

export type ManufacturerCheckoutProtocol = {
  id: string;
  vehicle: string;
  performed_at: string;
  recipient_company?: string | null;
  odometer_km?: number | null;
  operating_hours?: string | number | null;
  condition_notes?: string;
  pdf_media?: string | null;
  snapshot?: Record<string, unknown>;
  pdf_generation_error?: string;
  created_at?: string;
};

export type DamageReport = {
  id: string;
  vehicle: string;
  description: string;
  severity?: string;
  workflow_phase?: string;
  discovered_at?: string;
  resolved_at?: string | null;
  resolution_notes?: string;
};

export type VehicleHistory = {
  loans: Loan[];
  reservations: Reservation[];
  check_ins: CheckInProtocol[];
  manufacturer_checkouts: ManufacturerCheckoutProtocol[];
  damages: DamageReport[];
  media: MediaFile[];
};

export type ImportSourceColumn = {
  index: number;
  label: string;
  sample?: string;
};

export type ImportJob = {
  id: string;
  import_type: string;
  source_media?: string | null;
  status: 'uploaded' | 'pending' | 'validated' | 'failed' | 'committed' | string;
  row_count: number;
  error_count: number;
  result?: {
    rows?: Array<{
      row_number: number;
      action?: string;
      errors?: Array<{ field: string; message: string }>;
      data?: Record<string, unknown>;
    }>;
    columns?: string[];
    required_columns?: string[];
    source_columns?: ImportSourceColumn[];
    mapping?: Record<string, number>;
    suggested_mapping?: Record<string, number>;
    errors?: Array<{ field?: string; code?: string; message: string }>;
    commit?: { created_count?: number; updated_count?: number };
    [key: string]: unknown;
  };
  committed_at?: string | null;
  created_at?: string;
};

export type VehicleQrResolution = {
  vehicle: Vehicle;
  active_loan: Loan | null;
};

export type PublicVehicleStatus = {
  qr_code: string;
  internal_number: string;
  manufacturer: string;
  model: string;
  category: string | null;
  status: VehicleStatus;
  license_plate?: string;
  serial_number?: string;
  current_location?: string;
};

export type DashboardTotals = {
  vehicles: number;
  operational: number;
  available: number;
  loaned: number;
  maintenance: number;
  damaged: number;
  manufacturer_checkout: number;
  announced: number;
  archived: number;
  active_loans: number;
  overdue_loans: number;
  utilization_pct: number;
  upcoming_reservations: number;
  reservation_conflicts: number;
};

export type DashboardReservation = {
  id: string;
  vehicle: string;
  vehicle_label: string;
  reserved_for: string;
  company: string | null;
  driver: string | null;
  start_at: string;
  end_at: string;
  conflict: boolean;
};

export type DashboardSummary = {
  generated_at: string;
  totals: DashboardTotals;
  status_distribution: { status: VehicleStatus; count: number }[];
  checkouts_series: { date: string; count: number }[];
  available_by_category: { id: string; name: string; total: number; available: number }[];
  reservations: DashboardReservation[];
  recent_loans: {
    id: string;
    vehicle_label: string;
    borrower: string;
    status: LoanStatus;
    created_at: string | null;
    expected_return_at: string | null;
  }[];
  attention: {
    overdue_loans: { id: string; vehicle_label: string; borrower: string; expected_return_at: string }[];
    damaged_vehicles: { id: string; label: string; status: VehicleStatus }[];
  };
};

export type VehicleFilters = {
  status?: string;
  category?: string;
  search?: string;
  is_available?: boolean;
};

export function displayVehicleName(vehicle?: Vehicle | null) {
  if (!vehicle) {
    return '';
  }
  return [vehicle.internal_number, vehicle.manufacturer, vehicle.model].filter(Boolean).join(' · ');
}

export function displayDriverName(driver?: Driver | null) {
  if (!driver) {
    return '';
  }
  return driver.full_name || [driver.first_name, driver.last_name].filter(Boolean).join(' ');
}

export function mediaDownloadUrl(media: Pick<MediaFile, 'id' | 'download_url'>) {
  return media.download_url || buildApiUrl(`/media/${media.id}/download/`);
}

export async function loginWithPassword(username: string, password: string) {
  return apiClient.post<CurrentUser>('/auth/login/', { username, password });
}

export async function logoutSession() {
  return apiClient.post<void>('/auth/logout/');
}

export async function getCurrentUser() {
  return apiClient.get<CurrentUser>('/auth/me/');
}

export async function listUsers() {
  return fetchAllPages<ManagedUser>('/users/');
}

export async function createUser(payload: CreateUserPayload) {
  return apiClient.post<ManagedUser>('/users/', payload as unknown as Record<string, unknown>);
}

export async function updateUser(id: string, payload: Partial<ManagedUser> & { password?: string }) {
  return apiClient.patch<ManagedUser>(`/users/${id}/`, payload as Record<string, unknown>);
}

export async function setUserPassword(id: string, payload: { current_password?: string; new_password: string }) {
  return apiClient.post<void>(`/users/${id}/set-password/`, payload);
}

export async function deactivateUser(id: string) {
  return apiClient.post<ManagedUser>(`/users/${id}/deactivate/`);
}

function pathWithQuery(path: string, query: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function getDashboardSummary() {
  return apiClient.get<DashboardSummary>('/dashboard/summary/');
}

export async function listVehiclePage(filters: VehicleFilters = {}, page = 1): Promise<PageResult<Vehicle>> {
  const response = await apiClient.get<Vehicle[] | PaginatedResponse<Vehicle>>(
    pathWithQuery('/vehicles/', { ...filters, page }),
  );
  return normalizePage(response, page);
}

export async function listVehicles(filters: VehicleFilters = {}) {
  return fetchAllPages<Vehicle>(pathWithQuery('/vehicles/', filters));
}

export async function getVehicle(id: string) {
  return apiClient.get<Vehicle>(`/vehicles/${id}/`);
}

export type CreateVehiclePayload = {
  category: string;
  manufacturer: string;
  model: string;
  internal_number?: string;
  serial_number?: string;
  license_plate?: string;
  current_location?: string;
  current_odometer_km?: number;
  current_operating_hours?: string;
  notes?: string;
  status?: VehicleStatus;
  media_file_ids?: string[];
  initial_damage_reports?: Array<{
    description: string;
    severity?: DamageSeverity;
    media_file_ids?: string[];
  }>;
};

export async function createVehicle(payload: CreateVehiclePayload) {
  return apiClient.post<Vehicle>('/vehicles/', payload as unknown as Record<string, unknown>);
}

export async function updateVehicle(id: string, payload: Partial<CreateVehiclePayload>) {
  return apiClient.patch<Vehicle>(`/vehicles/${id}/`, payload as Record<string, unknown>);
}

export async function archiveVehicle(id: string) {
  return apiClient.post<Vehicle>(`/vehicles/${id}/archive/`);
}

export type DamageSeverity = 'unknown' | 'minor' | 'major' | 'critical';

export type CreateDamageReportPayload = {
  vehicle: string;
  description: string;
  severity?: DamageSeverity;
  workflow_phase?: string;
  discovered_at?: string;
};

export async function createDamageReport(payload: CreateDamageReportPayload) {
  return apiClient.post<DamageReport>('/damage-reports/', payload as unknown as Record<string, unknown>);
}

export async function discardMedia(id: string) {
  return apiClient.post<void>(`/media/${id}/discard/`);
}

export async function resolveVehicleQrCode(qrCode: string) {
  return apiClient.get<VehicleQrResolution>(`/vehicles/qr/${encodeURIComponent(qrCode)}/`);
}

export async function getPublicVehicleStatus(qrCode: string) {
  return apiClient.get<PublicVehicleStatus>(`/public/vehicles/qr/${encodeURIComponent(qrCode)}/`);
}

export async function getVehicleHistory(id: string) {
  return apiClient.get<VehicleHistory>(`/vehicles/${id}/history/`);
}

export async function listVehicleCategories() {
  return fetchAllPages<VehicleCategory>('/vehicle-categories/');
}

export async function createVehicleCategory(payload: Pick<VehicleCategory, 'name'> & Partial<VehicleCategory>) {
  return apiClient.post<VehicleCategory>('/vehicle-categories/', payload as Record<string, unknown>);
}

export async function updateVehicleCategory(id: string, payload: Partial<VehicleCategory>) {
  return apiClient.patch<VehicleCategory>(`/vehicle-categories/${id}/`, payload as Record<string, unknown>);
}

export async function deactivateVehicleCategory(id: string) {
  return apiClient.post<VehicleCategory>(`/vehicle-categories/${id}/deactivate/`);
}

export async function listCompanies() {
  return fetchAllPages<Company>('/companies/');
}

export async function createCompany(payload: Partial<Company>) {
  return apiClient.post<Company>('/companies/', payload as Record<string, unknown>);
}

export async function updateCompany(id: string, payload: Partial<Company>) {
  return apiClient.patch<Company>(`/companies/${id}/`, payload as Record<string, unknown>);
}

export async function deleteCompany(id: string) {
  return apiClient.delete<void>(`/companies/${id}/`);
}

export async function listDrivers() {
  return fetchAllPages<Driver>('/drivers/');
}

export async function createDriver(payload: Partial<Driver>) {
  return apiClient.post<Driver>('/drivers/', payload as Record<string, unknown>);
}

export async function updateDriver(id: string, payload: Partial<Driver>) {
  return apiClient.patch<Driver>(`/drivers/${id}/`, payload as Record<string, unknown>);
}

export async function listLoans() {
  return fetchAllPages<Loan>('/loans/');
}

export type ReservationFilters = { vehicle?: string; status?: ReservationStatus };

export async function listReservations(filters: ReservationFilters = {}) {
  return fetchAllPages<Reservation>(pathWithQuery('/reservations/', filters));
}

export async function createReservation(payload: Record<string, unknown>) {
  return apiClient.post<Reservation>('/reservations/', payload);
}

export async function cancelReservation(id: string) {
  return apiClient.post<Reservation>(`/reservations/${id}/cancel/`);
}

export async function scheduleManufacturerReturn(vehicleId: string, due: string | null) {
  return apiClient.post<Vehicle>(`/vehicles/${vehicleId}/schedule-manufacturer-return/`, {
    manufacturer_return_due: due ?? '',
  });
}

export async function uploadMedia(file: File | Blob, metadata: { media_type: 'photo' | 'signature' }) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('media_type', metadata.media_type);
  return apiClient.post<MediaFile>('/media/', formData);
}

export async function createCheckIn(payload: Record<string, unknown>) {
  return apiClient.post<CheckInProtocol>('/workflows/check-ins/', payload);
}

export async function createLoanCheckout(payload: Record<string, unknown>) {
  return apiClient.post<Loan>('/loans/', payload);
}

export async function returnLoan(id: string, payload: Record<string, unknown>) {
  return apiClient.post<Loan>(`/loans/${id}/return/`, payload);
}

export async function createManufacturerCheckout(payload: Record<string, unknown>) {
  return apiClient.post<ManufacturerCheckoutProtocol>('/workflows/manufacturer-checkouts/', payload);
}

export async function generateCheckInPdf(id: string, language: string) {
  return apiClient.post<MediaFile>(`/workflows/check-ins/${id}/generate-pdf/`, { language });
}

export async function generateLoanCheckoutPdf(id: string, language: string) {
  return apiClient.post<MediaFile>(`/loans/${id}/generate-checkout-pdf/`, { language });
}

export async function generateLoanReturnPdf(id: string, language: string) {
  return apiClient.post<MediaFile>(`/loans/${id}/generate-return-pdf/`, { language });
}

export async function generateManufacturerCheckoutPdf(id: string, language: string) {
  return apiClient.post<MediaFile>(`/workflows/manufacturer-checkouts/${id}/generate-pdf/`, { language });
}

export type GeneratedDocument = {
  id: string;
  vehicle: string | null;
  vehicle_label: string;
  loan: string | null;
  related_type: string;
  media_type: MediaType;
  original_filename: string;
  language?: string;
  download_url?: string;
  created_at?: string;
};

export type DocumentFilters = {
  search?: string;
  vehicle?: string;
  type?: string;
  language?: string;
};

export async function listDocumentPage(filters: DocumentFilters = {}, page = 1): Promise<PageResult<GeneratedDocument>> {
  const response = await apiClient.get<GeneratedDocument[] | PaginatedResponse<GeneratedDocument>>(
    pathWithQuery('/documents/', { ...filters, page }),
  );
  return normalizePage(response, page);
}

export async function listDocuments(filters: DocumentFilters = {}) {
  return fetchAllPages<GeneratedDocument>(pathWithQuery('/documents/', filters));
}

export async function uploadVehicleImport(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post<ImportJob>('/imports/vehicles/', formData);
}

export async function remapVehicleImport(id: string, mapping: Record<string, number>) {
  return apiClient.post<ImportJob>(`/imports/${id}/remap/`, { mapping });
}

export async function commitVehicleImport(id: string) {
  return apiClient.post<ImportJob>(`/imports/${id}/commit/`);
}
