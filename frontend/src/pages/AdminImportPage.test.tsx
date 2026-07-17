import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AdminImportPage } from './AdminImportPage';

const sourceColumns = [
  { index: 0, label: 'Marke X', sample: 'Acme' },
  { index: 1, label: 'Modell Y', sample: 'TH100' },
];

const failedJob = {
  id: 'job-1',
  import_type: 'vehicles',
  status: 'failed',
  row_count: 1,
  error_count: 1,
  result: {
    columns: ['internal_number', 'category', 'manufacturer', 'model'],
    required_columns: ['manufacturer', 'model'],
    source_columns: sourceColumns,
    suggested_mapping: {},
    mapping: {},
    errors: [{ field: 'manufacturer', message: 'manufacturer is required.' }],
    rows: [],
  },
};

const validatedJob = {
  id: 'job-1',
  import_type: 'vehicles',
  status: 'validated',
  row_count: 75,
  error_count: 0,
  result: {
    columns: ['internal_number', 'category', 'manufacturer', 'model'],
    required_columns: ['manufacturer', 'model'],
    source_columns: sourceColumns,
    suggested_mapping: {},
    mapping: { manufacturer: 0, model: 1 },
    rows: Array.from({ length: 75 }, (_, index) => ({ row_number: index + 2, action: 'create', errors: [] })),
  },
};

const reviewJob = {
  id: 'job-review',
  import_type: 'vehicles',
  status: 'validated',
  row_count: 2,
  error_count: 0,
  source_media: 'source-1',
  created_by: 'Site Admin',
  created_at: '2026-07-16T10:00:00Z',
  result: {
    columns: ['external_key', 'category', 'manufacturer', 'model', 'notes'],
    required_columns: ['manufacturer', 'model'],
    source_columns: [],
    mapping: {},
    errors: [],
    rows: [
      {
        row_number: 2,
        action: 'update',
        values: { external_key: 'EXT-1', manufacturer: 'Acme', model: 'Lift', notes: '' },
        present_fields: ['external_key', 'manufacturer', 'model', 'notes'],
        diff: [
          { field: 'external_key', old: 'EXT-1', new: 'EXT-1', changed: false, explicit_clear: false },
          { field: 'notes', old: 'Keep me', new: '', changed: true, explicit_clear: true },
        ],
        duplicate_candidates: [{ vehicle_id: 'vehicle-2', internal_number: 'FZ-00002', matched_fields: ['manufacturer_model'] }],
        excluded: false,
        errors: [],
      },
      {
        row_number: 3,
        action: 'create',
        values: { manufacturer: 'Globex', model: 'Crane', category_fallback: true },
        present_fields: ['manufacturer', 'model', 'category'],
        diff: [{ field: 'category', old: null, new: 'Sonstiges', changed: true, explicit_clear: false }],
        supplier_proposal: { status: 'create_proposal', name: 'New Supplier' },
        excluded: false,
        errors: [],
      },
    ],
  },
};

