import { describe, expect, it } from 'vitest';

import { vehicleStatusActions } from './VehicleStatusPage';

describe('vehicleStatusActions', () => {
  it('offers every backend-supported action for an available vehicle', () => {
    expect(vehicleStatusActions('available', 'vehicle-1', null)).toEqual([
      {
        key: 'loanCheckout',
        to: '/app/workflows/loan-checkout?vehicle=vehicle-1',
        primary: true,
      },
      {
        key: 'manufacturerCheckout',
        to: '/app/workflows/manufacturer-return?vehicle=vehicle-1',
        primary: false,
      },
      {
        key: 'details',
        to: '/app/vehicles/vehicle-1',
        primary: false,
      },
    ]);
  });

  it('does not expose manufacturer checkout from unsupported states', () => {
    expect(vehicleStatusActions('maintenance', 'vehicle-1', null).map((action) => action.key))
      .toEqual(['details']);
  });
});
