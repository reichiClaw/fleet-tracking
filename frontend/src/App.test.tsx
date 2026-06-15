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

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fahrzeugpool' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'QR-Zugriff' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importe' })).toBeInTheDocument();
  });

  it('routes to workflow screens from the authenticated shell', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/workflows/check-in');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Check-in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fahrzeugpool' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Importe' })).not.toBeInTheDocument();
  });

  it('shows field-level validation on the loan checkout workflow', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/workflows/loan-checkout');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Ausleihe ausgeben' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ausleihe abschließen' }));

    expect(await screen.findByText('Bitte wählen Sie ein Fahrzeug aus.')).toBeInTheDocument();
    expect(screen.getByText('Bitte einen Mitarbeiter/Fahrer auswählen.')).toBeInTheDocument();
  });

  it('redirects read-only users away from mutation workflow routes', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'readonly' }));
    window.history.pushState({}, '', '/app/workflows/check-in');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check-in' })).not.toBeInTheDocument();
  });

  it('routes authenticated users to the QR access page', async () => {
    window.localStorage.setItem('fleet-auth-user', JSON.stringify({ name: 'Ada', role: 'operations' }));
    window.history.pushState({}, '', '/app/qr');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'QR-Zugriff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scanner starten' })).toBeInTheDocument();
  });
});
