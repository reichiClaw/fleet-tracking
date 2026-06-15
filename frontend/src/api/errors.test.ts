import { describe, expect, it } from 'vitest';

import { ApiError } from './client';
import { getApiErrorMessage } from './errors';

const t = (key: string) => key;

describe('getApiErrorMessage', () => {
  it('surfaces a DRF field validation message with a humanized label', () => {
    const error = new ApiError(400, 'Bad Request', {
      vehicle: ['Only available or checked-in vehicles can be loaned.'],
    });

    expect(getApiErrorMessage(error, t)).toBe('Vehicle: Only available or checked-in vehicles can be loaned.');
  });

  it('humanizes snake_case field names', () => {
    const error = new ApiError(400, 'Bad Request', {
      checkout_odometer_km: ['Odometer value must not decrease.'],
    });

    expect(getApiErrorMessage(error, t)).toBe('Checkout odometer km: Odometer value must not decrease.');
  });

  it('omits the label for detail and non-field errors', () => {
    expect(getApiErrorMessage(new ApiError(400, 'Bad', { detail: 'Invalid input.' }), t)).toBe('Invalid input.');
    expect(
      getApiErrorMessage(new ApiError(400, 'Bad', { non_field_errors: ['Unable to log in.'] }), t),
    ).toBe('Unable to log in.');
  });

  it('joins multiple field errors into one message', () => {
    const error = new ApiError(400, 'Bad Request', {
      borrower_name: ['Borrower name is required.'],
      expected_return_at: ['This field is required.'],
    });

    const message = getApiErrorMessage(error, t);
    expect(message).toContain('Borrower name: Borrower name is required.');
    expect(message).toContain('Expected return at: This field is required.');
  });

  it('maps status codes to clear guidance when no detail is provided', () => {
    expect(getApiErrorMessage(new ApiError(403, 'Forbidden', null), t)).toBe('errors.permission');
    expect(getApiErrorMessage(new ApiError(404, 'Not Found', {}), t)).toBe('errors.notFound');
    expect(getApiErrorMessage(new ApiError(429, 'Too Many Requests', {}), t)).toBe('errors.throttled');
    expect(getApiErrorMessage(new ApiError(500, 'Server Error', undefined), t)).toBe('errors.server');
  });

  it('falls back to the provided context message for other 4xx without details', () => {
    expect(getApiErrorMessage(new ApiError(400, 'Bad', {}), t, 'context fallback')).toBe('context fallback (400)');
  });

  it('treats non-API errors as connection failures', () => {
    expect(getApiErrorMessage(new TypeError('Failed to fetch'), t)).toBe('errors.connection');
  });
});
