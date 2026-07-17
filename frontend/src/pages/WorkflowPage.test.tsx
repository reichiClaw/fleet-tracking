import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { WorkflowPage, type WorkflowKind } from './WorkflowPage';

const vehicle = {
  id: 'veh-1',
  qr_code: 'VH-ABC',
  internal_number: 'FZ-00001',
  category: 'cat-1',
  manufacturer: 'Acme',
  model: 'A1',
  license_plate: 'B-AB 1',
  serial_number: 'SN-1',
  current_location: 'Berlin',
  current_odometer_km: 150,
  current_operating_hours: null,
  status: 'announced',
};
const supplier = {
  id: 'supplier-1',
  name: 'Acme Supply',
  company_type: 'supplier',
  is_active: true,
};

let lastCheckInPayload: Record<string, unknown> | null = null;
let checkInKeys: string[] = [];
let checkInFailuresRemaining = 0;
let lastReturnPayload: Record<string, unknown> | null = null;
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
        vehicle: { ...vehicle, status: lastReturnPayload === null && url ? vehicle.status : vehicle.status },
        meter: { mode: 'odometer', odometer_km: 150, operating_hours: null },
        active_loan: null,
        open_damages: [{
          id: 'damage-existing',
          vehicle: 'veh-1',
          description: 'Existing scratch',
          severity: 'minor',
          discovered_at: '2026-07-01T10:00:00Z',
          resolved_at: null,
        }],
        reservations: [],
        active_maintenance: null,
        capabilities: { can_check_in: true, can_loan_return: true },
      });
    }
    if (url.endsWith('/vehicles/veh-1/media/')) return jsonResponse([]);
    if (url.endsWith('/vehicle-categories/cat-1/')) {
      return jsonResponse({ id: 'cat-1', name: 'Lift', meter_mode: 'odometer', is_active: true });
    }
    if (url.endsWith('/vehicles/veh-1/')) return jsonResponse(vehicle);
    if (url.includes('/companies/typeahead/')) return jsonResponse([supplier]);
    if (url.endsWith('/loans/loan-1/return-context/')) {
      return jsonResponse({
        loan_id: 'loan-1',
        status: 'active',
        vehicle: {
          ...vehicle,
          status: 'loaned',
          meter_mode: 'odometer',
        },
        borrower: {
          name: 'Borrower',
          phone: '555-0100',
          company_name: 'Build Co',
          company_id: 'company-1',
          driver_id: 'driver-1',
        },
        expected_return_at: '2026-07-17T12:00:00Z',
        checkout: {
          snapshot: { performed_at: '2026-07-10T08:30:00Z' },
          odometer_km: 100,
          operating_hours: null,
          media: [{
            id: 'checkout-signature',
            media_type: 'signature',
            original_filename: 'checkout-signature.png',
            download_url: '/media/checkout-signature',
          }],
        },
        open_damages: [],
        signature_required: false,
      });
    }
    if (url.endsWith('/media/') && method === 'POST') {
      mediaSequence += 1;
      return jsonResponse({
        id: `photo-${mediaSequence}`,
        media_type: 'photo',
        original_filename: 'vehicle.jpg',
      }, 201);
    }
    if (url.endsWith('/workflow-drafts/') && method === 'POST') {
      draftVersion += 1;
      const body = JSON.parse(String(init?.body));
      return jsonResponse({
        id: 'draft-workflow',
        owner: 'user-1',
        version: draftVersion,
        expires_at: '2026-08-01T00:00:00Z',
        created_at: '2026-07-17T00:00:00Z',
        updated_at: '2026-07-17T00:00:00Z',
        ...body,
      }, draftVersion === 1 ? 201 : 200);
    }
    if (url.endsWith('/workflow-drafts/draft-workflow/discard/') && method === 'POST') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/workflows/check-ins/') && method === 'POST') {
      lastCheckInPayload = JSON.parse(String(init?.body));
      checkInKeys.push(new Headers(init?.headers).get('Idempotency-Key') || '');
      if (checkInFailuresRemaining > 0) {
        checkInFailuresRemaining -= 1;
        return jsonResponse({ error: { code: 'temporary', message: 'Temporary failure.', details: {} } }, 500);
      }
      return jsonResponse({ id: 'checkin-1', vehicle: 'veh-1', pdf_media: 'pdf-1' }, 201);
    }
    if (url.endsWith('/loans/loan-1/return/') && method === 'POST') {
      lastReturnPayload = JSON.parse(String(init?.body));
      return jsonResponse({
        id: 'loan-1',
        vehicle: 'veh-1',
        borrower_name: 'Borrower',
        status: 'returned',
        return_pdf_media: 'pdf-return',
      });
    }
    return jsonResponse({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderPage(kind: WorkflowKind, initialPath: string) {
  const router = createMemoryRouter(
    [{ path: '*', element: <WorkflowPage kind={kind} /> }],
    { initialEntries: [initialPath] },
  );
  return render(<RouterProvider router={router} />);
}

async function reachCheckInCondition() {
  expect(await screen.findByRole('heading', { name: 'Fahrzeug einchecken' })).toBeInTheDocument();
  expect(await screen.findByRole('region', { name: 'Ausgewähltes Fahrzeug' })).toHaveTextContent('FZ-00001');
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  fireEvent.change(screen.getByLabelText('Lieferant / Hersteller'), { target: { value: 'Acme' } });
  fireEvent.click(await screen.findByRole('option', { name: /Acme Supply/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
}

async function completeFitCheckIn() {
  await reachCheckInCondition();
  fireEvent.click(screen.getByLabelText('Einsatzfähig'));
  fireEvent.change(screen.getByLabelText('Allgemeines Fahrzeugfoto'), {
    target: { files: [new File(['photo'], 'vehicle.jpg', { type: 'image/jpeg' })] },
  });
  await screen.findByText('Hochgeladen: vehicle.jpg');
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
  expect(await screen.findByRole('heading', { name: 'Prüfen / bestätigen' })).toBeInTheDocument();
}

describe('WorkflowPage redesign', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    lastCheckInPayload = null;
    checkInKeys = [];
    checkInFailuresRemaining = 0;
    lastReturnPayload = null;
    mediaSequence = 0;
    draftVersion = 0;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits explicit fit check-in with evidence and no client target status', async () => {
    renderPage('check-in', '/app/workflows/check-in?vehicle=veh-1');
    await completeFitCheckIn();
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Fahrzeug eingecheckt' })).toBeInTheDocument();
    expect(lastCheckInPayload).toMatchObject({
      vehicle: 'veh-1',
      supplier_company: 'supplier-1',
      condition_outcome: 'fit',
      odometer_km: 150,
      media_file_ids: ['photo-1'],
    });
    expect(lastCheckInPayload).not.toHaveProperty('target_status');
    expect(checkInKeys[0]).toBeTruthy();
  });

  it('retains and reuses the idempotency key after a confirmed server failure', async () => {
    checkInFailuresRemaining = 1;
    renderPage('check-in', '/app/workflows/check-in?vehicle=veh-1');
    await completeFitCheckIn();
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));
    await screen.findByText('Temporary failure.');
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Fahrzeug eingecheckt' })).toBeInTheDocument();

    expect(checkInKeys).toHaveLength(2);
    expect(checkInKeys[1]).toBe(checkInKeys[0]);
  });

  it('requires a photo and description for an explicit new-damage outcome', async () => {
    renderPage('check-in', '/app/workflows/check-in?vehicle=veh-1');
    await reachCheckInCondition();
    fireEvent.click(screen.getByLabelText('Neuer Schaden'));
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    expect((await screen.findAllByText('Bitte beschreiben Sie den Schaden.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bitte fügen Sie mindestens ein Foto des Schadens hinzu.').length).toBeGreaterThan(0);
    expect(lastCheckInPayload).toBeNull();
  });

  it('shows immutable checkout context, live delta, and lets the server derive return status', async () => {
    renderPage('loan-return', '/app/workflows/loan-return?loan=loan-1');
    expect(await screen.findByRole('heading', { name: 'Fahrzeug zurückgeben' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Weiter' }));

    expect(await screen.findByRole('heading', { name: 'Ausgabe im Vergleich zur Rückgabe' })).toBeInTheDocument();
    expect(screen.getByText('Build Co')).toBeInTheDocument();
    expect(screen.getByText('555-0100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /checkout-signature\.png/ })).toHaveAttribute('href', '/media/checkout-signature');
    expect(screen.getByText(/10\.07\.2026/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    expect(screen.getByText('Nutzung seit Ausgabe: 50 km · — Stunden')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Einsatzfähig'));
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug zurückgeben' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Fahrzeug zurückgegeben' })).toBeInTheDocument();
    expect(lastReturnPayload).toMatchObject({
      condition_outcome: 'fit',
      return_odometer_km: 150,
      media_file_ids: [],
    });
    expect(lastReturnPayload).not.toHaveProperty('target_status');
  });
});
