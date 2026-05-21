import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import i18n from '../i18n';
import { StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
  });

  it('renders stable backend vehicle status codes as translated German labels', () => {
    render(<StatusBadge status="manufacturer_checkout" />);

    expect(screen.getByText('An Hersteller ausgecheckt')).toBeInTheDocument();
  });

  it('renders stable backend loan status codes as translated English labels', async () => {
    await i18n.changeLanguage('en');

    render(<StatusBadge status="returned" />);

    expect(screen.getByText('Returned')).toBeInTheDocument();
  });
});
