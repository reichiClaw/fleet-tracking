import { apiClient, buildApiUrl } from './client';

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
export type CompanyType = 'subcontractor' | 'manufacturer' | 'supplier' | 'internal';
export type MediaType = 'photo' | 'signature' | 'pdf' | 'import';

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type VehicleCategory = {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
};

export type Vehicle = {
  id: string;
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
  created_at?: string;
  updated_at?: string;
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
  created_at?: string;
};

export type DamageReport = {
  id: string;
  vehicle: string;
  description: string;
  severity?: string;
  discovered_at?: string;
  status?: string;
};

export type VehicleHistory = {
  loans: Loan[];
  check_ins: CheckInProtocol[];
  manufacturer_checkouts: ManufacturerCheckoutProtocol[];
  damages: DamageReport[];
  media: MediaFile[];
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
    [key: string]: unknown;
  };
  committed_at?: string | null;
  created_at?: string;
};

export type DashboardSummary = Record<string, number>;

export type VehicleFilters = {
  status?: string;
  category?: string;
  search?: string;
  is_available?: boolean;
};

function listFromResponse<T>(response: T[] | PaginatedResponse<T>): T[] {
  return Array.isArray(response) ? response : response.results;
}

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

export async function listVehicles(filters: VehicleFilters = {}) {
  const response = await apiClient.get<Vehicle[] | PaginatedResponse<Vehicle>>(pathWithQuery('/vehicles/', filters));
  return listFromResponse(response);
}

export async function getVehicle(id: string) {
  return apiClient.get<Vehicle>(`/vehicles/${id}/`);
}

export async function getVehicleHistory(id: string) {
  return apiClient.get<VehicleHistory>(`/vehicles/${id}/history/`);
}

export async function listVehicleCategories() {
  const response = await apiClient.get<VehicleCategory[] | PaginatedResponse<VehicleCategory>>('/vehicle-categories/');
  return listFromResponse(response);
}

export async function listCompanies() {
  const response = await apiClient.get<Company[] | PaginatedResponse<Company>>('/companies/');
  return listFromResponse(response);
}

export async function createCompany(payload: Partial<Company>) {
  return apiClient.post<Company>('/companies/', payload as Record<string, unknown>);
}

export async function listDrivers() {
  const response = await apiClient.get<Driver[] | PaginatedResponse<Driver>>('/drivers/');
  return listFromResponse(response);
}

export async function createDriver(payload: Partial<Driver>) {
  return apiClient.post<Driver>('/drivers/', payload as Record<string, unknown>);
}

export async function listLoans() {
  const response = await apiClient.get<Loan[] | PaginatedResponse<Loan>>('/loans/');
  return listFromResponse(response);
}

export async function uploadMedia(file: File | Blob, metadata: Partial<MediaFile> & { media_type: MediaType }) {
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(metadata).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      formData.append(key, String(value));
    }
  });
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

export async function uploadVehicleImport(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post<ImportJob>('/imports/vehicles/', formData);
}

export async function commitVehicleImport(id: string) {
  return apiClient.post<ImportJob>(`/imports/${id}/commit/`);
}
