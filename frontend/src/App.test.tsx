import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import i18n, { LANGUAGE_STORAGE_KEY } from './i18n';

function mockOfflineApi() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('network unavailable'))));
}

describe('App smoke flow', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockOfflineApi();
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
    await i18n.changeLanguage('de');
  });

  it('renders the German login page by default', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sprache')).toHaveValue('de');
  });

  it('persists the selected English language', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Sprache'), { target: { value: 'en' } });

    await waitFor(() => expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en'));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in with the frontend fallback and shows role-aware navigation', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Benutzername'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText('Demo-Rolle'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('heading', { name: 'Fuhrpark-Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fahrzeugpool' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Aufgaben' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('link', { name: 'Historie' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fahrzeug ausleihen' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Scannen' }).length).toBeGreaterThanOrEqual(1);

    // Admin functions are grouped separately from operational tasks.
    fireEvent.click(screen.getByRole('button', { name: 'Administration' }));
    expect(await screen.findByRole('link', { name: 'Einrichtung' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importe' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dokumente' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit-Protokoll' })).toBeInTheDocument();
  });

  it('uses effective admin capabilities for Django superusers', async () => {
    window.history.pushState({}, '', '/app/users');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me/')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'superuser-1',
          username: 'root',
          display_name: 'Root Admin',
          role: 'readonly',
          effective_role: 'admin',
          capabilities: { is_app_admin: true, can_manage_users: true, can_view_audit_log: true },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Benutzerverwaltung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Administration' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Audit-Protokoll' })).toHaveAttribute('href', '/app/audit');
  });

  it('gates temporary-password sessions on the change-password route', async () => {
    window.history.pushState({}, '', '/app/users');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me/')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'user-1',
          username: 'temporary',
          display_name: 'Temporary User',
          role: 'operations',
          must_change_password: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Passwort ändern' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('temporäre Passwort ersetzt');
    expect(window.location.pathname).toBe('/app/change-password');
  });

  it('routes to workflow screens from the authenticated shell', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/workflows/check-in');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Fahrzeug einchecken' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fahrzeugpool' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Importe' })).not.toBeInTheDocument();
  });

  it('guards administration routes from non-admin users', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/directory');

    render(<App />);

    expect(await screen.findByText('Ihre Rolle erlaubt keinen Zugriff auf diese Seite.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Firmen & Fahrer' })).not.toBeInTheDocument();
  });

  it('shows field-level validation on the loan checkout workflow', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/workflows/loan-checkout');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Fahrzeug ausleihen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    expect((await screen.findAllByText('Bitte wählen Sie ein Fahrzeug aus.')).length).toBeGreaterThan(0);
  });

  it('explains denied mutation workflow access to read-only users', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'readonly' }));
    window.history.pushState({}, '', '/app/workflows/check-in');

    render(<App />);

    expect(await screen.findByText('Ihre Rolle erlaubt keinen Zugriff auf diese Seite.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fahrzeug einchecken' })).not.toBeInTheDocument();
  });

  it('makes Tasks and check-in discoverable to operations users', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/tasks');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Aufgaben' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Fahrzeug einchecken' })
      .some((link) => link.getAttribute('href') === '/app/workflows/check-in')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'Fahrzeug ausleihen' })
      .some((link) => link.getAttribute('href') === '/app/workflows/loan-checkout')).toBe(true);
    expect(screen.queryByRole('link', { name: 'Fahrzeugdatensatz anlegen' })).not.toBeInTheDocument();
  });

  it('keeps Tasks visible but mutation actions hidden for read-only users', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'readonly' }));
    window.history.pushState({}, '', '/app/tasks');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Aufgaben' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Scannen' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('link', { name: 'Fahrzeug einchecken' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fahrzeug ausleihen' })).not.toBeInTheDocument();
  });

  it('routes authenticated users to the QR access page', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/qr');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'QR-Zugriff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scanner starten' })).toBeInTheDocument();
  });

  it('exposes the mobile task-first navigation and accessible More drawer control', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app');

    render(<App />);

    await screen.findByRole('heading', { name: 'Fuhrpark-Dashboard' });
    const mobileNavigation = screen.getByRole('navigation', { name: 'Mobile Navigation' });
    expect(within(mobileNavigation).getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/app');
    expect(within(mobileNavigation).getByRole('link', { name: 'Aufgaben' })).toHaveAttribute('href', '/app/tasks');
    expect(within(mobileNavigation).getByRole('link', { name: 'Scannen' })).toHaveAttribute('href', '/app/qr?mode=scan');
    expect(within(mobileNavigation).getByRole('link', { name: 'Fuhrpark' })).toHaveAttribute('href', '/app/vehicles');
    const more = within(mobileNavigation).getByRole('button', { name: 'Mehr' });
    expect(more).toHaveAttribute('aria-controls', 'primary-navigation');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    await waitFor(() => expect(more).toHaveAttribute('aria-expanded', 'true'));
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    expect(document.querySelector('#main-content')).toHaveAttribute('inert');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(more).toHaveAttribute('aria-expanded', 'false'));
    expect(document.querySelector('#main-content')).not.toHaveAttribute('inert');
  });

  it('polls and exposes the server task count in primary navigation', async () => {
    window.history.pushState({}, '', '/app/change-password');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/me/')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'ops-1',
          username: 'ada',
          display_name: 'Ada',
          role: 'operations',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.includes('/dashboard/tasks/')) {
        return Promise.resolve(new Response(JSON.stringify({ count: 7, groups: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));

    render(<App />);

    await screen.findByRole('heading', { name: 'Passwort ändern' });
    const primaryNavigation = screen.getByRole('complementary', { name: 'Hauptnavigation' });
    const tasksLink = within(primaryNavigation).getByRole('link', { name: /Aufgaben/ });
    expect(await within(tasksLink).findByLabelText('7 offene Aufgaben')).toHaveTextContent('7');
    expect(screen.getByRole('button', { name: 'Kontomenü' })).toBeInTheDocument();
  });

  it('continues to the complete QR URL after backend login', async () => {
    document.cookie = 'csrftoken=test-token; path=/';
    window.history.pushState({}, '', '/app/qr?mode=scan#camera');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me/')) {
        return Promise.resolve(new Response(JSON.stringify({
          error: { code: 'not_authenticated', message: 'Authentication required.', details: {} },
        }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.endsWith('/auth/login/') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({
          username: 'ada',
          display_name: 'Ada',
          role: 'operations',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.includes('/vehicles/')) {
        return Promise.resolve(new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Benutzername'), { target: { value: 'ada' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('heading', { name: 'QR-Zugriff' })).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe('/app/qr?mode=scan#camera');
  });
});
