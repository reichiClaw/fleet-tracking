import { describe, expect, it } from 'vitest';

import { buildVehicleQrCsv, parseQrTarget, publicVehiclePath } from './QRAccessPage';
import type { Vehicle } from '../api/fleet';

describe('publicVehiclePath', () => {
  it('builds the single public status path for a vehicle QR code', () => {
    expect(publicVehiclePath('VH-ABC234XYZ9')).toBe('/v/VH-ABC234XYZ9');
  });
});

describe('parseQrTarget', () => {
  it('resolves a full status URL on the same origin to its in-app path', () => {
    const url = `${window.location.origin}/v/VH-ABC234XYZ9`;
    expect(parseQrTarget(url)).toBe('/v/VH-ABC234XYZ9');
  });

  it('accepts a bare public status path', () => {
    expect(parseQrTarget('/v/VH-ABC234XYZ9')).toBe('/v/VH-ABC234XYZ9');
  });

  it('accepts a bare vehicle code and maps it to the status path', () => {
    expect(parseQrTarget('VH-ABC234XYZ9')).toBe('/v/VH-ABC234XYZ9');
  });

  it('rejects unrelated or off-origin values', () => {
    expect(parseQrTarget('https://evil.example.com/v/VH-ABC234XYZ9')).toBeNull();
    expect(parseQrTarget('not-a-code')).toBeNull();
    expect(parseQrTarget('')).toBeNull();
  });
});

describe('buildVehicleQrCsv', () => {
  const vehicles: Vehicle[] = [
    {
      id: 'veh-1',
      qr_code: 'VH-ABC234XYZ9',
      internal_number: 'FZ-00001',
      category: null,
      manufacturer: 'Acme',
      model: 'TH100',
      serial_number: 'SN-1',
      license_plate: 'B-XX-1',
      status: 'available',
    },
  ];

  it('produces a header row and one quoted row per vehicle with the public URL', () => {
    const csv = buildVehicleQrCsv(vehicles, 'https://fleet.example.com');
    const lines = csv.split('\r\n');

    expect(lines[0]).toBe(
      '"internal_number","manufacturer","model","serial_number","license_plate","status","qr_code","status_url"',
    );
    expect(lines[1]).toBe(
      '"FZ-00001","Acme","TH100","SN-1","B-XX-1","available","VH-ABC234XYZ9","https://fleet.example.com/v/VH-ABC234XYZ9"',
    );
  });

  it('escapes embedded quotes', () => {
    const csv = buildVehicleQrCsv(
      [{ ...vehicles[0], manufacturer: 'Ac"me' }],
      'https://fleet.example.com',
    );
    expect(csv.split('\r\n')[1]).toContain('"Ac""me"');
  });
});