let lastRemapBody: Record<string, unknown> | null = null;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/imports/vehicles/') && method === 'POST') {
      return jsonResponse(failedJob, 201);
    }
    if (url.endsWith('/imports/?page=1') && method === 'GET') {
      return jsonResponse([]);
    }
    if (url.endsWith('/imports/job-1/remap/') && method === 'POST') {
      lastRemapBody = JSON.parse(String(init?.body));
      return jsonResponse(validatedJob);
    }
    if (url.endsWith('/imports/job-1/commit/') && method === 'POST') {
      return jsonResponse({ ...validatedJob, status: 'committed' });
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '*', element: <AdminImportPage /> }],
    { initialEntries: ['/app/imports'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('AdminImportPage interactive mapping', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastRemapBody = null;
    window.sessionStorage.clear();
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets the user assign columns and re-validate', async () => {
    renderPage();

    const fileInput = screen.getByLabelText('Excel-Datei');
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'fleet.xlsx')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen und validieren' }));

    await screen.findByText('Spalten zuordnen');

    fireEvent.change(screen.getByLabelText(/Hersteller/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Modell/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zuordnung übernehmen & neu validieren' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Import übernehmen' })).not.toBeDisabled();
    });
    expect(lastRemapBody).toEqual({ mapping: { manufacturer: 0, model: 1 } });
  });

  it('shows the validation errors when the import fails', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Excel-Datei'), {
      target: { files: [new File(['x'], 'fleet.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen und validieren' }));

    expect(await screen.findByText('Was korrigiert werden muss')).toBeInTheDocument();
    expect(screen.getByText(/manufacturer is required\./)).toBeInTheDocument();
  });

  it('paginates every validated row instead of truncating the first 20', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Excel-Datei'), {
      target: { files: [new File(['x'], 'fleet.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen und validieren' }));
    await screen.findByText('Spalten zuordnen');
    fireEvent.change(screen.getByLabelText(/Hersteller/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Modell/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zuordnung übernehmen & neu validieren' }));

    const rowPagination = (await screen.findByText(/1–25 von 75/)).closest('nav') as HTMLElement;
    expect(screen.queryByText('76')).not.toBeInTheDocument();
    fireEvent.click(within(rowPagination).getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByText('Quellzeile 27')).toBeInTheDocument();
    expect(screen.getByText(/26–50 von 75/)).toBeInTheDocument();
  });

  it('reviews clears, preserves absent fields, excludes rows, and exposes history exports', async () => {
    let exclusionBody: Record<string, unknown> | null = null;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.endsWith('/imports/?page=1')) return jsonResponse([reviewJob]);
      if (url.endsWith('/imports/vehicles/') && method === 'POST') return jsonResponse(reviewJob, 201);
      if (url.endsWith('/imports/job-review/exclude-rows/') && method === 'POST') {
        exclusionBody = JSON.parse(String(init?.body));
        return jsonResponse({
          ...reviewJob,
          result: {
            ...reviewJob.result,
            rows: reviewJob.result.rows.map((row) => ({ ...row, excluded: row.row_number === 2 })),
          },
        });
      }
      return jsonResponse({ detail: 'not found' }, 404);
    }));
    renderPage();

    fireEvent.change(screen.getByLabelText('Excel-Datei'), {
      target: { files: [new File(['x'], 'fleet.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen und validieren' }));

    expect(await screen.findByText('Gespeicherten Wert leeren')).toBeInTheDocument();
    expect(screen.getAllByText(/Fehlende Spalten ändern gespeicherte Werte nicht/).length).toBe(2);
    expect(screen.getByText('Ausweichkategorie')).toBeInTheDocument();
    expect(screen.queryByText('Sonstiges')).not.toBeInTheDocument();
    expect(screen.getByText('1 mögliche Duplikate')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Quelldatei herunterladen' })[0]).toHaveAttribute(
      'href',
      '/api/v1/media/source-1/download/',
    );
    expect(screen.getByRole('button', { name: 'Kommentierte Prüf-CSV herunterladen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fortsetzen' })).toBeInTheDocument();

    const include = screen.getAllByRole('checkbox', { name: 'Bei Übernahme einschließen' })[0];
    fireEvent.click(include);
    await waitFor(() => expect(exclusionBody).toEqual({ row_numbers: [2] }));
    expect(await screen.findByText('Zeile 2 ausgeschlossen.')).toBeInTheDocument();
  });

  it('downloads the bilingual Excel template with an explicit request language', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:template') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/imports/?page=1')) return jsonResponse([]);
      if (url.endsWith('/imports/vehicle-template/')) {
        return Promise.resolve(new Response(new Blob(['xlsx']), { status: 200 }));
      }
      return jsonResponse({ detail: 'not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Deutsche Excel-Vorlage herunterladen' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/imports/vehicle-template/',
      expect.objectContaining({ headers: { 'Accept-Language': 'de' } }),
    ));
  });
});
