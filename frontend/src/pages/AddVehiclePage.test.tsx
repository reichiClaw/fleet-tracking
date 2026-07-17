import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AddVehiclePage } from './AddVehiclePage';

let lastCreatePayload: Record<string, unknown> | null = null;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/vehicle-categories/')) {
      return jsonResponse([{ id: 'cat-1', name: 'Steiger', meter_mode: 'both', is_active: true }]);
    }
    if (url.endsWith('/vehicles/') && method === 'POST') {
      lastCreatePayload = JSON.parse(String(init?.body));
      return jsonResponse({
        id: 'veh-9',
        qr_code: 'QR-9',
        internal_number: 'FZ-00009',
        category: 'cat-1',
        manufacturer: 'Acme',
        model: 'TH-Z',
        status: 'announced',
      }, 201);
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '*', element: <AddVehiclePage /> }],
    { initialEntries: ['/app/vehicles/new'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('AddVehiclePage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastCreatePayload = null;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates only an announced record and offers a preselected check-in', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Fahrzeugdatensatz anlegen' });
    fireEvent.change(screen.getByLabelText('Hersteller'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Modell'), { target: { value: 'TH-Z' } });
    fireEvent.change(screen.getByLabelText('Seriennummer'), { target: { value: 'SN-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeugdatensatz anlegen' }));

    expect(await screen.findByRole('heading', { name: 'Fahrzeugdatensatz angelegt' })).toBeInTheDocument();
    expect(lastCreatePayload).toMatchObject({
      category: 'cat-1',
      manufacturer: 'Acme',
      model: 'TH-Z',
      serial_number: 'SN-123',
    });
    expect(lastCreatePayload).not.toHaveProperty('status');
    expect(screen.getByRole('link', { name: 'Fahrzeug einchecken' }))
      .toHaveAttribute('href', '/app/workflows/check-in?vehicle=veh-9');
  });

  it('requires category, manufacturer, and model', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Fahrzeugdatensatz anlegen' });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeugdatensatz anlegen' }));

    expect(screen.getAllByText('Bitte geben Sie den Hersteller ein.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bitte geben Sie das Modell ein.').length).toBeGreaterThan(0);
    expect(lastCreatePayload).toBeNull();
  });

  it('links to atomic create-and-check-in intake', async () => {
    renderPage();

    const intake = await screen.findByRole('link', { name: 'Fahrzeug anlegen und einchecken' });
    expect(intake).toHaveAttribute('href', '/app/workflows/intake');
  });
});
