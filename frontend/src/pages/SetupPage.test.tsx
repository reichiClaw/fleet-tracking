import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { SetupPage } from './SetupPage';

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('SetupPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/setup/readiness/')) {
        return jsonResponse({
          ready: false,
          effective_role: 'admin',
          capabilities: { is_app_admin: true },
          admin_security: {
            active_admin_exists: true,
            superuser_count: 1,
            temporary_password_count: 1,
            debug: false,
            secure_cookies: true,
          },
          checklist: [
            { id: 'categories', ready: false, count: 0 },
            { id: 'supplier_or_manufacturer', ready: false, count: 0 },
            { id: 'users', ready: true, count: 2 },
            { id: 'vehicles', ready: false, count: 0, announced_awaiting_check_in: 2 },
            { id: 'qr_codes', ready: false, missing_count: 2 },
            { id: 'documents', ready: false, failed_count: 1 },
            { id: 'backup', ready: false, configured: false, status: 'unavailable' },
          ],
        });
      }
      if (url.includes('/companies/duplicates/') || url.includes('/drivers/duplicates/')) return jsonResponse([]);
      if (url.includes('/drivers/')) return jsonResponse([]);
      if (url.includes('/imports/')) return jsonResponse([]);
      if (url.includes('/dashboard/tasks/')) {
        return jsonResponse({ groups: { arrivals_awaiting_check_in: { count: 2, items: [] } } });
      }
      if (url.includes('/documents/register/')) return jsonResponse([]);
      if (url.includes('/users/')) return jsonResponse([]);
      return jsonResponse([]);
    }));
  });

  it('shows resumable dependency steps with direct deep links', async () => {
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'First-run setup' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Categories and meter modes' })).toBeInTheDocument();
    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage categories' })).toHaveAttribute('href', '/app/categories');
    expect(screen.getByRole('link', { name: 'Import vehicles' })).toHaveAttribute('href', '/app/imports');
    expect(screen.getByRole('link', { name: 'Open pending check-ins' })).toHaveAttribute(
      'href',
      '/app/tasks#arrivals_awaiting_check_in',
    );
    expect(screen.getByRole('link', { name: 'Manage QR labels' })).toHaveAttribute('href', '/app/qr/print');
    expect(screen.getByRole('link', { name: 'Open document register' })).toHaveAttribute('href', '/app/documents');
  });
});
