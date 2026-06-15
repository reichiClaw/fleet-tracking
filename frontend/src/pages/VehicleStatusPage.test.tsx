import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AuthProvider } from '../auth/AuthContext';
import { VehicleStatusPage } from './VehicleStatusPage';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

const publicStatus = {
  qr_code: 'VH-ABC',
  internal_number: 'FZ-00001',
  manufacturer: 'Acme',
  model: 'TH100',
  category: 'Steiger',
  status: 'available',
  license_plate: 'B-XX-123',
  current_location: 'Depot',
};

function installFetchMock({ authenticated }: { authenticated: boolean }) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/auth/me/')) {
      return authenticated
        ? jsonResponse({ username: 'ops', role: 'operations', display_name: 'Ops' })
        : jsonResponse({ detail: 'Authentication credentials were not provided.' }, 403);
    }
    if (url.includes('/public/vehicles/qr/')) {
      return jsonResponse(publicStatus);
    }
    if (url.includes('/vehicles/qr/')) {
      return jsonResponse({ vehicle: { id: 'veh-1', qr_code: 'VH-ABC', status: 'available' }, active_loan: null });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/v/VH-ABC']}>
      <AuthProvider>
        <Routes>
          <Route path="/v/:qrCode" element={<VehicleStatusPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('VehicleStatusPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the status without login and offers a sign-in prompt', async () => {
    installFetchMock({ authenticated: false });

    renderPage();

    expect(await screen.findByText('Verfügbar')).toBeInTheDocument();
    expect(screen.getByText('FZ-00001 · Acme · TH100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Fahrzeug ausleihen' })).not.toBeInTheDocument();
  });

  it('shows a contextual action for a signed-in operator', async () => {
    installFetchMock({ authenticated: true });

    renderPage();

    const loanLink = await screen.findByRole('link', { name: 'Fahrzeug ausleihen' });
    expect(loanLink).toHaveAttribute('href', '/app/workflows/loan-checkout?vehicle=veh-1');
    expect(screen.queryByRole('link', { name: 'Anmelden' })).not.toBeInTheDocument();
  });
});
