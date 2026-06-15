import { describe, expect, it } from 'vitest';

import { parseQrTarget, publicVehiclePath } from './QRAccessPage';

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
