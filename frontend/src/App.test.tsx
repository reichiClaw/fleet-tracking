import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('link', { name: 'Historie' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ausleihe-Workflows' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'QR-Zugriff' })).toBeInTheDocument();

    // Admin functions are grouped under the Settings submenu.
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }));
    expect(await screen.findByRole('link', { name: 'Fahrzeuge hinzufügen/entfernen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importe' })).toBeInTheDocument();
  });

  it('routes to workflow screens from the authenticated shell', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/workflows/check-in');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fahrzeugpool' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Importe' })).not.toBeInTheDocument();
  });

  it('shows field-level validation on the loan checkout workflow', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/workflows/loan-checkout');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Ausleihe ausgeben' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    expect((await screen.findAllByText('Bitte wählen Sie ein Fahrzeug aus.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bitte einen Mitarbeiter/Fahrer auswählen.').length).toBeGreaterThan(0);
  });

  it('explains denied mutation workflow access to read-only users', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'readonly' }));
    window.history.pushState({}, '', '/app/workflows/check-in');

    render(<App />);

    expect(await screen.findByText('Ihre Rolle erlaubt keinen Zugriff auf diese Seite.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' })).not.toBeInTheDocument();
  });

  it('routes authenticated users to the QR access page', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/qr');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'QR-Zugriff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scanner starten' })).toBeInTheDocument();
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
