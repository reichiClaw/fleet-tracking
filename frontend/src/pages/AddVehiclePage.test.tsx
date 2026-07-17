import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AddVehiclePage } from './AddVehiclePage';

let categories = [{ id: 'cat-1', name: 'Steiger', is_active: true }];

let lastCreatePayload: Record<string, unknown> | null = null;
let mediaSequence = 0;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/vehicle-categories/')) return jsonResponse(categories);
    if (url.endsWith('/vehicles/') && method === 'GET') return jsonResponse([]);
    if (url.endsWith('/media/') && method === 'POST') {
      mediaSequence += 1;
      return jsonResponse({
        id: `media-${mediaSequence}`,
        media_type: 'photo',
        original_filename: 'damage.jpg',
        download_url: `/media/${mediaSequence}`,
      }, 201);
    }
    if (url.endsWith('/vehicles/') && method === 'POST') {
      lastCreatePayload = JSON.parse(String(init?.body));
      return jsonResponse({
        id: 'veh-9',
        internal_number: 'FZ-00009',
        manufacturer: 'Acme',
        model: 'TH-Z',
        status: Array.isArray(lastCreatePayload?.initial_damage_reports) ? 'damaged' : 'available',
      }, 201);
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '*', element: <AddVehiclePage /> }],
    { initialEntries: ['/app/vehicles/new'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('AddVehiclePage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastCreatePayload = null;
    mediaSequence = 0;
    categories = [{ id: 'cat-1', name: 'Steiger', is_active: true }];
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a new vehicle with master-data fields and adds it to the pool', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText('Hersteller'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Modell'), { target: { value: 'TH-Z' } });
    fireEvent.change(screen.getByLabelText('Seriennummer'), { target: { value: 'SN-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }));

    await waitFor(() => expect(screen.getByText('Fahrzeug zum Pool hinzugefügt')).toBeInTheDocument());
    expect(lastCreatePayload).toMatchObject({
      category: 'cat-1',
      manufacturer: 'Acme',
      model: 'TH-Z',
      serial_number: 'SN-123',
      status: 'available',
    });
  });

  it('requires category, manufacturer, and model', async () => {
    categories = [
      { id: 'cat-1', name: 'Steiger', is_active: true },
      { id: 'cat-2', name: 'Stapler', is_active: true },
    ];
    renderPage();

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }));

    expect((await screen.findAllByText('Bitte wählen Sie eine Kategorie aus.')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bitte geben Sie den Hersteller ein.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bitte geben Sie das Modell ein.').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Kategorie')).toHaveAttribute('aria-invalid', 'true');
    expect(lastCreatePayload).toBeNull();
  });

  it('blocks adding a damaged vehicle without a damage photo', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Hersteller'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Modell'), { target: { value: 'TH-Z' } });
    fireEvent.click(screen.getByLabelText('Ja'));
    fireEvent.change(screen.getByLabelText('Schadensbeschreibung'), { target: { value: 'Kratzer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }));

    expect((await screen.findAllByText('Bitte fügen Sie mindestens ein Foto des Schadens hinzu.')).length).toBeGreaterThan(0);
    expect(lastCreatePayload).toBeNull();
  });

  it('creates a damaged vehicle and its staged damage photo atomically', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Hersteller'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Modell'), { target: { value: 'TH-Z' } });
    fireEvent.click(screen.getByLabelText('Ja'));
    fireEvent.change(screen.getByLabelText('Schadensbeschreibung'), { target: { value: 'Delle vorne' } });
    fireEvent.change(screen.getByLabelText('Foto des Schadens'), {
      target: { files: [new File(['photo'], 'damage.jpg', { type: 'image/jpeg' })] },
    });
    await screen.findByText('Hochgeladen: damage.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }));

    await screen.findByText('Fahrzeug zum Pool hinzugefügt');
    expect(lastCreatePayload).toMatchObject({
      status: 'available',
      initial_damage_reports: [{
        description: 'Delle vorne',
        severity: 'minor',
        media_file_ids: ['media-1'],
      }],
    });
  });

  it('autofills the category when only one is available', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    expect((screen.getByLabelText('Kategorie') as HTMLSelectElement).value).toBe('cat-1');
  });
});
