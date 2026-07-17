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
  category: 'cat-1',
  manufacturer: 'Acme',
  model: 'Lift',
  license_plate: 'B-AB 1',
  serial_number: 'SN-1',
  current_location: 'Berlin',
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

const context = {
  vehicle,
  meter: { mode: 'both', odometer_km: 100, operating_hours: '12.5' },
  active_loan: null,
  open_damages: history.damages,
  reservations: [],
  active_maintenance: null,
  capabilities: {
    can_archive: true,
    can_send_to_maintenance: false,
    can_complete_maintenance: false,
  },
};

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('VehicleDetailPage hardening', () => {
  let archivePayload: Record<string, unknown> | null;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'csrftoken=test-token; path=/';
    archivePayload = null;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/auth/me/')) {
        return response({ username: 'admin', display_name: 'Admin', role: 'admin' });
      }
      if (url.endsWith('/vehicles/veh-1/history/')) return response(history);
      if (url.endsWith('/vehicles/veh-1/workflow-context/')) return response(context);
      if (url.endsWith('/vehicles/veh-1/media/')) return response(history.media);
      if (url.endsWith('/vehicle-categories/cat-1/')) {
        return response({ id: 'cat-1', name: 'Lift', meter_mode: 'both', is_active: true });
      }
      if (url.endsWith('/vehicle-categories/')) return response([]);
      if (url.endsWith('/vehicles/veh-1/archive/') && method === 'POST') {
        archivePayload = JSON.parse(String(init?.body));
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

  it('renders persistent identity, current damage evidence, and timeline', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'FZ-1 · Acme · Lift' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Selected vehicle' })).toHaveTextContent('B-AB 1');
    expect(screen.getByRole('region', { name: 'Selected vehicle' })).toHaveTextContent('SN-1');
    expect(screen.getByRole('heading', { name: 'Current condition' })).toBeInTheDocument();
    expect(screen.getAllByText('Bent guard rail').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('heading', { name: 'Condition and workflow timeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Damage reported' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /guard-rail\.jpg/ })[0])
      .toHaveAttribute('href', '/files/guard-rail.jpg');
  });

  it('requires an archive reason and sends it after confirmation', async () => {
    renderPage();
    const archive = await screen.findByRole('button', { name: 'Archive vehicle' });
    fireEvent.click(archive);
    expect((await screen.findAllByText('Enter the reason for archiving this vehicle.')).length)
      .toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText('Archive reason'), { target: { value: 'Returned asset retired' } });
    fireEvent.click(screen.getByRole('button', { name: 'Archive vehicle' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive vehicle' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Vehicle archived'));
    expect(archivePayload).toEqual({ reason: 'Returned asset retired' });
  });
});
