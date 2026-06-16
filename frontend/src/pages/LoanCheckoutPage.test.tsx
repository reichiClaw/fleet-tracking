import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { LoanCheckoutPage } from './LoanCheckoutPage';

const vehicles = [
  { id: 'veh-1', qr_code: 'VH-1', internal_number: 'VH-001', category: null, manufacturer: 'Acme', model: 'A1', status: 'available' },
];
const drivers = [{ id: 'drv-1', first_name: 'Lukas', last_name: 'Meyer', phone: '+49 170 1', is_active: true, company: null }];
const companies = [{ id: 'co-1', name: 'Muster Bau', company_type: 'subcontractor', is_active: true }];

let lastLoanPayload: Record<string, unknown> | null = null;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/vehicle-categories/') && method === 'GET') return jsonResponse([]);
    if (url.includes('/vehicles/') && method === 'GET') return jsonResponse(vehicles);
    if (url.includes('/drivers/') && method === 'GET') return jsonResponse(drivers);
    if (url.includes('/companies/') && method === 'GET') return jsonResponse(companies);
    if (url.endsWith('/drivers/') && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      return jsonResponse({ id: 'drv-new', is_active: true, company: null, ...body }, 201);
    }
    if (url.endsWith('/loans/') && method === 'POST') {
      lastLoanPayload = JSON.parse(String(init?.body));
      return jsonResponse({ id: 'loan-1', status: 'active', borrower_name: lastLoanPayload?.borrower_name }, 201);
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(initialPath = '/app/workflows/loan-checkout') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LoanCheckoutPage />
    </MemoryRouter>,
  );
}

describe('LoanCheckoutPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastLoanPayload = null;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loans to an employee by searching and selecting a driver (no phone required)', async () => {
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');

    await screen.findByText('Ausleihe ausgeben');
    const driverSearch = await screen.findByLabelText('Fahrer');
    fireEvent.change(driverSearch, { target: { value: 'Lukas' } });
    fireEvent.click(screen.getByRole('button', { name: /Lukas Meyer/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    await waitFor(() => expect(screen.getByText('Ausleihe ausgegeben')).toBeInTheDocument());
    expect(lastLoanPayload).toMatchObject({ vehicle: 'veh-1', driver: 'drv-1', borrower_name: 'Lukas Meyer' });
  });

  it('switches to subcontractor and searches a company', async () => {
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');
    await screen.findByText('Ausleihe ausgeben');

    fireEvent.click(screen.getByRole('button', { name: 'Subunternehmer' }));
    const companySearch = screen.getByLabelText('Firma');
    fireEvent.change(companySearch, { target: { value: 'Muster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Muster Bau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    await waitFor(() => expect(screen.getByText('Ausleihe ausgegeben')).toBeInTheDocument());
    expect(lastLoanPayload).toMatchObject({ vehicle: 'veh-1', company: 'co-1' });
  });

  it('quickly adds a new driver and loans to them', async () => {
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');
    await screen.findByText('Ausleihe ausgeben');

    fireEvent.click(screen.getByRole('button', { name: '+ Neuen Fahrer anlegen' }));
    fireEvent.change(screen.getByLabelText('Vorname'), { target: { value: 'Nina' } });
    fireEvent.change(screen.getByLabelText('Nachname'), { target: { value: 'Klein' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrer speichern' }));

    await screen.findByRole('button', { name: 'Ausleihe abschließen' });
    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    await waitFor(() => expect(screen.getByText('Ausleihe ausgegeben')).toBeInTheDocument());
    expect(lastLoanPayload).toMatchObject({ vehicle: 'veh-1', driver: 'drv-new', borrower_name: 'Nina Klein' });
  });

  it('requires a driver when none is selected', async () => {
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');
    await screen.findByText('Ausleihe ausgeben');

    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    expect(await screen.findByText('Bitte einen Mitarbeiter/Fahrer auswählen.')).toBeInTheDocument();
    expect(lastLoanPayload).toBeNull();
  });
});
