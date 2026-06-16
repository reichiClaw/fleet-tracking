import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AddVehiclePage } from './AddVehiclePage';

let categories = [{ id: 'cat-1', name: 'Steiger', is_active: true }];

let lastCreatePayload: Record<string, unknown> | null = null;

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
    if (url.endsWith('/vehicles/') && method === 'POST') {
      lastCreatePayload = JSON.parse(String(init?.body));
      return jsonResponse({ id: 'veh-9', internal_number: 'FZ-00009', manufacturer: 'Acme', model: 'TH-Z' }, 201);
    }
    return jsonResponse({ detail: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('AddVehiclePage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    lastCreatePayload = null;
    categories = [{ id: 'cat-1', name: 'Steiger', is_active: true }];
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a new vehicle with master-data fields and adds it to the pool', async () => {
    render(
      <MemoryRouter>
        <AddVehiclePage />
      </MemoryRouter>,
    );

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
    render(
      <MemoryRouter>
        <AddVehiclePage />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }));

    expect(await screen.findByText('Bitte wählen Sie eine Kategorie aus.')).toBeInTheDocument();
    expect(screen.getByText('Bitte geben Sie den Hersteller ein.')).toBeInTheDocument();
    expect(screen.getByText('Bitte geben Sie das Modell ein.')).toBeInTheDocument();
    expect(lastCreatePayload).toBeNull();
  });

  it('blocks adding a damaged vehicle without a damage photo', async () => {
    render(
      <MemoryRouter>
        <AddVehiclePage />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    fireEvent.change(screen.getByLabelText('Hersteller'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Modell'), { target: { value: 'TH-Z' } });
    fireEvent.click(screen.getByLabelText('Dieses Fahrzeug hat einen Schaden'));
    fireEvent.change(screen.getByLabelText('Schadensbeschreibung'), { target: { value: 'Kratzer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fahrzeug hinzufügen' }));

    expect(
      await screen.findByText('Bitte fügen Sie mindestens ein Foto des Schadens hinzu.'),
    ).toBeInTheDocument();
    expect(lastCreatePayload).toBeNull();
  });

  it('autofills the category when only one is available', async () => {
    render(
      <MemoryRouter>
        <AddVehiclePage />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Fahrzeug zum Pool hinzufügen' });
    expect((screen.getByLabelText('Kategorie') as HTMLSelectElement).value).toBe('cat-1');
  });
});
