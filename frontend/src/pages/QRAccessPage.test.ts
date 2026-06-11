import { describe, expect, it } from 'vitest';

import { vehicleQrTargets } from './QRAccessPage';
import type { Loan, Vehicle } from '../api/fleet';

const vehicle: Vehicle = {
  id: 'vehicle-uuid',
  qr_code: 'VH-ABC234XYZ9',
  internal_number: 'VH-001',
  category: null,
  manufacturer: 'Acme',
  model: 'Lift',
  status: 'available',
};

const t = (key: string) => key;

describe('vehicleQrTargets', () => {
  it('uses generated QR codes in URLs instead of database IDs', () => {
    const targets = vehicleQrTargets(vehicle, undefined, t);

    expect(targets.map((target) => target.path)).toEqual([
      '/app/qr/v/VH-ABC234XYZ9?action=details',
      '/app/qr/v/VH-ABC234XYZ9?action=loan-checkout',
    ]);
    expect(targets.some((target) => target.path.includes(vehicle.id))).toBe(false);
  });

  it('uses generated QR code URLs for active loan returns instead of loan IDs', () => {
    const loan: Loan = {
      id: 'loan-uuid',
      vehicle: vehicle.id,
      expected_return_at: new Date().toISOString(),
      status: 'active',
    };

    const targets = vehicleQrTargets({ ...vehicle, status: 'loaned' }, loan, t);

    expect(targets.map((target) => target.path)).toEqual([
      '/app/qr/v/VH-ABC234XYZ9?action=details',
      '/app/qr/v/VH-ABC234XYZ9?action=loan-return',
    ]);
    expect(targets.some((target) => target.path.includes(loan.id))).toBe(false);
  });
});
