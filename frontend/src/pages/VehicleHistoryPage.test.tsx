import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { VehicleHistoryPage } from './VehicleHistoryPage';

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  const vehicles = [
    {
      id: 'v-available',
      qr_code: 'QR-1',
      internal_number: 'FZ-00001',
      category: 'cat-1',
      manufacturer: 'A',
      model: 'M1',
      status: 'available',
    },
    {
      id: 'v-manufacturer',
      qr_code: 'QR-2',
      internal_number: 'FZ-00002',
      category: 'cat-1',
      manufacturer: 'A',
      model: 'M2',
      status: 'manufacturer_checkout',
    },
  ];
  const categories = [{ id: 'cat-1', name: 'Steiger', is_active: true }];

  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/vehicle-categories/')) return jsonResponse(categories);
    if (url.includes('/vehicles/')) return jsonResponse(vehicles);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('VehicleHistoryPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists all vehicles including manufacturer check-out status', async () => {
    render(
      <MemoryRouter>
        <VehicleHistoryPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Fahrzeughistorie' })).toBeInTheDocument();
    expect(document.querySelector('.status-badge--manufacturer_checkout')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Komplette Historie öffnen' })).toHaveLength(2);
  });
});
