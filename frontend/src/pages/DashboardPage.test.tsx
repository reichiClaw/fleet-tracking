import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { DashboardPage } from './DashboardPage';

const categories = [
  { id: 'cat-steiger', name: 'Steiger', is_active: true },
  { id: 'cat-loader', name: 'Loader', is_active: true },
];
const vehicles = [
  { id: 'v1', qr_code: 'VH-1', internal_number: 'FZ-00001', category: 'cat-steiger', manufacturer: 'A', model: 'm', status: 'available' },
  { id: 'v2', qr_code: 'VH-2', internal_number: 'FZ-00002', category: 'cat-steiger', manufacturer: 'A', model: 'm', status: 'loaned' },
  { id: 'v3', qr_code: 'VH-3', internal_number: 'FZ-00003', category: 'cat-loader', manufacturer: 'A', model: 'm', status: 'damaged' },
  {
    id: 'v4',
    qr_code: 'VH-4',
    internal_number: 'FZ-00004',
    category: 'cat-steiger',
    manufacturer: 'A',
    model: 'm',
    status: 'manufacturer_checkout',
  },
];

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/vehicle-categories/')) return jsonResponse(categories);
    if (url.includes('/vehicles/')) return jsonResponse(vehicles);
    if (url.includes('/loans/')) return jsonResponse([]);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('DashboardPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows available vehicles per category with a link to the filtered pool', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    const steigerLink = await screen.findByRole('link', { name: /Steiger/ });
    expect(within(steigerLink).getByText('1')).toBeInTheDocument();
    expect(within(steigerLink).getByText('von 2 gesamt')).toBeInTheDocument();
    expect(steigerLink).toHaveAttribute('href', '/app/vehicles?status=available&category=cat-steiger');

    const loaderLink = screen.getByRole('link', { name: /Loader/ });
    expect(within(loaderLink).getByText('0')).toBeInTheDocument();
  });

  it('renders colored status summary counts', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Verfügbar nach Kategorie')).toBeInTheDocument();
    // available=1, loaned=1, damaged=1, maintenance=0 across the summary cards.
    const summaryValues = document.querySelectorAll('.summary-card strong');
    expect(summaryValues.length).toBe(4);
  });
});
