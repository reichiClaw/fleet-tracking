import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AuthProvider } from '../auth/AuthContext';
import { DashboardPage } from './DashboardPage';

const summary = {
  generated_at: '2026-06-15T12:00:00Z',
  totals: {
    vehicles: 4,
    operational: 4,
    available: 1,
    loaned: 1,
    maintenance: 1,
    damaged: 1,
    manufacturer_checkout: 0,
    announced: 0,
    archived: 0,
    active_loans: 1,
    overdue_loans: 1,
    utilization_pct: 25,
  },
  status_distribution: [
    { status: 'available', count: 1 },
    { status: 'loaned', count: 1 },
    { status: 'maintenance', count: 1 },
    { status: 'damaged', count: 1 },
  ],
  checkouts_series: Array.from({ length: 14 }, (_, index) => ({
    date: `2026-06-${String(index + 1).padStart(2, '0')}`,
    count: index % 3,
  })),
  available_by_category: [{ id: 'cat-steiger', name: 'Steiger', total: 2, available: 1 }],
  recent_loans: [
    {
      id: 'loan-1',
      vehicle_label: 'FZ-00002 · Acme · TH100',
      borrower: 'Borrower',
      status: 'active',
      created_at: '2026-06-14T10:00:00Z',
      expected_return_at: '2026-06-20T10:00:00Z',
    },
  ],
  attention: {
    overdue_loans: [
      { id: 'ovd-1', vehicle_label: 'FZ-00009 · Acme · TH100', borrower: 'Late Borrower', expected_return_at: '2026-06-10T10:00:00Z' },
    ],
    damaged_vehicles: [{ id: 'dmg-1', label: 'FZ-00003 · Acme · TH100', status: 'damaged' }],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/auth/me/')) return jsonResponse({ username: 'ops', role: 'operations', display_name: 'Ops' });
    if (url.includes('/dashboard/summary/')) return jsonResponse(summary);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders KPIs, charts, and a category link from the dashboard summary', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Fuhrpark-Dashboard' })).toBeInTheDocument();

    // KPI labels are present
    expect(screen.getByText('Fuhrparkgröße')).toBeInTheDocument();
    // "Overdue returns" appears as both a KPI and an attention panel title
    expect(screen.getAllByText('Überfällige Rückgaben').length).toBeGreaterThanOrEqual(1);

    // Available-by-category link points to the filtered pool
    const steiger = screen.getByRole('link', { name: /Steiger/ });
    expect(within(steiger).getByText('1')).toBeInTheDocument();
    expect(steiger).toHaveAttribute('href', '/app/vehicles?status=available&category=cat-steiger');

    // Two accessible charts (donut + activity) are rendered
    expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2);

    // Recent loans table shows the latest loan
    expect(screen.getByText('FZ-00002 · Acme · TH100')).toBeInTheDocument();
    // Overdue attention panel shows the late loan
    expect(screen.getByText('FZ-00009 · Acme · TH100')).toBeInTheDocument();
  });

  it('shows a friendly empty state when there are no vehicles', async () => {
    vi.unstubAllGlobals();
    const emptySummary = { ...summary, totals: { ...summary.totals, vehicles: 0 } };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/auth/me/')) return jsonResponse({ username: 'ops', role: 'operations' });
        if (url.includes('/dashboard/summary/')) return jsonResponse(emptySummary);
        return jsonResponse({});
      }),
    );

    renderDashboard();

    expect(await screen.findByText('Ihr Fuhrpark ist leer')).toBeInTheDocument();
  });
});
