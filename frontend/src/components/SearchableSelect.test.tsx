import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { SearchableSelect } from './SearchableSelect';

const options = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
];

function Harness() {
  const [value, setValue] = useState('');
  return (
    <>
      <SearchableSelect
        label="Vehicle"
        options={options}
        value={value}
        onChange={setValue}
        emptyText="No matches"
        required
      />
      <button type="button">Outside</button>
    </>
  );
}

describe('SearchableSelect', () => {
  it('implements combobox keyboard navigation and selection', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Vehicle' });

    act(() => input.focus());
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Vehicle' })).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Alpha' }).id);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Beta' }).id);
    fireEvent.keyDown(input, { key: 'End' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Gamma' }).id);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(input).toHaveValue('Gamma');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-controls');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(input).toHaveFocus();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Alpha' }).id);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('Gamma');
  });

  it('filters options and closes when focus moves outside', () => {
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Vehicle' });
    fireEvent.change(input, { target: { value: 'bet' } });

    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
