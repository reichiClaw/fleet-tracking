import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AuthProvider } from '../auth/AuthContext';
import { CompanyManagementPage } from './ManagementPage';

type MockCompany = {
  id: string;
  name: string;
  company_type: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  is_active: boolean;
};

const adminSession = {
  id: 'me',
  username: 'admin',
  full_name: 'Site Admin',
  display_name: 'Site Admin',
  role: 'admin',
  is_active: true,
};

let companies: MockCompany[];

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.endsWith('/auth/me/')) {
      return jsonResponse(adminSession);
    }
    if (url.endsWith('/companies/') && method === 'GET') {
      return jsonResponse(companies);
    }
    const detail = url.match(/\/companies\/([^/]+)\/$/);
    if (detail && method === 'PATCH') {
      companies = companies.map((company) =>
        company.id === detail[1] ? { ...company, ...body } : company,
      );
      return jsonResponse(companies.find((company) => company.id === detail[1]));
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
        <CompanyManagementPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('CompanyManagementPage editing', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    companies = [
      { id: 'c-1', name: 'Acme Bau', company_type: 'subcontractor', contact_name: 'Anna', is_active: true },
    ];
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets an admin edit a company through the API', async () => {
    const fetchMock = installFetchMock();
    renderPage();

    const card = (await screen.findByText('Acme Bau')).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Bearbeiten' }));

    const editForm = screen.getByRole('button', { name: 'Änderungen speichern' }).closest('form') as HTMLElement;
    fireEvent.change(within(editForm).getByLabelText('Name'), { target: { value: 'Acme Bau GmbH' } });
    fireEvent.click(within(editForm).getByRole('button', { name: 'Änderungen speichern' }));

    expect(await screen.findByText('Acme Bau GmbH')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/companies/c-1/',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
