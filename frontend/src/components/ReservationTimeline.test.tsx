import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '../i18n';
import type { Reservation } from '../api/fleet';
import { ReservationTimeline } from './ReservationTimeline';

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  const start = new Date();
  start.setDate(start.getDate() + 2);
  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  return {
    id: 'res-1',
    vehicle: 'veh-1',
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    reserved_for: 'Crew A',
    status: 'active',
    ...overrides,
  };
}

describe('ReservationTimeline', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  it('renders an accessible timeline with a bar for an active reservation', () => {
    render(<ReservationTimeline reservations={[reservation()]} returnDue={null} />);

    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByText('Crew A')).toBeInTheDocument();
  });

  it('renders nothing when there are no active reservations and no return date', () => {
    const { container } = render(
      <ReservationTimeline reservations={[reservation({ status: 'cancelled' })]} returnDue={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
