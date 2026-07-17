import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { ReservationsPage } from './ReservationsPage';

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
  status: 'available',
};

let reservationPayload: Record<string, unknown> | null;
let draftVersion: number;

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/vehicles/veh-1/workflow-context/')) {
      return response({
        vehicle,
        meter: { mode: 'none', odometer_km: null, operating_hours: null },
        active_loan: null,
        open_damages: [],
        reservations: [],
        active_maintenance: null,
        capabilities: { can_reserve: true },
      });
    }
    if (url.endsWith('/vehicles/veh-1/media/')) return response([]);
    if (url.endsWith('/vehicle-categories/cat-1/')) {
      return response({ id: 'cat-1', name: 'Lift', meter_mode: 'none', is_active: true });
    }
    if (url.includes('/reservations/?vehicle=veh-1')) {
      return response({ count: 0, next: null, previous: null, results: [] });
    }
    if (url.endsWith('/workflow-drafts/') && method === 'POST') {
      draftVersion += 1;
      const body = JSON.parse(String(init?.body));
      return response({
        id: 'draft-reservation',
        owner: 'user-1',
        version: draftVersion,
        expires_at: '2026-08-01T00:00:00Z',
        created_at: '2026-07-17T00:00:00Z',
        updated_at: '2026-07-17T00:00:00Z',
        ...body,
      }, draftVersion === 1 ? 201 : 200);
    }
    if (url.endsWith('/workflow-drafts/draft-reservation/discard/') && method === 'POST') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/reservations/') && method === 'POST') {
      reservationPayload = JSON.parse(String(init?.body));
      return response({
        id: 'res-1',
        status: 'active',
        reserved_for: reservationPayload?.reserved_for,
        manual_phone: reservationPayload?.manual_phone,
        ...reservationPayload,
      }, 201);
    }
    return response({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
  }));
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '*', element: <ReservationsPage /> }],
    { initialEntries: ['/app/reservations?vehicle=veh-1'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('ReservationsPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    reservationPayload = null;
    draftVersion = 0;
    installFetchMock();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a manual-party reservation after showing immediate eligibility', async () => {
    renderPage();
    expect(await screen.findByRole('region', { name: 'Selected vehicle' })).toHaveTextContent('SN-1');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.click(screen.getByRole('button', { name: 'Manual contact' }));
    fireEvent.change(screen.getByLabelText('Reserved for'), { target: { value: 'External Crew' } });
    fireEvent.change(screen.getByLabelText('Borrower phone'), { target: { value: '+49 170 99' } });
    expect(screen.getByText('This period is currently eligible.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Bring identification' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reserve vehicle' }));

    expect(await screen.findByText('Reservation created.')).toBeInTheDocument();
    expect(reservationPayload).toMatchObject({
      vehicle: 'veh-1',
      reserved_for: 'External Crew',
      manual_phone: '+49 170 99',
      notes: 'Bring identification',
    });
    expect(reservationPayload).not.toHaveProperty('driver');
    expect(reservationPayload).not.toHaveProperty('company');
  });
});
