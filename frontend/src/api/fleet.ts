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
  effective_role?: UserRole;
  capabilities?: {
    is_app_admin?: boolean;
    can_operate_workflows?: boolean;
    can_manage_users?: boolean;
    can_view_audit_log?: boolean;
  };
  must_change_password?: boolean;
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
  must_change_password?: boolean;
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
export type ReservationStatus = 'active' | 'cancelled' | 'fulfilled' | 'no_show';
export type CompanyType = 'subcontractor' | 'manufacturer' | 'supplier' | 'internal';
export type MediaType = 'photo' | 'signature' | 'pdf' | 'import';
export type ConditionOutcome = 'fit' | 'new_damage' | 'maintenance';

export type VehicleCategory = {
  id: string;
  name: string;
  description?: string;
  meter_mode?: 'odometer' | 'hours' | 'both' | 'none';
  is_active: boolean;
  vehicle_count?: number;
};

export type MeterRequirements = {
  mode: 'odometer' | 'hours' | 'both' | 'none';
  requires_odometer: boolean;
  requires_operating_hours: boolean;
  current_odometer_km?: number | null;
  current_operating_hours?: string | number | null;
};

export type VehicleCapabilities = {
  can_edit_master_data?: boolean;
  can_check_in?: boolean;
  can_loan_checkout?: boolean;
  can_loan_return?: boolean;
  can_manufacturer_return?: boolean;
  can_reserve?: boolean;
  can_send_to_maintenance?: boolean;
  can_complete_maintenance?: boolean;
  can_archive?: boolean;
  can_unarchive?: boolean;
  can_admin_correct?: boolean;
};

export type NextAction = {
  action: string;
  method: string;
  url: string;
};

