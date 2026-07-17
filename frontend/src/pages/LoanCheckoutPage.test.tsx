import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { LoanCheckoutPage } from './LoanCheckoutPage';

const vehicle = {
  id: 'veh-1',
  qr_code: 'VH-1',
  internal_number: 'VH-001',
  category: 'cat-1',
  manufacturer: 'Acme',
  model: 'A1',
  license_plate: 'B-AB 1',
  serial_number: 'SN-1',
  current_location: 'Berlin',
  status: 'available',
};
const driver = {
  id: 'drv-1',
  first_name: 'Lukas',
  last_name: 'Meyer',
  phone: '+49 170 1',
  is_active: true,
  company: null,
};

let lastLoanPayload: Record<string, unknown> | null = null;
let mediaSequence = 0;
let draftVersion = 0;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/vehicles/veh-1/workflow-context/')) {
      return jsonResponse({
        vehicle,
        meter: { mode: 'none', odometer_km: null, operating_hours: null },
        active_loan: null,
        open_damages: [],
        reservations: [],
        active_maintenance: null,
        capabilities: { can_loan_checkout: true },
      });
    }
    if (url.endsWith('/vehicles/veh-1/media/')) return jsonResponse([]);
    if (url.endsWith('/vehicle-categories/cat-1/')) {
      return jsonResponse({ id: 'cat-1', name: 'Lift', meter_mode: 'none', is_active: true });
    }
    if (url.endsWith('/vehicles/veh-1/')) return jsonResponse(vehicle);
    if (url.includes('/vehicles/typeahead/')) return jsonResponse([vehicle]);
    if (url.includes('/drivers/typeahead/')) return jsonResponse([driver]);
    if (url.endsWith('/drivers/drv-1/')) return jsonResponse(driver);
    if (url.endsWith('/reservations/res-1/')) {
      return jsonResponse({
        id: 'res-1',
        vehicle: 'veh-1',
        driver: 'drv-1',
        company: null,
        reserved_for: 'Lukas Meyer',
        manual_phone: '+49 170 1',
        start_at: new Date(Date.now() - 60_000).toISOString(),
        end_at: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'active',
        snapshot: { party: { type: 'driver', name: 'Lukas Meyer', phone: '+49 170 1' } },
      });
    }
    if (url.endsWith('/media/') && method === 'POST') {
      mediaSequence += 1;
      return jsonResponse({
        id: `signature-${mediaSequence}`,
        media_type: 'signature',
        original_filename: 'signature.png',
      }, 201);
    }
    if (url.endsWith('/workflow-drafts/') && method === 'POST') {
      draftVersion += 1;
      const body = JSON.parse(String(init?.body));
      return jsonResponse({
        id: 'draft-loan',
        owner: 'user-1',
        version: draftVersion,
        expires_at: '2026-08-01T00:00:00Z',
        created_at: '2026-07-17T00:00:00Z',
        updated_at: '2026-07-17T00:00:00Z',
        ...body,
      }, draftVersion === 1 ? 201 : 200);
    }
    if (url.endsWith('/workflow-drafts/draft-loan/discard/') && method === 'POST') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/loans/') && method === 'POST') {
      lastLoanPayload = JSON.parse(String(init?.body));
      return jsonResponse({
        id: 'loan-1',
        vehicle: 'veh-1',
        status: 'active',
        borrower_name: lastLoanPayload?.borrower_name,
      }, 201);
    }
    return jsonResponse({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(initialPath = '/app/workflows/loan-checkout?vehicle=veh-1') {
  const router = createMemoryRouter(
    [{ path: '*', element: <LoanCheckoutPage /> }],
    { initialEntries: [initialPath] },
  );
  return render(<RouterProvider router={router} />);
}

async function uploadSignature() {
  fireEvent.change(screen.getByLabelText('Unterschrift als Bild hochladen'), {
    target: { files: [new File(['signature'], 'signature.png', { type: 'image/png' })] },
  });
  await screen.findByText('Hochgeladen: signature.png');
}

async function advanceToParty() {
  expect(await screen.findByRole('heading', { name: 'Fahrzeug ausleihen' })).toBeInTheDocument();
  expect(await screen.findByRole('region', { name: 'Ausgewähltes Fahrzeug' })).toHaveTextContent('B-AB 1');
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
}

async function advanceToReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  fireEvent.click(await screen.findByLabelText('Bestehender Zustand unverändert'));
  await uploadSignature();
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  expect(await screen.findByRole('heading', { name: 'Prüfen / bestätigen' })).toBeInTheDocument();
}

describe('LoanCheckoutPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    lastLoanPayload = null;
    mediaSequence = 0;
    draftVersion = 0;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loans to a driver with prefilled phone, explicit condition, and signature', async () => {
    renderPage();
    await advanceToParty();
    fireEvent.change(screen.getByLabelText('Fahrer'), { target: { value: 'Lukas' } });
    fireEvent.click(await screen.findByRole('option', { name: /Lukas Meyer/ }));
    expect(screen.getByLabelText('Telefon des Entleihers')).toHaveValue('+49 170 1');
    await advanceToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug ausleihen' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Fahrzeug ausgeliehen'));
    expect(lastLoanPayload).toMatchObject({
      vehicle: 'veh-1',
      driver: 'drv-1',
      borrower_name: 'Lukas Meyer',
      borrower_phone: '+49 170 1',
      media_file_ids: ['signature-1'],
    });
  });

  it('validates the party step before revealing condition evidence', async () => {
    renderPage();
    await advanceToParty();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    expect((await screen.findAllByText('Bitte einen Mitarbeiter/Fahrer auswählen.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Zustand / Nachweise' })).not.toBeInTheDocument();
    expect(lastLoanPayload).toBeNull();
  });

  it('carries a reservation into one idempotent UI submission', async () => {
    const fetchMock = installFetchMock();
    renderPage('/app/workflows/loan-checkout?reservation=res-1');
    await advanceToParty();
    expect(screen.getByLabelText('Fahrer')).toBeDisabled();
    expect(screen.getByLabelText('Telefon des Entleihers')).toHaveValue('+49 170 1');
    await advanceToReview();

    const submit = screen.getByRole('button', { name: 'Fahrzeug ausleihen' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await screen.findByRole('status');

    const loanPosts = fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith('/loans/') && (init?.method ?? 'GET') === 'POST');
    expect(loanPosts).toHaveLength(1);
    expect(lastLoanPayload).toMatchObject({
      vehicle: 'veh-1',
      reservation_id: 'res-1',
      driver: 'drv-1',
      borrower_name: 'Lukas Meyer',
      borrower_phone: '+49 170 1',
    });
  });
});
