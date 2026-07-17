import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import i18n from '../i18n';
import { ChangePasswordPage } from './ChangePasswordPage';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('ChangePasswordPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'csrftoken=test-token; path=/';
    await i18n.changeLanguage('en');
  });

  it('changes the signed-in user password and clears the mandatory state', async () => {
    let changed = false;
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me/')) {
        return jsonResponse({
          id: 'user-1',
          username: 'operator',
          display_name: 'Operator',
          role: 'operations',
          must_change_password: !changed,
        });
      }
      if (url.endsWith('/users/user-1/set-password/') && init?.method === 'POST') {
        requestBody = JSON.parse(String(init.body));
        changed = true;
        return jsonResponse(null, 204);
      }
      return jsonResponse({ detail: 'not found' }, 404);
    }));
    const router = createMemoryRouter([{
      path: '*',
      element: (
        <AuthProvider>
          <ChangePasswordPage />
        </AuthProvider>
      ),
    }], { initialEntries: ['/app/change-password'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/must choose a permanent password/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'temporary' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Permanent-Password-42!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Permanent-Password-42!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/password was changed/i)).toBeInTheDocument();
    await waitFor(() => expect(requestBody).toEqual({
      current_password: 'temporary',
      new_password: 'Permanent-Password-42!',
    }));
  });
});