export type ReservationSummary = {
  id: string;
  start_at: string;
  end_at: string;
  reserved_for: string;
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
  meter_requirements?: MeterRequirements;
  active_loan?: {
    id: string;
    borrower_name: string;
    borrower_phone?: string;
    expected_return_at: string;
  } | null;
  open_damage_count?: number;
  reservation_summary?: {
    current?: ReservationSummary | null;
    upcoming?: ReservationSummary | null;
  };
  capabilities?: VehicleCapabilities;
  next_actions?: NextAction[];
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
  manual_phone?: string;
  notes?: string;
  status: ReservationStatus;
  snapshot?: {
    party?: {
      type?: 'driver' | 'company' | 'manual';
      driver_id?: string | null;
      company_id?: string | null;
      name?: string;
      phone?: string;
      company_name?: string | null;
    };
    [key: string]: unknown;
  };
  fulfilled_at?: string | null;
  fulfilled_by?: string | null;
  loan?: string | null;
  created_by?: string;
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
  return_condition_outcome?: ConditionOutcome;
  checkout_pdf_media?: string | null;
  return_pdf_media?: string | null;
  checkout_snapshot?: Record<string, unknown>;
  return_snapshot?: Record<string, unknown>;
  checkout_pdf_generation_error?: string;
  return_pdf_generation_error?: string;
  reservation_id?: string | null;
  usage_deltas?: { odometer_km?: number | null; operating_hours?: string | null };
  warnings?: Array<{ code: string; reservation_id?: string; start_at?: string }>;
  capabilities?: Record<string, boolean>;
  next_actions?: NextAction[];
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

export type MaintenanceRecord = {
  id: string;
  vehicle: string;
  reason: string;
  start_notes?: string;
  started_at: string;
  start_odometer_km?: number | null;
  start_operating_hours?: string | null;
  completion_notes?: string;
  completed_at?: string | null;
  completion_odometer_km?: number | null;
  completion_operating_hours?: string | null;
  status: 'active' | 'completed';
};

export type VehicleTimelineEvent = {
  occurred_at: string;
  type: string;
  id: string;
  status: string;
  description?: string;
};

export type VehicleHistory = {
  loans: Loan[];
  reservations: Reservation[];
  check_ins: CheckInProtocol[];
  manufacturer_checkouts: ManufacturerCheckoutProtocol[];
  damages: DamageReport[];
  maintenance?: MaintenanceRecord[];
  timeline?: VehicleTimelineEvent[];
  media: MediaFile[];
};

export type VehicleWorkflowContext = {
  vehicle: Vehicle;
  meter: {
    mode: MeterRequirements['mode'];
    odometer_km?: number | null;
    operating_hours?: string | null;
  };
  active_loan: Loan | null;
  open_damages: DamageReport[];
  reservations: Reservation[];
  active_maintenance: MaintenanceRecord | null;
  capabilities: VehicleCapabilities;
};

export type LoanReturnContext = {
  loan_id: string;
  status: LoanStatus;
  vehicle: Vehicle & { meter_mode: MeterRequirements['mode'] };
  borrower: {
    name: string;
    phone: string;
    company_id?: string | null;
    company_name?: string | null;
    driver_id?: string | null;
  };
  expected_return_at: string;
  checkout: {
    snapshot?: Record<string, unknown>;
    odometer_km?: number | null;
    operating_hours?: string | null;
    media: MediaFile[];
  };
  open_damages: DamageReport[];
  signature_required: boolean;
};

export type WorkflowDraftType =
  | 'check_in'
  | 'loan_checkout'
  | 'loan_return'
  | 'manufacturer_return'
  | 'reservation'
  | 'maintenance';

export type WorkflowDraft = {
  id: string;
  workflow_type: WorkflowDraftType;
  scope_key: string;
  object_id?: string | null;
  form_data: Record<string, unknown>;
  staged_media_ids: string[];
  step: number;
  version: number;
  expires_at: string;
  owner: string;
  created_at: string;
  updated_at: string;
};

export type OperatorTask = {
  vehicle_id?: string;
  related_id?: string | null;
  label?: string;
  vehicle_label?: string;
  license_plate?: string;
  status: string;
  due_at?: string | null;
  performed_at?: string;
  failure_reason?: string;
  document_type?: string;
  record_id?: string;
  language?: string;
  next_action?: NextAction;
  capabilities?: VehicleCapabilities;
};

export type OperatorTaskGroup = {
  count: number;
  items: OperatorTask[];
};

export type OperatorTasks = {
  generated_at: string;
  count: number;
  groups: Record<
    | 'arrivals_awaiting_check_in'
    | 'overdue_returns'
    | 'reservation_handovers'
    | 'condition_attention'
    | 'failed_documents'
    | 'manufacturer_returns_due',
    OperatorTaskGroup
  >;
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
      errors?: Array<{ field?: string; code?: string; message: string }>;
      data?: Record<string, unknown>;
      values?: Record<string, unknown>;
      present_fields?: string[];
      diff?: Array<{
        field: string;
        old: unknown;
        new: unknown;
        changed: boolean;
        explicit_clear: boolean;
      }>;
      duplicate_candidates?: Array<{
        vehicle_id: string;
        internal_number: string;
        matched_fields: string[];
      }>;
      supplier_proposal?: {
        status: 'matched' | 'create_proposal';
        company_id?: string;
        name: string;
        company_type?: CompanyType;
        allowed_types?: CompanyType[];
      } | null;
      excluded?: boolean;
    }>;
    columns?: string[];
    required_columns?: string[];
    source_columns?: ImportSourceColumn[];
    mapping?: Record<string, number>;
    suggested_mapping?: Record<string, number>;
    errors?: Array<{ field?: string; code?: string; message: string }>;
    summary?: {
      row_count?: number;
      error_count?: number;
      create_count?: number;
      update_count?: number;
      excluded_count?: number;
    };
    commit?: { created_count?: number; updated_count?: number };
    [key: string]: unknown;
  };
  created_by?: string;
  committed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SetupReadinessItem = {
  id: 'categories' | 'supplier_or_manufacturer' | 'users' | 'vehicles' | 'qr_codes' | 'documents' | 'backup';
  ready: boolean;
  count?: number;
  announced_awaiting_check_in?: number;
  missing_count?: number;
  failed_count?: number;
  configured?: boolean;
  status?: string;
};

