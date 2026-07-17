import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { AuditLogPage } from './AuditLogPage';

function jsonResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('AuditLogPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  it('filters audit events, links entities, expands localized diffs, and exports CSV', async () => {
    const requestedAuditUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/users/')) {
        return jsonResponse([{
          id: 'user-1',
          username: 'admin',
          full_name: 'Site Admin',
          role: 'admin',
          is_active: true,
        }]);
      }
      if (url.includes('/audit-logs/')) {
        requestedAuditUrls.push(url);
        return jsonResponse([{
          id: 'audit-1',
          actor: 'user-1',
          actor_label: 'Site Admin',
          action: 'import.vehicle.committed',
          entity_type: 'import_job',
          entity_id: 'job-1',
          before: { status: 'validated' },
          after: { status: 'committed' },
          created_at: '2026-07-16T10:00:00Z',
        }]);
      }
      return jsonResponse([]);
    }));
    render(
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
    const entityLinks = screen.getAllByRole('link', { name: /Import job/ });
    expect(entityLinks).toHaveLength(2);
    entityLinks.forEach((link) => expect(link).toHaveAttribute('href', '/app/imports?job=job-1'));
    fireEvent.click(screen.getAllByText(/Show 1 changed field/)[0]);
    expect(screen.getAllByText('Status').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('validated').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('committed').length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText('Area'), { target: { value: 'import.' } });
    fireEvent.focus(screen.getByLabelText('Actor'));
    fireEvent.click(await screen.findByRole('option', { name: 'Site Admin' }));
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => expect(requestedAuditUrls.some((url) => (
      url.includes('action=import.') && url.includes('actor=user-1') && url.includes('date_from=2026-07-01')
    ))).toBe(true));
    const header = screen.getByRole('heading', { name: 'Audit log' }).closest('.page-header') as HTMLElement;
    const exportLink = within(header).getByRole('link', { name: 'Export filtered CSV' });
    expect(exportLink.getAttribute('href')).toContain('/api/v1/audit-logs/export-csv/');
    expect(exportLink.getAttribute('href')).toContain('action=import.');
  });
});
