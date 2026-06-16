import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

let lastCheckInPayload: Record<string, unknown> | null = null;

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
    if (url.includes('/vehicles/') && method === 'GET') return jsonResponse(vehicles);
    if (url.includes('/companies/') && method === 'GET') return jsonResponse([]);
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
    if (url.endsWith('/workflows/check-ins/') && method === 'POST') {
      lastCheckInPayload = JSON.parse(String(init?.body));
      return jsonResponse({ id: 'checkin-1', vehicle: 'veh-1' }, 201);
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('WorkflowPage damage handling', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastCheckInPayload = null;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows check-in submission without any damage report', async () => {
    render(
      <MemoryRouter>
        <WorkflowPage kind="check-in" />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Fahrzeug'), { target: { value: 'veh-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow abschließen' }));

    await waitFor(() => expect(screen.getByText('Fahrzeug zum Pool hinzugefügt')).toBeInTheDocument());
    expect(lastCheckInPayload).toMatchObject({ vehicle: 'veh-1' });
    expect(lastCheckInPayload).not.toHaveProperty('damage_reports');
  });

  it('requires a damage photo when damage is reported on check-in', async () => {
    render(
      <MemoryRouter>
        <WorkflowPage kind="check-in" />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Fahrzeug'), { target: { value: 'veh-1' } });
    fireEvent.click(screen.getByLabelText('Schaden ist aufgetreten'));
    fireEvent.change(screen.getByLabelText('Schadensbeschreibung'), { target: { value: 'Delle vorne' } });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow abschließen' }));

    expect(
      await screen.findByText('Bitte fügen Sie mindestens ein Foto des Schadens hinzu.'),
    ).toBeInTheDocument();
    expect(lastCheckInPayload).toBeNull();
  });

  it('requires a signature to complete a loan return', async () => {
    render(
      <MemoryRouter>
        <WorkflowPage kind="loan-return" />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Ausleihe zurückgeben' });
    fireEvent.change(screen.getByLabelText('Aktive Ausleihe'), { target: { value: 'loan-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Workflow abschließen' }));

    expect(
      await screen.findByText('Für den Abschluss der Rückgabe ist eine Unterschrift erforderlich.'),
    ).toBeInTheDocument();
  });
});
