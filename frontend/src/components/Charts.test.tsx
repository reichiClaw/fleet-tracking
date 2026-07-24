import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActivityChart, DonutChart } from './Charts';

describe('chart accessibility tables', () => {
  it('clips the full data table through a non-table wrapper', () => {
    const { container } = render(
      <DonutChart
        ariaLabel="Vehicle status"
        centerValue={2}
        segments={[
          { key: 'available', label: 'Available vehicles with a deliberately long label', value: 2, color: 'green' },
        ]}
      />,
    );

    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('visually-hidden', 'chart-data-table');
    expect(container.querySelector('table.visually-hidden')).not.toBeInTheDocument();
  });

  it('uses the same clipped wrapper for activity data', () => {
    render(<ActivityChart ariaLabel="Checkout activity" points={[{ label: '2026-07-24', value: 1 }]} />);

    expect(screen.getByRole('table').parentElement).toHaveClass('visually-hidden', 'chart-data-table');
  });
});
