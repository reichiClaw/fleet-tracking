import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AuthProvider } from '../auth/AuthContext';
import { UserManagementPage } from './UserManagementPage';

type MockUser = {
  id: string;
  username: string;
  full_name?: string;
  email?: string;
  role: string;
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

let users: MockUser[];

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (url.endsWith('/auth/me/')) {
      return jsonResponse(adminSession);
    }
    if (url.endsWith('/users/') && method === 'GET') {
      return jsonResponse(users);
    }
    if (url.endsWith('/users/') && method === 'POST') {
      const created: MockUser = { id: `u-${users.length + 1}`, is_active: true, ...body };
      users = [...users, created];
      return jsonResponse(created, 201);
    }
    const deactivate = url.match(/\/users\/([^/]+)\/deactivate\/$/);
    if (deactivate && method === 'POST') {
      users = users.map((user) => (user.id === deactivate[1] ? { ...user, is_active: false } : user));
      return jsonResponse(users.find((user) => user.id === deactivate[1]));
    }
    const detail = url.match(/\/users\/([^/]+)\/$/);
    if (detail && method === 'PATCH') {
      users = users.map((user) => (user.id === detail[1] ? { ...user, ...body } : user));
      return jsonResponse(users.find((user) => user.id === detail[1]));
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
        <UserManagementPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('UserManagementPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.cookie = 'csrftoken=test-token; path=/';
    users = [
      { id: 'me', username: 'admin', full_name: 'Site Admin', role: 'admin', is_active: true },
      { id: 'u-ops', username: 'mara', full_name: 'Mara Ops', role: 'operations', is_active: true },
    ];
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists existing users from the API', async () => {
    renderPage();

    expect(await screen.findByText('Mara Ops')).toBeInTheDocument();
    expect(screen.getByText('Site Admin')).toBeInTheDocument();
  });

  it('creates a new user through the API', async () => {
    const fetchMock = installFetchMock();
    renderPage();

    await screen.findByText('Mara Ops');

    fireEvent.change(screen.getByLabelText('Benutzername'), { target: { value: 'newbie' } });
    fireEvent.change(screen.getByLabelText('Vollständiger Name'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Benutzer hinzufügen' }));

    expect(await screen.findByText('New Person')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/users/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects passwords shorter than eight characters before calling the API', async () => {
    renderPage();
    await screen.findByText('Mara Ops');

    fireEvent.change(screen.getByLabelText('Benutzername'), { target: { value: 'shorty' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Benutzer hinzufügen' }));

    expect(
      await screen.findByText('Bitte geben Sie ein Passwort mit mindestens 8 Zeichen ein.'),
    ).toBeInTheDocument();
    expect(users.some((user) => user.username === 'shorty')).toBe(false);
  });

  it('deactivates another user', async () => {
    renderPage();

    const card = (await screen.findByText('Mara Ops')).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Deaktivieren' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));

    await waitFor(() => {
      const updated = screen.getByText('Mara Ops').closest('article') as HTMLElement;
      expect(within(updated).getByRole('button', { name: 'Aktivieren' })).toBeInTheDocument();
    });
  });

  it('guards the signed-in admin from self-management', async () => {
    renderPage();

    const adminCard = (await screen.findByText('Site Admin')).closest('article') as HTMLElement;
    expect(within(adminCard).getByRole('button', { name: 'Deaktivieren' })).toBeDisabled();
  });
});
