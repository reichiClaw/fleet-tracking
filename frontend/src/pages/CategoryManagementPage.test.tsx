import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import { CategoryManagementPage } from './CategoryManagementPage';

let categories: Array<{ id: string; name: string; description: string; is_active: boolean }>;

function response(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function installFetchMock() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/vehicle-categories/') && method === 'GET') return response(categories);
    if (url.endsWith('/vehicle-categories/') && method === 'POST') {
      const body = JSON.parse(String(init?.body));
      categories = [...categories, { id: 'cat-2', description: '', is_active: true, ...body }];
      return response(categories.at(-1), 201);
    }
    const detail = url.match(/\/vehicle-categories\/([^/]+)\/$/);
    if (detail && method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      categories = categories.map((category) => category.id === detail[1] ? { ...category, ...body } : category);
      return response(categories.find((category) => category.id === detail[1]));
    }
    const deactivate = url.match(/\/vehicle-categories\/([^/]+)\/deactivate\/$/);
    if (deactivate && method === 'POST') {
      categories = categories.map((category) =>
        category.id === deactivate[1] ? { ...category, is_active: false } : category);
      return response(categories.find((category) => category.id === deactivate[1]));
    }
    return response({ error: { code: 'not_found', message: 'Not found', details: {} } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('CategoryManagementPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.cookie = 'csrftoken=test-token; path=/';
    categories = [{ id: 'cat-1', name: 'Lift', description: 'Existing', is_active: true }];
    installFetchMock();
    await i18n.changeLanguage('de');
  });

  it('creates and edits categories through the category API', async () => {
    render(<CategoryManagementPage />);
    await screen.findByRole('heading', { name: 'Lift' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('heading', { name: 'Crane' })).toBeInTheDocument();

    const card = screen.getByRole('heading', { name: 'Crane' }).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Bearbeiten' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tower crane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('heading', { name: 'Tower crane' })).toBeInTheDocument();
  });

  it('confirms category deactivation and announces success', async () => {
    render(<CategoryManagementPage />);
    const card = (await screen.findByRole('heading', { name: 'Lift' })).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Deaktivieren' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deaktivieren' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Kategorie deaktiviert'));
    const updatedCard = screen.getByRole('heading', { name: 'Lift' }).closest('article') as HTMLElement;
    expect(within(updatedCard).queryByRole('button', { name: 'Deaktivieren' })).not.toBeInTheDocument();
  });
});
