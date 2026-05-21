import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import App from './App';
import i18n, { LANGUAGE_STORAGE_KEY } from './i18n';

describe('App smoke flow', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/');
    await i18n.changeLanguage('de');
  });

  it('renders the German login page by default', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByLabelText('Sprache')).toHaveValue('de');
  });

  it('persists the selected English language', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Sprache'), { target: { value: 'en' } });

    await waitFor(() => expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en'));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs in and shows role-aware navigation', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'secret' } });
    fireEvent.change(screen.getByLabelText('Rolle'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fahrzeugpool' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importe' })).toBeInTheDocument();
  });
});
