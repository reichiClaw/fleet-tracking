import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { VehicleHistory } from '../api/fleet';
import i18n from '../i18n';
import { VehicleConditionTimeline } from './VehicleConditionTimeline';

const history: VehicleHistory = {
  loans: [{
    id: 'loan-1',
    vehicle: 'veh-1',
    borrower_name: 'Alex',
    expected_return_at: '2026-07-17T12:00:00Z',
    actual_return_at: '2026-07-17T11:00:00Z',
    status: 'returned',
    checkout_odometer_km: 100,
    return_odometer_km: 125,
    return_condition_outcome: 'fit',
    created_at: '2026-07-16T08:00:00Z',
  }],
  reservations: [{
    id: 'res-1',
    vehicle: 'veh-1',
    start_at: '2026-07-15T08:00:00Z',
    end_at: '2026-07-15T12:00:00Z',
    reserved_for: 'Crew',
    status: 'fulfilled',
  }],
  check_ins: [],
  manufacturer_checkouts: [],
  damages: [],
  maintenance: [{
    id: 'maint-1',
    vehicle: 'veh-1',
    reason: 'Inspection',
    started_at: '2026-07-18T08:00:00Z',
    start_odometer_km: 125,
    completed_at: '2026-07-18T10:00:00Z',
    completion_odometer_km: 126,
    status: 'completed',
  }],
  timeline: [
    {
      occurred_at: '2026-07-18T10:00:00Z',
      type: 'maintenance_complete',
      id: 'maint-1',
      status: 'completed',
      description: 'Inspection done',
    },
    {
      occurred_at: '2026-07-17T11:00:00Z',
      type: 'loan_return',
      id: 'loan-1',
      status: 'fit',
    },
  ],
  media: [{
    id: 'return-pdf',
    vehicle: 'veh-1',
    related_type: 'loan_return_pdf',
    related_id: 'loan-1',
    media_type: 'pdf',
    original_filename: 'return-en.pdf',
    language: 'en',
    download_url: '/api/v1/media/return-pdf/download/',
    created_at: '2026-07-17T11:01:00Z',
  }, {
    id: 'signature-1',
    vehicle: 'veh-1',
    related_type: 'loan_return',
    related_id: 'loan-1',
    media_type: 'signature',
    original_filename: 'return-signature.png',
    download_url: '/api/v1/media/signature-1/download/',
    created_at: '2026-07-17T11:00:00Z',
  }],
};

describe('VehicleConditionTimeline', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('orders workflow and reservation events newest-first with readings and immutable evidence', () => {
    const { container } = render(<VehicleConditionTimeline history={history} />);

    const titles = Array.from(container.querySelectorAll('.condition-timeline h4')).map((node) => node.textContent);
    expect(titles).toEqual(['Maintenance completed', 'Loan return', 'Reservation']);
    expect(screen.getByText('126 km')).toBeInTheDocument();
    expect(screen.getByText('125 km')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /return-en\.pdf/ }))
      .toHaveAttribute('href', '/api/v1/media/return-pdf/download/');
    expect(screen.getByRole('link', { name: /return-signature\.png/ }))
      .toHaveAttribute('href', '/api/v1/media/signature-1/download/');
  });
});
