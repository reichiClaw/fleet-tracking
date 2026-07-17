import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { OperatorTaskBoard } from './OperatorTaskBoard';

const mocks = vi.hoisted(() => ({
  discard: vi.fn(),
  getTasks: vi.fn(),
  listDrafts: vi.fn(),
  role: 'operations' as 'admin' | 'operations' | 'readonly',
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Operator', role: mocks.role } }),
}));

vi.mock('../api/fleet', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/fleet')>();
  return {
    ...original,
    discardWorkflowDraft: mocks.discard,
    getDashboardTasks: mocks.getTasks,
    listWorkflowDraftPage: mocks.listDrafts,
  };
});

const groups = {
  arrivals_awaiting_check_in: {
    count: 1,
    items: [{ vehicle_id: 'veh-arrival', related_id: null, label: 'Arrival', status: 'announced' }],
  },
  overdue_returns: {
    count: 1,
    items: [{ vehicle_id: 'veh-loan', related_id: 'loan-1', label: 'Overdue', status: 'loaned' }],
  },
  reservation_handovers: {
    count: 1,
    items: [{ vehicle_id: 'veh-res', related_id: 'res-1', label: 'Reserved', status: 'available' }],
  },
  condition_attention: {
    count: 1,
    items: [{
      vehicle_id: 'veh-maint',
      related_id: null,
      label: 'Maintenance',
      status: 'maintenance',
      next_action: { action: 'maintenance_complete', method: 'POST', url: '/api/v1/vehicles/veh-maint/complete-maintenance/' },
    }],
  },
  failed_documents: {
    count: 1,
    items: [{
      vehicle_id: 'veh-doc',
      record_id: 'record-1',
      document_type: 'loan_return_pdf',
      label: 'Failed PDF',
      status: 'failed',
    }],
  },
  manufacturer_returns_due: {
    count: 1,
    items: [{ vehicle_id: 'veh-maker', related_id: null, label: 'Maker due', status: 'available' }],
  },
};

function renderBoard() {
  return render(
    <MemoryRouter>
      <OperatorTaskBoard />
    </MemoryRouter>,
  );
}

describe('OperatorTaskBoard', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.role = 'operations';
    mocks.getTasks.mockResolvedValue({
      generated_at: '2026-07-17T06:00:00Z',
      count: 6,
      groups,
    });
    mocks.listDrafts.mockResolvedValue({
      count: 1,
      next: null,
      previous: null,
      page: 1,
      pageSize: 25,
      results: [{
        id: 'draft-intake',
        workflow_type: 'check_in',
        scope_key: 'intake-1',
        object_id: null,
        form_data: { intake: true },
        staged_media_ids: [],
        step: 1,
        version: 1,
        owner: 'user-1',
        expires_at: '2026-08-01T00:00:00Z',
        created_at: '2026-07-17T05:00:00Z',
        updated_at: '2026-07-17T05:30:00Z',
      }],
    });
    mocks.discard.mockResolvedValue(undefined);
    await i18n.changeLanguage('en');
  });

  it('links every attention group directly to its preselected workflow', async () => {
    renderBoard();

    expect(await screen.findByRole('link', { name: 'Check in vehicle' }))
      .toHaveAttribute('href', '/app/workflows/check-in?vehicle=veh-arrival');
    expect(screen.getByRole('link', { name: 'Return loan' }))
      .toHaveAttribute('href', '/app/workflows/loan-return?loan=loan-1');
    expect(screen.getByRole('link', { name: 'Loan vehicle' }))
      .toHaveAttribute('href', '/app/workflows/loan-checkout?vehicle=veh-res&reservation=res-1');
    expect(screen.getByRole('link', { name: 'Open task' }))
      .toHaveAttribute('href', '/app/tasks/maintenance?vehicle=veh-maint&action=complete');
    expect(screen.getByRole('link', { name: 'Open document' }))
      .toHaveAttribute('href', '/app/reports?status=failed&record=record-1&type=loan_return_pdf');
    expect(screen.getByRole('link', { name: 'Return to manufacturer' }))
      .toHaveAttribute('href', '/app/workflows/manufacturer-return?vehicle=veh-maker');
  });

  it('offers intake draft resume and discard controls', async () => {
    renderBoard();

    expect(await screen.findByRole('link', { name: 'Resume' }))
      .toHaveAttribute('href', '/app/workflows/intake?draft=draft-intake');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(mocks.discard).toHaveBeenCalledWith('draft-intake');
    expect(await screen.findByText('Announced arrivals')).toBeInTheDocument();
  });

  it('gives read-only users detail links and never requests mutable drafts', async () => {
    mocks.role = 'readonly';
    renderBoard();

    const detailLinks = await screen.findAllByRole('link', { name: 'Details' });
    expect(detailLinks[0]).toHaveAttribute('href', '/app/vehicles/veh-arrival');
    expect(mocks.listDrafts).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });
});
