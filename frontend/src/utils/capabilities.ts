import type { Loan, UserRole, VehicleStatus } from '../api/fleet';

export const MANUFACTURER_CHECKOUT_STATUSES = new Set<VehicleStatus>([
  'checked_in',
  'available',
  'maintenance',
  'damaged',
]);

export function canMutate(role?: UserRole | null) {
  return role === 'admin' || role === 'operations';
}

export function canCheckIn(role: UserRole | undefined, status: VehicleStatus) {
  return canMutate(role) && status === 'announced';
}

export function canLoan(role: UserRole | undefined, status: VehicleStatus) {
  return canMutate(role) && status === 'available';
}

export function canReturnLoan(role: UserRole | undefined, loan?: Loan | null) {
  return canMutate(role) && loan?.status === 'active';
}

export function canManufacturerCheckout(role: UserRole | undefined, status: VehicleStatus) {
  return canMutate(role) && MANUFACTURER_CHECKOUT_STATUSES.has(status);
}

export function canArchive(role: UserRole | undefined, status: VehicleStatus) {
  return role === 'admin' && status === 'manufacturer_checkout';
}
