import { describe, expect, it } from 'vitest';

import {
  canArchive,
  canCheckIn,
  canLoan,
  canManufacturerCheckout,
  canReturnLoan,
} from './capabilities';

describe('workflow capability matrix', () => {
  it('only permits checkout and check-in from their exact eligible statuses', () => {
    expect(canLoan('operations', 'available')).toBe(true);
    expect(canLoan('operations', 'reserved')).toBe(false);
    expect(canLoan('readonly', 'available')).toBe(false);
    expect(canCheckIn('operations', 'announced')).toBe(true);
    expect(canCheckIn('operations', 'checked_in')).toBe(false);
  });

  it('prevents manufacturer checkout for announced, loaned, and archived vehicles', () => {
    expect(canManufacturerCheckout('operations', 'available')).toBe(true);
    expect(canManufacturerCheckout('operations', 'damaged')).toBe(true);
    expect(canManufacturerCheckout('operations', 'announced')).toBe(false);
    expect(canManufacturerCheckout('operations', 'checked_in')).toBe(false);
    expect(canManufacturerCheckout('operations', 'reserved')).toBe(false);
    expect(canManufacturerCheckout('operations', 'loaned')).toBe(false);
    expect(canManufacturerCheckout('operations', 'maintenance')).toBe(false);
    expect(canManufacturerCheckout('operations', 'archived')).toBe(false);
  });

  it('restricts active-loan returns and archival by role and state', () => {
    expect(canReturnLoan('operations', { status: 'active' } as never)).toBe(true);
    expect(canReturnLoan('operations', { status: 'returned' } as never)).toBe(false);
    expect(canArchive('admin', 'manufacturer_checkout')).toBe(true);
    expect(canArchive('operations', 'manufacturer_checkout')).toBe(false);
    expect(canArchive('admin', 'available')).toBe(false);
  });
});
