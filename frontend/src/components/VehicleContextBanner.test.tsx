import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '../i18n';
import { VehicleContextBanner, vehicleSearchLabel } from './VehicleContextBanner';

const vehicle = {
  id: 'veh-1',
  qr_code: 'QR-1',
  internal_number: 'FZ-1',
  category: 'cat-1',
  manufacturer: 'Acme',
  model: 'Lift',
  license_plate: 'B-AB 1',
  serial_number: 'SN-1',
  current_location: 'Berlin',
  status: 'damaged' as const,
};

describe('VehicleContextBanner', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('keeps plate, serial, location, and status in workflow search labels', () => {
    expect(vehicleSearchLabel(vehicle, 'Damaged', 'Lift'))
      .toBe('FZ-1 · B-AB 1 · SN-1 — Lift · Berlin · Damaged');
  });

  it('renders persistent identity, meter, damage, reservation, and thumbnail context', () => {
    render(
      <VehicleContextBanner
        context={{
          vehicle,
          meter: { mode: 'both', odometer_km: 123, operating_hours: '45.5' },
          active_loan: null,
          open_damages: [{
            id: 'damage-1',
            vehicle: 'veh-1',
            description: 'Bent rail',
            discovered_at: '2026-07-16T10:00:00Z',
          }],
          reservations: [{
            id: 'res-1',
            vehicle: 'veh-1',
            start_at: '2026-07-18T10:00:00Z',
            end_at: '2026-07-18T12:00:00Z',
            reserved_for: 'Crew',
            status: 'active',
          }],
          active_maintenance: null,
          capabilities: {},
        }}
        category={{ id: 'cat-1', name: 'Lift', meter_mode: 'both', is_active: true }}
        thumbnailUrl="/api/v1/media/photo-1/download/"
      />,
    );

    const banner = screen.getByRole('region', { name: 'Selected vehicle' });
    expect(banner).toHaveTextContent('B-AB 1');
    expect(banner).toHaveTextContent('SN-1');
    expect(banner).toHaveTextContent('123 km');
    expect(banner).toHaveTextContent('45.5');
    expect(banner).toHaveTextContent('1');
    expect(screen.getByRole('img', { name: 'Latest photo of FZ-1' }))
      .toHaveAttribute('src', '/api/v1/media/photo-1/download/');
  });
});