export type SetupReadiness = {
  ready: boolean;
  effective_role: UserRole;
  capabilities: { is_app_admin: boolean };
  admin_security: {
    active_admin_exists: boolean;
    superuser_count: number;
    temporary_password_count: number;
    debug: boolean;
    secure_cookies: boolean;
  };
  checklist: SetupReadinessItem[];
};

export type DuplicateSuggestion<T extends Company | Driver> = {
  score: number;
  reason: string;
  companies?: T[];
  drivers?: T[];
};

export type MergePreview = {
  confirmation_required: boolean;
  confirmation_token: string;
  reassignment_counts: Record<string, number>;
};

export type AuditLogEntry = {
  id: string;
  actor: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  created_at: string;
};

export type AuditLogFilters = {
  action?: string;
  entity_type?: string;
  entity_id?: string;
  actor?: string;
  date_from?: string;
  date_to?: string;
};

export type DocumentRegisterStatus = 'generated' | 'failed' | 'missing';

export type DocumentRegisterRow = {
  document_type: string;
  record_id: string;
  vehicle_id: string;
  vehicle_label: string;
  license_plate?: string;
  performed_at: string;
  creator?: string | null;
  creator_label?: string;
  language: string;
  status: DocumentRegisterStatus;
  failure_reason: string;
  media_id?: string | null;
  retry?: {
    document_type: string;
    record_id: string;
    language: string;
  } | null;
};

