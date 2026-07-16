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
let mediaSequence = 0;

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
    if (url.endsWith('/media/') && method === 'POST') {
      mediaSequence += 1;
      return jsonResponse({
        id: `signature-${mediaSequence}`,
        media_type: 'signature',
        original_filename: 'signature.png',
      }, 201);
    }
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

async function uploadSignature() {
  fireEvent.change(screen.getByLabelText('Unterschrift als Bild hochladen'), {
    target: { files: [new File(['signature'], 'signature.png', { type: 'image/png' })] },
  });
  await screen.findByText('Hochgeladen: signature.png');
}

describe('LoanCheckoutPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastLoanPayload = null;
    mediaSequence = 0;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loans to an employee using the driver phone and required signature', async () => {
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');

    await screen.findByText('Ausleihe ausgeben');
    const driverSearch = await screen.findByLabelText('Fahrer');
    fireEvent.change(driverSearch, { target: { value: 'Lukas' } });
    fireEvent.click(screen.getByRole('option', { name: /Lukas Meyer/ }));
    await uploadSignature();
    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    await waitFor(() => expect(screen.getByText('Ausleihe ausgegeben')).toBeInTheDocument());
    expect(lastLoanPayload).toMatchObject({
      vehicle: 'veh-1',
      driver: 'drv-1',
      borrower_name: 'Lukas Meyer',
      borrower_phone: '+49 170 1',
      media_file_ids: ['signature-1'],
    });
  });

  it('switches to subcontractor and searches a company', async () => {
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');
    await screen.findByText('Ausleihe ausgeben');

    fireEvent.click(screen.getByRole('button', { name: 'Subunternehmer' }));
    const companySearch = screen.getByLabelText('Firma');
    fireEvent.change(companySearch, { target: { value: 'Muster' } });
    fireEvent.click(screen.getByRole('option', { name: 'Muster Bau' }));
    fireEvent.change(screen.getByLabelText('Telefon des Entleihers'), { target: { value: '+49 30 12345' } });
    await uploadSignature();
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
    fireEvent.change(screen.getByLabelText('Telefon (optional)'), { target: { value: '+49 40 12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrer speichern' }));

    await screen.findByRole('button', { name: 'Ausleihe abschließen' });
    await uploadSignature();
    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    await waitFor(() => expect(screen.getByText('Ausleihe ausgegeben')).toBeInTheDocument());
    expect(lastLoanPayload).toMatchObject({ vehicle: 'veh-1', driver: 'drv-new', borrower_name: 'Nina Klein' });
  });

  it('requires a driver when none is selected', async () => {
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');
    await screen.findByText('Ausleihe ausgeben');

    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    expect((await screen.findAllByText('Bitte einen Mitarbeiter/Fahrer auswählen.')).length).toBeGreaterThan(0);
    expect(lastLoanPayload).toBeNull();
  });

  it('does not submit twice when the completion button is clicked repeatedly', async () => {
    const fetchMock = installFetchMock();
    renderPage('/app/workflows/loan-checkout?vehicle=veh-1');
    await screen.findByText('Ausleihe ausgeben');
    fireEvent.change(screen.getByLabelText('Fahrer'), { target: { value: 'Lukas' } });
    fireEvent.click(screen.getByRole('option', { name: /Lukas Meyer/ }));
    await uploadSignature();

    const submit = screen.getByRole('button', { name: 'Ausleihe abschließen' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await screen.findByText('Ausleihe ausgegeben');

    const loanPosts = fetchMock.mock.calls.filter(([input, init]) =>
      String(input).endsWith('/loans/') && (init?.method ?? 'GET') === 'POST');
    expect(loanPosts).toHaveLength(1);
  });
});
