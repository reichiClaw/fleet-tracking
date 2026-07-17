import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { IntakePage } from './IntakePage';

let atomicPayload: Record<string, unknown> | null;
let idempotencyKey: string | null;
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
    if (url.endsWith('/vehicle-categories/')) {
      return response([{ id: 'cat-1', name: 'Trailer', meter_mode: 'none', is_active: true }]);
    }
    if (url.includes('/companies/typeahead/')) {
      return response([{
        id: 'supplier-1',
        name: 'Acme Supply',
        company_type: 'supplier',
        contact_name: 'Sam Supply',
        phone: '+49 30 1',
        is_active: true,
      }]);
    }
    if (url.endsWith('/media/') && method === 'POST') {
      return response({ id: 'photo-1', media_type: 'photo', original_filename: 'arrival.jpg' }, 201);
    }
    if (url.endsWith('/workflow-drafts/') && method === 'POST') {
      draftVersion += 1;
      const body = JSON.parse(String(init?.body));
      return response({
        id: 'draft-intake',
        owner: 'user-1',
        version: draftVersion,
        expires_at: '2026-08-01T00:00:00Z',
        created_at: '2026-07-17T00:00:00Z',
        updated_at: '2026-07-17T00:00:00Z',
        ...body,
      }, draftVersion === 1 ? 201 : 200);
    }
    if (url.endsWith('/workflow-drafts/draft-intake/discard/') && method === 'POST') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.endsWith('/workflows/check-ins/create-and-check-in/') && method === 'POST') {
      atomicPayload = JSON.parse(String(init?.body));
      idempotencyKey = new Headers(init?.headers).get('Idempotency-Key');
      return response({
        id: 'checkin-1',
        vehicle: 'veh-intake',
        pdf_media: 'pdf-intake',
      }, 201);
    }
    return response({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
  }));
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '*', element: <IntakePage /> }],
    { initialEntries: ['/app/workflows/intake'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('IntakePage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    atomicPayload = null;
    idempotencyKey = null;
    draftVersion = 0;
    installFetchMock();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the atomic create-and-check-in contract with explicit condition and evidence', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Create and check in vehicle' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Trailer 10' } });
    fireEvent.change(screen.getByLabelText('Serial number'), { target: { value: 'SN-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    fireEvent.change(screen.getByLabelText('Supplier / manufacturer'), { target: { value: 'Acme' } });
    fireEvent.click(await screen.findByRole('option', { name: /Acme Supply/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByLabelText('Fit for use')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Fit for use'));
    fireEvent.change(screen.getByLabelText('General vehicle photo'), {
      target: { files: [new File(['photo'], 'arrival.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Uploaded: arrival.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Review / confirm' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create and check in vehicle' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Vehicle created and checked in' }))
      .toBeInTheDocument();

    expect(atomicPayload).toMatchObject({
      category: 'cat-1',
      manufacturer: 'Acme',
      model: 'Trailer 10',
      serial_number: 'SN-10',
      supplier_company: 'supplier-1',
      condition_outcome: 'fit',
      media_file_ids: ['photo-1'],
    });
    expect(atomicPayload).not.toHaveProperty('status');
    expect(idempotencyKey).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open PDF receipt' }))
      .toHaveAttribute('href', '/api/v1/media/pdf-intake/download/');
  });

  it('requires an explicit condition and a general photo', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Create and check in vehicle' });
    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Trailer 10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Supplier / manufacturer'), { target: { value: 'Acme' } });
    fireEvent.click(await screen.findByRole('option', { name: /Acme Supply/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getAllByText('Choose a condition outcome.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add at least one general vehicle photo.').length).toBeGreaterThan(0);
    expect(atomicPayload).toBeNull();
  });
});
