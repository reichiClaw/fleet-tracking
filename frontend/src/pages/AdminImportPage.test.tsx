import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

describe('AdminImportPage interactive mapping', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastRemapBody = null;
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets the user assign columns and re-validate', async () => {
    render(
      <MemoryRouter>
        <AdminImportPage />
      </MemoryRouter>,
    );

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
    render(
      <MemoryRouter>
        <AdminImportPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Excel-Datei'), {
      target: { files: [new File(['x'], 'fleet.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen und validieren' }));

    expect(await screen.findByText('Was korrigiert werden muss')).toBeInTheDocument();
    expect(screen.getByText(/manufacturer is required\./)).toBeInTheDocument();
  });

  it('paginates every validated row instead of truncating the first 20', async () => {
    render(
      <MemoryRouter>
        <AdminImportPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Excel-Datei'), {
      target: { files: [new File(['x'], 'fleet.xlsx')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen und validieren' }));
    await screen.findByText('Spalten zuordnen');
    fireEvent.change(screen.getByLabelText(/Hersteller/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Modell/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zuordnung übernehmen & neu validieren' }));

    await screen.findByText(/1–50 von 75/);
    expect(screen.queryByText('76')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(await screen.findByText('76')).toBeInTheDocument();
    expect(screen.getByText(/51–75 von 75/)).toBeInTheDocument();
  });
});