export type QrBulkRow = {
  id: string;
  qr_code: string;
  internal_number: string;
  license_plate?: string;
  status: VehicleStatus;
  label: string;
  public_url: string;
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
  active?: boolean;
  manufacturer?: string;
  location?: string;
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

export type UpdateUserPayload = Partial<
  Pick<ManagedUser, 'username' | 'email' | 'full_name' | 'role' | 'is_active'>
>;

export async function updateUser(id: string, payload: UpdateUserPayload) {
  return apiClient.patch<ManagedUser>(`/users/${id}/`, payload as Record<string, unknown>);
}

export async function setUserPassword(id: string, payload: { current_password?: string; new_password: string }) {
  return apiClient.post<void>(`/users/${id}/set-password/`, payload);
}

export async function setTemporaryUserPassword(id: string, newPassword: string) {
  return apiClient.post<{ must_change_password: boolean }>(`/users/${id}/set-temporary-password/`, {
    new_password: newPassword,
  });
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

export async function getDashboardSummary(signal?: AbortSignal) {
  return apiClient.get<DashboardSummary>('/dashboard/summary/', { signal });
}

export async function getDashboardTasks(limit = 25, signal?: AbortSignal) {
  return apiClient.get<OperatorTasks>(pathWithQuery('/dashboard/tasks/', { limit }), { signal });
}

export async function getSetupReadiness(signal?: AbortSignal) {
  return apiClient.get<SetupReadiness>('/setup/readiness/', { signal });
}

async function getTypeaheadPage<T>(
  path: string,
  query: Record<string, string | number | boolean | null | undefined>,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<T[] | PaginatedResponse<T>>(pathWithQuery(path, query), { signal });
  return normalizePage(response, 1);
}

export function searchVehicles(
  search: string,
  filters: VehicleFilters = {},
  signal?: AbortSignal,
) {
  return getTypeaheadPage<Vehicle>('/vehicles/typeahead/', { ...filters, search, page: 1 }, signal);
}

export function searchCompanies(search: string, signal?: AbortSignal) {
  return getTypeaheadPage<Company>('/companies/typeahead/', { search, page: 1 }, signal);
}

export function searchDrivers(search: string, signal?: AbortSignal) {
  return getTypeaheadPage<Driver>('/drivers/typeahead/', { search, page: 1 }, signal);
}

export function searchLoans(search: string, filters: { status?: LoanStatus; vehicle?: string } = {}, signal?: AbortSignal) {
  return getTypeaheadPage<Loan>('/loans/typeahead/', { ...filters, search, page: 1 }, signal);
}

export function searchReservations(
  search: string,
  filters: { vehicle?: string } = {},
  signal?: AbortSignal,
) {
  return getTypeaheadPage<Reservation>('/reservations/typeahead/', { ...filters, search, page: 1 }, signal);
}

export async function listVehiclePage(
  filters: VehicleFilters = {},
  page = 1,
  signal?: AbortSignal,
): Promise<PageResult<Vehicle>> {
  const response = await apiClient.get<Vehicle[] | PaginatedResponse<Vehicle>>(
    pathWithQuery('/vehicles/', { ...filters, page }),
    { signal },
  );
  return normalizePage(response, page);
}

export async function listVehicles(filters: VehicleFilters = {}) {
  return fetchAllPages<Vehicle>(pathWithQuery('/vehicles/', filters));
}

export async function getVehicle(id: string, signal?: AbortSignal) {
  return apiClient.get<Vehicle>(`/vehicles/${id}/`, { signal });
}

export async function getVehicleWorkflowContext(id: string, signal?: AbortSignal) {
  const context = await apiClient.get<VehicleWorkflowContext>(`/vehicles/${id}/workflow-context/`, { signal });
  return {
    ...context,
    meter: context.meter ?? {
      mode: context.vehicle.meter_requirements?.mode ?? 'none',
      odometer_km: context.vehicle.current_odometer_km,
      operating_hours: context.vehicle.current_operating_hours == null
        ? null
        : String(context.vehicle.current_operating_hours),
    },
    open_damages: context.open_damages ?? [],
    reservations: context.reservations ?? [],
    active_loan: context.active_loan ?? null,
    active_maintenance: context.active_maintenance ?? null,
    capabilities: context.capabilities ?? context.vehicle.capabilities ?? {},
  };
}

export async function getVehicleMedia(id: string, signal?: AbortSignal) {
  return apiClient.get<MediaFile[]>(`/vehicles/${id}/media/`, { signal });
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

export async function archiveVehicle(id: string, reason: string) {
  return apiClient.post<Vehicle>(`/vehicles/${id}/archive/`, { reason });
}

export async function unarchiveVehicle(id: string, reason: string) {
  return apiClient.post<Vehicle>(`/vehicles/${id}/unarchive/`, { reason });
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

export async function getVehicleHistory(id: string, signal?: AbortSignal) {
  return apiClient.get<VehicleHistory>(`/vehicles/${id}/history/`, { signal });
}

export async function listVehicleCategories() {
  return fetchAllPages<VehicleCategory>('/vehicle-categories/');
}

export async function getVehicleCategory(id: string, signal?: AbortSignal) {
  return apiClient.get<VehicleCategory>(`/vehicle-categories/${id}/`, { signal });
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

export async function reactivateVehicleCategory(id: string) {
  return apiClient.post<VehicleCategory>(`/vehicle-categories/${id}/reactivate/`);
}

export async function listCompanies() {
  return fetchAllPages<Company>('/companies/');
}

export async function getCompany(id: string, signal?: AbortSignal) {
  return apiClient.get<Company>(`/companies/${id}/`, { signal });
}

export async function createCompany(payload: Partial<Company>) {
  return apiClient.post<Company>('/companies/', payload as Record<string, unknown>);
}

export async function updateCompany(id: string, payload: Partial<Company>) {
  return apiClient.patch<Company>(`/companies/${id}/`, payload as Record<string, unknown>);
}

export async function deactivateCompany(id: string) {
  return apiClient.post<Company>(`/companies/${id}/deactivate/`);
}

export async function listCompanyDuplicates() {
  return apiClient.get<Array<DuplicateSuggestion<Company>>>('/companies/duplicates/');
}

export async function mergeCompany(id: string, targetId: string, confirmationToken?: string) {
  return apiClient.post<MergePreview | {
    source: Company;
    target: Company;
    reassignment_counts: Record<string, number>;
  }>(`/companies/${id}/merge/`, {
    target_id: targetId,
    ...(confirmationToken ? { confirmation_token: confirmationToken } : {}),
  });
}

export async function listDrivers() {
  return fetchAllPages<Driver>('/drivers/');
}

export async function getDriver(id: string, signal?: AbortSignal) {
  return apiClient.get<Driver>(`/drivers/${id}/`, { signal });
}

export async function createDriver(payload: Partial<Driver>) {
  return apiClient.post<Driver>('/drivers/', payload as Record<string, unknown>);
}

export async function updateDriver(id: string, payload: Partial<Driver>) {
  return apiClient.patch<Driver>(`/drivers/${id}/`, payload as Record<string, unknown>);
}

export async function deactivateDriver(id: string) {
  return apiClient.post<Driver>(`/drivers/${id}/deactivate/`);
}

export async function listDriverDuplicates() {
  return apiClient.get<Array<DuplicateSuggestion<Driver>>>('/drivers/duplicates/');
}

export async function mergeDriver(id: string, targetId: string, confirmationToken?: string) {
  return apiClient.post<MergePreview | {
    source: Driver;
    target: Driver;
    reassignment_counts: Record<string, number>;
  }>(`/drivers/${id}/merge/`, {
    target_id: targetId,
    ...(confirmationToken ? { confirmation_token: confirmationToken } : {}),
  });
}

export async function listLoans() {
  return fetchAllPages<Loan>('/loans/');
}

export async function getLoan(id: string, signal?: AbortSignal) {
  return apiClient.get<Loan>(`/loans/${id}/`, { signal });
}

export type ReservationFilters = { vehicle?: string; status?: ReservationStatus; search?: string };

export async function listReservationPage(
  filters: ReservationFilters = {},
  page = 1,
  signal?: AbortSignal,
): Promise<PageResult<Reservation>> {
  const response = await apiClient.get<Reservation[] | PaginatedResponse<Reservation>>(
    pathWithQuery('/reservations/', { ...filters, page }),
    { signal },
  );
  return normalizePage(response, page);
}

export async function listReservations(filters: ReservationFilters = {}) {
  return fetchAllPages<Reservation>(pathWithQuery('/reservations/', filters));
}

export async function createReservation(payload: Record<string, unknown>) {
  return apiClient.post<Reservation>('/reservations/', payload);
}

export async function getReservation(id: string, signal?: AbortSignal) {
  return apiClient.get<Reservation>(`/reservations/${id}/`, { signal });
}

export async function cancelReservation(id: string) {
  return apiClient.post<Reservation>(`/reservations/${id}/cancel/`);
}

export async function updateReservation(id: string, payload: Record<string, unknown>) {
  return apiClient.patch<Reservation>(`/reservations/${id}/`, payload);
}

export async function markReservationNoShow(id: string) {
  return apiClient.post<Reservation>(`/reservations/${id}/mark-no-show/`);
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

export async function createCheckIn(payload: Record<string, unknown>, idempotencyKey: string) {
  return apiClient.post<CheckInProtocol>('/workflows/check-ins/', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function createAndCheckIn(payload: Record<string, unknown>, idempotencyKey: string) {
  return apiClient.post<CheckInProtocol>('/workflows/check-ins/create-and-check-in/', payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export async function createLoanCheckout(payload: Record<string, unknown>) {
  return apiClient.post<Loan>('/loans/', payload);
}

export async function returnLoan(id: string, payload: Record<string, unknown>) {
  return apiClient.post<Loan>(`/loans/${id}/return/`, payload);
}

export async function getLoanReturnContext(id: string, signal?: AbortSignal) {
  const context = await apiClient.get<LoanReturnContext>(`/loans/${id}/return-context/`, { signal });
  return {
    ...context,
    open_damages: context.open_damages ?? [],
    checkout: {
      ...context.checkout,
      media: context.checkout?.media ?? [],
    },
  };
}

export async function createManufacturerCheckout(payload: Record<string, unknown>) {
  return apiClient.post<ManufacturerCheckoutProtocol>('/workflows/manufacturer-returns/', payload);
}

export async function sendVehicleToMaintenance(id: string, payload: Record<string, unknown>) {
  return apiClient.post<{ maintenance: MaintenanceRecord; vehicle: Vehicle }>(
    `/vehicles/${id}/send-to-maintenance/`,
    payload,
  );
}

export async function completeVehicleMaintenance(id: string, payload: Record<string, unknown>) {
  return apiClient.post<{ maintenance: MaintenanceRecord; vehicle: Vehicle }>(
    `/vehicles/${id}/complete-maintenance/`,
    payload,
  );
}

export async function resolveDamage(id: string, resolutionNotes: string) {
  return apiClient.post<DamageReport>(`/damage-reports/${id}/resolve/`, {
    resolution_notes: resolutionNotes,
  });
}

export async function listWorkflowDraftPage(
  workflowType?: WorkflowDraftType,
  page = 1,
  signal?: AbortSignal,
): Promise<PageResult<WorkflowDraft>> {
  const response = await apiClient.get<WorkflowDraft[] | PaginatedResponse<WorkflowDraft>>(
    pathWithQuery('/workflow-drafts/', { workflow_type: workflowType, page }),
    { signal },
  );
  return normalizePage(response, page);
}

export async function getWorkflowDraft(id: string, signal?: AbortSignal) {
  return apiClient.get<WorkflowDraft>(`/workflow-drafts/${id}/`, { signal });
}

export async function upsertWorkflowDraft(payload: {
  workflow_type: WorkflowDraftType;
  scope_key: string;
  object_id?: string | null;
  form_data: Record<string, unknown>;
  staged_media_ids: string[];
  step: number;
  expected_version?: number;
}) {
  return apiClient.post<WorkflowDraft>('/workflow-drafts/', payload as unknown as Record<string, unknown>);
}

export async function discardWorkflowDraft(id: string) {
  return apiClient.post<void>(`/workflow-drafts/${id}/discard/`);
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

export type DocumentRegisterFilters = {
  status?: DocumentRegisterStatus | 'attention' | '';
  type?: string;
  language?: string;
  search?: string;
  plate?: string;
};

export async function listDocumentRegisterPage(
  filters: DocumentRegisterFilters = {},
  page = 1,
  signal?: AbortSignal,
): Promise<PageResult<DocumentRegisterRow>> {
  const response = await apiClient.get<DocumentRegisterRow[] | PaginatedResponse<DocumentRegisterRow>>(
    pathWithQuery('/documents/register/', { ...filters, page }),
    { signal },
  );
  return normalizePage(response, page);
}

export async function retryDocuments(items: Array<{
  document_type: string;
  record_id: string;
  language: string;
}>) {
  return apiClient.post<{ count: number; results: GeneratedDocument[] }>('/documents/retry/', { items });
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

export async function excludeVehicleImportRows(id: string, rowNumbers: number[]) {
  return apiClient.post<ImportJob>(`/imports/${id}/exclude-rows/`, { row_numbers: rowNumbers });
}

export async function getImportJob(id: string, signal?: AbortSignal) {
  return apiClient.get<ImportJob>(`/imports/${id}/`, { signal });
}

export async function listImportPage(page = 1, signal?: AbortSignal): Promise<PageResult<ImportJob>> {
  const response = await apiClient.get<ImportJob[] | PaginatedResponse<ImportJob>>(
    pathWithQuery('/imports/', { page }),
    { signal },
  );
  return normalizePage(response, page);
}

export async function listAuditLogPage(
  filters: AuditLogFilters = {},
  page = 1,
  signal?: AbortSignal,
): Promise<PageResult<AuditLogEntry>> {
  const response = await apiClient.get<AuditLogEntry[] | PaginatedResponse<AuditLogEntry>>(
    pathWithQuery('/audit-logs/', { ...filters, page }),
    { signal },
  );
  return normalizePage(response, page);
}

export async function listQrBulkPage(
  filters: VehicleFilters & { include_inactive?: boolean } = {},
  page = 1,
  signal?: AbortSignal,
): Promise<PageResult<QrBulkRow>> {
  const response = await apiClient.get<QrBulkRow[] | PaginatedResponse<QrBulkRow>>(
    pathWithQuery('/vehicles/qr-bulk/', { ...filters, page }),
    { signal },
  );
  return normalizePage(response, page);
}
