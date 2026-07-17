import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AuthProvider } from '../auth/AuthContext';
import { ReportsPage } from './ReportsPage';

const documents = [
  {
    document_type: 'loan_checkout_pdf',
    record_id: 'loan-1',
    vehicle_id: 'veh-1',
    vehicle_label: 'FZ-00001 · Acme · TH100',
    license_plate: 'M-AB 123',
    performed_at: '2026-06-15T10:00:00Z',
    creator: 'user-1',
    creator_label: 'Site Admin',
    language: 'de',
    status: 'generated',
    failure_reason: '',
    media_id: 'doc-1',
    retry: null,
  },
];

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock(body: unknown) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/auth/me/')) return jsonResponse({
      id: 'user-1',
      username: 'admin',
      display_name: 'Site Admin',
      role: 'admin',
      effective_role: 'admin',
    });
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
        <AuthProvider>
          <ReportsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Dokumentenregister' })).toBeInTheDocument();
    expect((await screen.findAllByText('FZ-00001 · Acme · TH100')).length).toBeGreaterThanOrEqual(1);
    // "Ausleihe-Bericht" appears both in the type filter and in the table row.
    expect(screen.getAllByText('Ausleihe-Bericht').length).toBeGreaterThanOrEqual(1);
    const download = screen.getAllByRole('link', { name: 'Herunterladen' })[0];
    expect(download).toHaveAttribute('href', '/api/v1/media/doc-1/download/');
  });

  it('shows an empty state when there are no reports', async () => {
    installFetchMock([]);

    render(
      <MemoryRouter>
        <AuthProvider>
          <ReportsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Keine Berichte gefunden')).toBeInTheDocument();
  });

  it('shows missing and failed documents and confirms an audited bulk retry', async () => {
    let retryBody: Record<string, unknown> | null = null;
    const attentionRows = [
      {
        ...documents[0],
        record_id: 'loan-missing',
        media_id: null,
        status: 'missing',
        retry: { document_type: 'loan_checkout_pdf', record_id: 'loan-missing', language: 'de' },
      },
      {
        ...documents[0],
        document_type: 'loan_return_pdf',
        record_id: 'loan-failed',
        media_id: null,
        status: 'failed',
        failure_reason: 'Storage unavailable',
        retry: { document_type: 'loan_return_pdf', record_id: 'loan-failed', language: 'de' },
      },
    ];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me/')) return jsonResponse({
        id: 'user-1',
        username: 'admin',
        display_name: 'Site Admin',
        role: 'admin',
        effective_role: 'admin',
      });
      if (url.includes('/documents/retry/') && init?.method === 'POST') {
        retryBody = JSON.parse(String(init.body));
        return jsonResponse({ count: 2, results: [] });
      }
      if (url.includes('/documents/register/')) return jsonResponse(attentionRows);
      return jsonResponse({});
    }));
    render(
      <MemoryRouter initialEntries={['/app/documents?status=attention']}>
        <AuthProvider>
          <ReportsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Fehlt')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Fehlgeschlagen').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Storage unavailable').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alle wiederholbaren Zeilen dieser Seite auswählen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ausgewählte PDFs erneut erzeugen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ausgewählte PDFs erneut erzeugen' }));

    await waitFor(() => expect(retryBody).toEqual({
      items: [
        { document_type: 'loan_checkout_pdf', record_id: 'loan-missing', language: 'de' },
        { document_type: 'loan_return_pdf', record_id: 'loan-failed', language: 'de' },
      ],
    }));
    expect(await screen.findByText(/2 Dokumente erfolgreich erzeugt/)).toBeInTheDocument();
  });
});
