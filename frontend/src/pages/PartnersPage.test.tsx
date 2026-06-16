import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AuthProvider } from '../auth/AuthContext';
import { PartnersPage } from './PartnersPage';

const adminSession = {
  id: 'me',
  username: 'admin',
  full_name: 'Site Admin',
  display_name: 'Site Admin',
  role: 'admin',
  is_active: true,
};

type MockCompany = { id: string; name: string; company_type: string; is_active: boolean };
type MockDriver = {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  is_active: boolean;
};

let companies: MockCompany[];
let drivers: MockDriver[];
let lastDriverPost: Record<string, unknown> | null = null;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.endsWith('/auth/me/')) return jsonResponse(adminSession);
    if (url.endsWith('/companies/') && method === 'GET') return jsonResponse(companies);
    if (url.endsWith('/drivers/') && method === 'GET') return jsonResponse(drivers);
    if (url.endsWith('/companies/') && method === 'POST') {
      const created = { id: `c-${companies.length + 1}`, is_active: true, ...body };
      companies = [...companies, created];
      return jsonResponse(created, 201);
    }
    if (url.endsWith('/drivers/') && method === 'POST') {
      lastDriverPost = body;
      const created = { id: `d-${drivers.length + 1}`, is_active: true, ...body };
      drivers = [...drivers, created];
      return jsonResponse(created, 201);
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <PartnersPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('PartnersPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastDriverPost = null;
    companies = [{ id: 'c-1', name: 'Acme', company_type: 'subcontractor', is_active: true }];
    drivers = [];
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a new company group', async () => {
    renderPage();

    await screen.findByText('Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Neue Firma' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Globex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Firma hinzufügen' }));

    expect(await screen.findByText('Globex')).toBeInTheDocument();
  });

  it('adds a driver inside a company group', async () => {
    renderPage();

    const card = (await screen.findByText('Acme')).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: '+ Fahrer hinzufügen' }));

    const form = screen.getByRole('button', { name: 'Fahrer hinzufügen' }).closest('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('Vorname'), { target: { value: 'Max' } });
    fireEvent.change(within(form).getByLabelText('Nachname'), { target: { value: 'Mustermann' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Fahrer hinzufügen' }));

    await waitFor(() => expect(screen.getByText(/Max Mustermann/)).toBeInTheDocument());
    expect(lastDriverPost).toMatchObject({ first_name: 'Max', last_name: 'Mustermann', company: 'c-1' });
  });
});
