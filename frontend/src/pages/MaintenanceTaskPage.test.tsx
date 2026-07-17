import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { MaintenanceTaskPage } from './MaintenanceTaskPage';

const vehicle = {
  id: 'veh-1',
  qr_code: 'QR-1',
  internal_number: 'FZ-1',
  category: 'cat-1',
  manufacturer: 'Acme',
  model: 'Lift',
  license_plate: 'B-AB 1',
  serial_number: 'SN-1',
  current_location: 'Berlin',
  status: 'damaged',
};

let lastAction: { url: string; payload: Record<string, unknown> } | null;
let draftVersion: number;

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function installFetchMock() {
  document.cookie = 'csrftoken=test-token; path=/';
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/vehicles/veh-1/workflow-context/')) {
      return response({
        vehicle,
        meter: { mode: 'none', odometer_km: null, operating_hours: null },
        active_loan: null,
        open_damages: [{
          id: 'damage-1',
          vehicle: 'veh-1',
          description: 'Bent rail',
          severity: 'major',
          discovered_at: '2026-07-16T10:00:00Z',
          resolved_at: null,
        }],
        reservations: [],
        active_maintenance: null,
        capabilities: {
          can_send_to_maintenance: true,
          can_complete_maintenance: true,
        },
      });
    }
    if (url.endsWith('/vehicles/veh-1/media/')) return response([]);
    if (url.endsWith('/vehicle-categories/cat-1/')) {
      return response({ id: 'cat-1', name: 'Lift', meter_mode: 'none', is_active: true });
    }
    if (url.endsWith('/workflow-drafts/') && method === 'POST') {
      draftVersion += 1;
      const body = JSON.parse(String(init?.body));
      return response({
        id: 'draft-maintenance',
        owner: 'user-1',
        version: draftVersion,
        expires_at: '2026-08-01T00:00:00Z',
        created_at: '2026-07-17T00:00:00Z',
        updated_at: '2026-07-17T00:00:00Z',
        ...body,
      }, draftVersion === 1 ? 201 : 200);
    }
    if (url.endsWith('/workflow-drafts/draft-maintenance/discard/') && method === 'POST') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (
      method === 'POST'
      && (
        url.endsWith('/vehicles/veh-1/send-to-maintenance/')
        || url.endsWith('/vehicles/veh-1/complete-maintenance/')
        || url.endsWith('/damage-reports/damage-1/resolve/')
      )
    ) {
      lastAction = { url, payload: JSON.parse(String(init?.body)) };
      if (url.includes('/damage-reports/')) {
        return response({ id: 'damage-1', vehicle: 'veh-1', description: 'Bent rail', resolved_at: new Date().toISOString() });
      }
      return response({
        maintenance: { id: 'maint-1', vehicle: 'veh-1', reason: 'Inspection', started_at: new Date().toISOString(), status: 'active' },
        vehicle: { ...vehicle, status: url.includes('complete-maintenance') ? 'available' : 'maintenance' },
      });
    }
    return response({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
  }));
}

function renderPage(action: 'start' | 'complete' | 'resolve') {
  const damage = action === 'resolve' ? '&damage=damage-1' : '';
  const router = createMemoryRouter(
    [{ path: '*', element: <MaintenanceTaskPage /> }],
    { initialEntries: [`/app/tasks/maintenance?vehicle=veh-1&action=${action}${damage}`] },
  );
  return render(<RouterProvider router={router} />);
}

async function reachActionStep() {
  expect(await screen.findByRole('region', { name: 'Selected vehicle' })).toHaveTextContent('B-AB 1');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

async function reachReview(notesLabel = 'Notes') {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(screen.getByLabelText(notesLabel), { target: { value: 'Work completed safely' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByRole('heading', { level: 3, name: 'Review / confirm' })).toBeInTheDocument();
}

describe('MaintenanceTaskPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    lastAction = null;
    draftVersion = 0;
    installFetchMock();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts maintenance with the required reason and confirms the resulting status', async () => {
    renderPage('start');
    await reachActionStep();
    fireEvent.change(screen.getByLabelText('Maintenance reason'), { target: { value: 'Hydraulic inspection' } });
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Send to maintenance' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Condition task completed' })).toBeInTheDocument();
    expect(lastAction?.url).toContain('/vehicles/veh-1/send-to-maintenance/');
    expect(lastAction?.payload).toMatchObject({
      reason: 'Hydraulic inspection',
      notes: 'Work completed safely',
      media_file_ids: [],
    });
  });

  it('completes maintenance without inventing a client-side status', async () => {
    renderPage('complete');
    await reachActionStep();
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Complete maintenance' }));

    expect(await screen.findByText('Resulting status: Available')).toBeInTheDocument();
    expect(lastAction?.url).toContain('/vehicles/veh-1/complete-maintenance/');
    expect(lastAction?.payload).not.toHaveProperty('status');
  });

  it('resolves the preselected damage with resolution notes', async () => {
    renderPage('resolve');
    await reachActionStep();
    expect(screen.getByLabelText('Open damage report')).toHaveValue('damage-1');
    await reachReview('Resolution notes');
    fireEvent.click(screen.getByRole('button', { name: 'Resolve damage' }));

    expect(await screen.findByRole('heading', { level: 3, name: 'Condition task completed' })).toBeInTheDocument();
    expect(lastAction).toMatchObject({
      url: expect.stringContaining('/damage-reports/damage-1/resolve/'),
      payload: { resolution_notes: 'Work completed safely' },
    });
  });
});
