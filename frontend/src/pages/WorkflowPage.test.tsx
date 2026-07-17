import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { WorkflowPage } from './WorkflowPage';

const vehicles = [
  {
    id: 'veh-1',
    qr_code: 'VH-ABC',
    internal_number: 'FZ-00001',
    category: null,
    manufacturer: 'Acme',
    model: 'A1',
    status: 'announced',
  },
];
const companies = [{ id: 'supplier-1', name: 'Acme Supply', company_type: 'supplier', is_active: true }];

let lastCheckInPayload: Record<string, unknown> | null = null;
let lastCheckInIdempotencyKey: string | null = null;
let checkInIdempotencyKeys: string[] = [];
let checkInFailuresRemaining = 0;
let lastReturnPayload: Record<string, unknown> | null = null;
let mediaSequence = 0;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/vehicle-categories/') && method === 'GET') return jsonResponse([]);
    if (url.includes('/vehicles/') && method === 'GET') return jsonResponse(vehicles);
    if (url.includes('/companies/') && method === 'GET') return jsonResponse(companies);
    if (url.includes('/drivers/') && method === 'GET') return jsonResponse([]);
    if (url.includes('/loans/') && method === 'GET')
      return jsonResponse([
        {
          id: 'loan-1',
          vehicle: 'veh-1',
          borrower_name: 'Borrower',
          expected_return_at: new Date().toISOString(),
          status: 'active',
        },
      ]);
    if (url.endsWith('/media/') && method === 'POST') {
      mediaSequence += 1;
      return jsonResponse({
        id: `photo-${mediaSequence}`,
        media_type: 'photo',
        original_filename: 'vehicle.jpg',
      }, 201);
    }
    if (url.endsWith('/workflows/check-ins/') && method === 'POST') {
      lastCheckInPayload = JSON.parse(String(init?.body));
      lastCheckInIdempotencyKey = new Headers(init?.headers).get('Idempotency-Key');
      checkInIdempotencyKeys.push(lastCheckInIdempotencyKey ?? '');
      if (checkInFailuresRemaining > 0) {
        checkInFailuresRemaining -= 1;
        return jsonResponse({ error: { code: 'temporary', message: 'Temporary failure.', details: {} } }, 500);
      }
      return jsonResponse({ id: 'checkin-1', vehicle: 'veh-1' }, 201);
    }
    if (url.endsWith('/loans/loan-1/return/') && method === 'POST') {
      lastReturnPayload = JSON.parse(String(init?.body));
      return jsonResponse({ id: 'loan-1', vehicle: 'veh-1', borrower_name: 'Borrower', status: 'returned' });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderPage(kind: 'check-in' | 'loan-return') {
  const router = createMemoryRouter(
    [{ path: '*', element: <WorkflowPage kind={kind} /> }],
    { initialEntries: ['/'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('WorkflowPage damage handling', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastCheckInPayload = null;
    lastCheckInIdempotencyKey = null;
    checkInIdempotencyKeys = [];
    checkInFailuresRemaining = 0;
    lastReturnPayload = null;
    mediaSequence = 0;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows check-in submission without any damage report', async () => {
    renderPage('check-in');

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Fahrzeug'), { target: { value: 'FZ-00001' } });
    fireEvent.click(screen.getByRole('option', { name: /FZ-00001/ }));
    fireEvent.change(screen.getByLabelText('Lieferant / Hersteller'), { target: { value: 'supplier-1' } });
    fireEvent.change(screen.getByLabelText('Allgemeines Fahrzeugfoto'), {
      target: { files: [new File(['photo'], 'vehicle.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Hochgeladen: vehicle.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));

    await waitFor(() => expect(screen.getByText('Fahrzeug zum Pool hinzugefügt')).toBeInTheDocument());
    expect(lastCheckInPayload).toMatchObject({
      vehicle: 'veh-1',
      supplier_company: 'supplier-1',
      media_file_ids: ['photo-1'],
    });
    expect(lastCheckInIdempotencyKey).toBeTruthy();
    expect(lastCheckInPayload).not.toHaveProperty('damage_reports');
  });

  it('reuses the check-in idempotency key when a failed submission is retried', async () => {
    checkInFailuresRemaining = 1;
    renderPage('check-in');

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Fahrzeug'), { target: { value: 'FZ-00001' } });
    fireEvent.click(screen.getByRole('option', { name: /FZ-00001/ }));
    fireEvent.change(screen.getByLabelText('Lieferant / Hersteller'), { target: { value: 'supplier-1' } });
    fireEvent.change(screen.getByLabelText('Allgemeines Fahrzeugfoto'), {
      target: { files: [new File(['photo'], 'vehicle.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Hochgeladen: vehicle.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));
    await screen.findByText('Temporary failure.');

    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));
    await screen.findByText('Fahrzeug zum Pool hinzugefügt');

    expect(checkInIdempotencyKeys).toHaveLength(2);
    expect(checkInIdempotencyKeys[0]).toBeTruthy();
    expect(checkInIdempotencyKeys[1]).toBe(checkInIdempotencyKeys[0]);
  });

  it('requires a damage photo when damage is reported on check-in', async () => {
    renderPage('check-in');

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Fahrzeug'), { target: { value: 'FZ-00001' } });
    fireEvent.click(screen.getByRole('option', { name: /FZ-00001/ }));
    fireEvent.click(screen.getByLabelText('Ja'));
    fireEvent.change(screen.getByLabelText('Schadensbeschreibung'), { target: { value: 'Delle vorne' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));

    expect((await screen.findAllByText('Bitte fügen Sie mindestens ein Foto des Schadens hinzu.')).length).toBeGreaterThan(0);
    expect(lastCheckInPayload).toBeNull();
  });

  it('marks a damaged check-in as damaged before submitting it', async () => {
    renderPage('check-in');

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Fahrzeug'), { target: { value: 'FZ-00001' } });
    fireEvent.click(screen.getByRole('option', { name: /FZ-00001/ }));
    fireEvent.change(screen.getByLabelText('Lieferant / Hersteller'), { target: { value: 'supplier-1' } });
    fireEvent.click(screen.getByLabelText('Ja'));
    fireEvent.change(screen.getByLabelText('Schadensbeschreibung'), { target: { value: 'Delle vorne' } });
    fireEvent.change(screen.getByLabelText('Foto des Schadens'), {
      target: { files: [new File(['damage'], 'damage.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.change(screen.getByLabelText('Allgemeines Fahrzeugfoto'), {
      target: { files: [new File(['vehicle'], 'vehicle.jpg', { type: 'image/jpeg' })] },
    });
    await waitFor(() => expect(screen.getAllByText('Hochgeladen: vehicle.jpg')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug einchecken' }));

    await screen.findByText('Fahrzeug zum Pool hinzugefügt');
    expect(lastCheckInPayload).toMatchObject({
      target_status: 'damaged',
      damage_reports: [{
        description: 'Delle vorne',
        media_file_ids: ['photo-1'],
      }],
      media_file_ids: ['photo-2'],
    });
  });

  it('completes a loan return without a signature', async () => {
    renderPage('loan-return');

    await screen.findByRole('heading', { name: 'Ausleihe zurückgeben' });
    fireEvent.change(screen.getByLabelText('Aktive Ausleihe'), { target: { value: 'loan-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow abschließen' }));

    await screen.findByText('Ausleihe zurückgegeben');
    expect(lastReturnPayload).toMatchObject({ media_file_ids: [], target_status: 'available' });
  });
});
