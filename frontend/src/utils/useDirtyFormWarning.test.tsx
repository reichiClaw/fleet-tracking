import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';

import { useDirtyFormWarning } from './useDirtyFormWarning';

function DirtyPage() {
  useDirtyFormWarning(true, 'Unsaved changes');
  return <Link to="/next">Next page</Link>;
}

function routerAtDirtyPage() {
  return createMemoryRouter(
    [
      { path: '/previous', element: <p>Previous page</p> },
      { path: '/form', element: <DirtyPage /> },
      { path: '/next', element: <p>Next page</p> },
    ],
    {
      initialEntries: ['/previous', '/form'],
      initialIndex: 1,
    },
  );
}

describe('useDirtyFormWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks browser back navigation when the user cancels', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const router = routerAtDirtyPage();
    render(<RouterProvider router={router} />);

    void router.navigate(-1);

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Unsaved changes'));
    expect(router.state.location.pathname).toBe('/form');
    expect(screen.queryByText('Previous page')).not.toBeInTheDocument();
  });

  it('allows router navigation when the user confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const router = routerAtDirtyPage();
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole('link', { name: 'Next page' }));

    expect(await screen.findByText('Next page', { selector: 'p' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/next');
  });

  it('marks page unload as cancelled while the form is dirty', () => {
    const router = routerAtDirtyPage();
    render(<RouterProvider router={router} />);
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
