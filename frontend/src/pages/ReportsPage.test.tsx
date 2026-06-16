import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { ReportsPage } from './ReportsPage';

const documents = [
  {
    id: 'doc-1',
    vehicle: 'veh-1',
    vehicle_label: 'FZ-00001 · Acme · TH100',
    loan: 'loan-1',
    related_type: 'loan_checkout_pdf',
    media_type: 'pdf',
    original_filename: 'lc-1-de.pdf',
    language: 'de',
    download_url: 'http://testserver/api/v1/media/doc-1/download/',
    created_at: '2026-06-15T10:00:00Z',
  },
];

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock(body: unknown) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/documents/')) return jsonResponse(body);
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('ReportsPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists generated reports with type label and a download link', async () => {
    installFetchMock(documents);

    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Berichte' })).toBeInTheDocument();
    expect(await screen.findByText('FZ-00001 · Acme · TH100')).toBeInTheDocument();
    // "Ausleihe-Bericht" appears both in the type filter and in the table row.
    expect(screen.getAllByText('Ausleihe-Bericht').length).toBeGreaterThanOrEqual(1);
    const download = screen.getByRole('link', { name: 'Herunterladen' });
    expect(download).toHaveAttribute('href', 'http://testserver/api/v1/media/doc-1/download/');
  });

  it('shows an empty state when there are no reports', async () => {
    installFetchMock([]);

    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Keine Berichte gefunden')).toBeInTheDocument();
  });
});
