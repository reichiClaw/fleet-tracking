import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
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
const operationsSession = {
  ...adminSession,
  username: 'ops',
  full_name: 'Operations User',
  display_name: 'Operations User',
  role: 'operations',
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
let mergeBodies: Array<Record<string, unknown>>;
let currentSession = adminSession;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.endsWith('/auth/me/')) return jsonResponse(currentSession);
    if (url.endsWith('/companies/') && method === 'GET') return jsonResponse(companies);
    if (url.endsWith('/drivers/') && method === 'GET') return jsonResponse(drivers);
    if (url.endsWith('/companies/duplicates/') && method === 'GET') {
      return jsonResponse(companies.length > 1 ? [{
        score: 1,
        reason: 'normalized_name_type_phone',
        companies,
      }] : []);
    }
    if (url.endsWith('/drivers/duplicates/') && method === 'GET') return jsonResponse([]);
    const companyMerge = url.match(/\/companies\/([^/]+)\/merge\/$/);
    if (companyMerge && method === 'POST') {
      mergeBodies.push(body);
      if (!body.confirmation_token) {
        return jsonResponse({
          confirmation_required: true,
          confirmation_token: 'merge-token',
          reassignment_counts: { drivers: 2, loans: 1, reservations: 1 },
        });
      }
      companies = companies.map((company) => (
        company.id === companyMerge[1] ? { ...company, is_active: false } : company
      ));
      return jsonResponse({
        source: companies.find((company) => company.id === companyMerge[1]),
        target: companies.find((company) => company.id === body.target_id),
        reassignment_counts: { drivers: 2, loans: 1, reservations: 1 },
      });
    }
    if (url.endsWith('/companies/') && method === 'POST') {
      const created = { id: `c-${companies.length + 1}`, is_active: true, ...body };
      companies = [...companies, created];
      return jsonResponse(created, 201);
    }
    const companyDeactivate = url.match(/\/companies\/([^/]+)\/deactivate\/$/);
    if (companyDeactivate && method === 'POST') {
      const company = companies.find((item) => item.id === companyDeactivate[1]);
      if (!company) return jsonResponse({ detail: 'not found' }, 404);
      const deactivated = { ...company, is_active: false };
      companies = companies.map((item) => item.id === deactivated.id ? deactivated : item);
      return jsonResponse(deactivated);
    }
    const driverDeactivate = url.match(/\/drivers\/([^/]+)\/deactivate\/$/);
    if (driverDeactivate && method === 'POST') {
      const driver = drivers.find((item) => item.id === driverDeactivate[1]);
      if (!driver) return jsonResponse({ detail: 'not found' }, 404);
      const deactivated = { ...driver, is_active: false };
      drivers = drivers.map((item) => item.id === deactivated.id ? deactivated : item);
      return jsonResponse(deactivated);
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
  const router = createMemoryRouter([{
    path: '*',
    element: (
      <AuthProvider>
        <PartnersPage />
      </AuthProvider>
    ),
  }], { initialEntries: ['/app/directory'] });
  return render(<RouterProvider router={router} />);
}

describe('PartnersPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastDriverPost = null;
    mergeBodies = [];
    currentSession = adminSession;
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

    await screen.findByRole('heading', { name: 'Acme' });
    fireEvent.click(screen.getByRole('button', { name: 'Neue Firma' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Globex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Firma hinzufügen' }));

    expect(await screen.findByRole('heading', { name: 'Globex' })).toBeInTheDocument();
  });

  it('deactivates a company after confirmation without removing its drivers', async () => {
    drivers = [{
      id: 'd-1',
      first_name: 'Max',
      last_name: 'Mustermann',
      company: 'c-1',
      is_active: true,
    }];
    renderPage();

    const card = (await screen.findByRole('heading', { name: 'Acme' })).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Firma Acme deaktivieren' }));
    fireEvent.click(screen.getByRole('button', { name: 'Firma deaktivieren' }));

    await waitFor(() => expect(screen.getByText(/Acme · Inaktiv/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: 'Fahrer' }));
    expect(screen.getByText('Max Mustermann', { selector: 'strong' })).toBeInTheDocument();
  });

  it('adds a driver inside a company group', async () => {
    renderPage();

    const card = (await screen.findByRole('heading', { name: 'Acme' })).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: '+ Fahrer hinzufügen' }));

    const form = screen.getByRole('button', { name: 'Fahrer hinzufügen' }).closest('form') as HTMLElement;
    fireEvent.change(within(form).getByLabelText('Vorname'), { target: { value: 'Max' } });
    fireEvent.change(within(form).getByLabelText('Nachname'), { target: { value: 'Mustermann' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Fahrer hinzufügen' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Fahrer' }));
    await waitFor(() => expect(screen.getByText('Max Mustermann', { selector: 'strong' })).toBeInTheDocument());
    expect(lastDriverPost).toMatchObject({ first_name: 'Max', last_name: 'Mustermann', company: 'c-1' });
  });

  it('lets operations edit partner data without exposing deactivation actions', async () => {
    currentSession = operationsSession;
    drivers = [{
      id: 'd-1',
      first_name: 'Max',
      last_name: 'Mustermann',
      company: 'c-1',
      is_active: true,
    }];
    renderPage();

    const card = (await screen.findByRole('heading', { name: 'Acme' })).closest('article') as HTMLElement;

    expect(within(card).getAllByRole('button', { name: 'Bearbeiten' })).toHaveLength(1);
    expect(within(card).queryByRole('button', { name: /deaktivieren/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Fahrer' }));
    const row = (await screen.findByText('Max Mustermann', { selector: 'strong' })).closest('.driver-row') as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /deaktivieren/i })).not.toBeInTheDocument();
  });

  it('deactivates a driver only after admin confirmation', async () => {
    drivers = [{
      id: 'd-1',
      first_name: 'Max',
      last_name: 'Mustermann',
      company: 'c-1',
      is_active: true,
    }];
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Fahrer' }));
    const row = (await screen.findByText('Max Mustermann', { selector: 'strong' })).closest('.driver-row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Fahrer Max Mustermann deaktivieren' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fahrer deaktivieren' }));

    await waitFor(() => expect(screen.getByText(/Max Mustermann · Inaktiv/, { selector: 'strong' })).toBeInTheDocument());
  });

  it('previews affected records and confirms duplicate merges with the server token', async () => {
    companies = [
      { id: 'c-1', name: 'Acme', company_type: 'subcontractor', is_active: true },
      { id: 'c-2', name: 'ACME', company_type: 'subcontractor', is_active: true },
    ];
    renderPage();

    expect(await screen.findByText('Mögliche Firmenduplikate')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Neuzuordnung prüfen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/4 verknüpfte Datensätze/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zusammenführen und neu zuordnen' }));

    await waitFor(() => expect(mergeBodies).toEqual([
      { target_id: 'c-2' },
      { target_id: 'c-2', confirmation_token: 'merge-token' },
    ]));
    expect(await screen.findByText('Duplikate wurden zusammengeführt und die Quelle deaktiviert.')).toBeInTheDocument();
  });
});
