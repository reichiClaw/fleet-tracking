import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import i18n from '../i18n';
import { VehicleDetailPage } from './VehicleDetailPage';

const vehicle = {
  id: 'veh-1',
  qr_code: 'QR-1',
  internal_number: 'FZ-1',
  category: null,
  manufacturer: 'Acme',
  model: 'Lift',
  status: 'manufacturer_checkout',
};

const history = {
  loans: [],
  reservations: [],
  check_ins: [],
  manufacturer_checkouts: [],
  damages: [{
    id: 'damage-1',
    vehicle: 'veh-1',
    description: 'Bent guard rail',
    severity: 'major',
    discovered_at: '2026-07-16T12:00:00Z',
    resolved_at: null,
  }],
  media: [{
    id: 'media-1',
    vehicle: 'veh-1',
    damage_report: 'damage-1',
    media_type: 'photo',
    original_filename: 'guard-rail.jpg',
    download_url: '/files/guard-rail.jpg',
  }],
};

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('VehicleDetailPage hardening', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'csrftoken=test-token; path=/';
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/me/')) {
        return response({ username: 'admin', display_name: 'Admin', role: 'admin' });
      }
      if (url.endsWith('/vehicles/veh-1/history/')) return response(history);
      if (url.endsWith('/vehicles/veh-1/') && method === 'GET') return response(vehicle);
      if (url.endsWith('/vehicle-categories/')) return response([]);
      if (url.endsWith('/drivers/')) return response([]);
      if (url.endsWith('/vehicles/veh-1/archive/') && method === 'POST') {
        return response({ ...vehicle, status: 'archived', archived_at: '2026-07-16T13:00:00Z' });
      }
      return response({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
    }));
    await i18n.changeLanguage('en');
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/app/vehicles/veh-1']}>
        <AuthProvider>
          <Routes>
            <Route path="/app/vehicles/:vehicleId" element={<VehicleDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('renders unresolved damage severity, time, and attached media prominently', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Unresolved damage (1)' })).toBeInTheDocument();
    expect(screen.getByText('Bent guard rail')).toBeInTheDocument();
    expect(screen.getByText('Major')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'guard-rail.jpg' })).toHaveAttribute('href', '/files/guard-rail.jpg');
    expect(screen.getByText(/16 Jul 2026/)).toBeInTheDocument();
  });

  it('archives with confirmation while preserving the detail page', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive vehicle' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive vehicle' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Vehicle archived'));
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /FZ-1/ })).toBeInTheDocument();
  });
});
