import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field } from './Field';
import { FormErrorSummary } from './FormErrorSummary';

describe('accessible form errors', () => {
  it('associates a stable field id, required state, hint, and error', () => {
    const { rerender } = render(
      <Field label="Serial number" hint="Printed on the frame" required>
        <input />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Serial number' });
    const id = input.id;
    expect(id).not.toBe('');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAccessibleDescription('Printed on the frame');

    rerender(
      <Field label="Serial number" error="Serial number is required" required>
        <input />
      </Field>,
    );
    expect(input.id).toBe(id);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Serial number is required');
  });

  it('focuses the first invalid field after rendering the error summary', async () => {
    render(
      <form>
        <FormErrorSummary errors={{ first: 'First is required', second: 'Second is required' }} />
        <Field label="First" error="First is required"><input /></Field>
        <Field label="Second" error="Second is required"><input /></Field>
      </form>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('First is required');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'First' })).toHaveFocus());
  });
});
