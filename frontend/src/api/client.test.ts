import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from './client';

describe('apiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'csrftoken=; Max-Age=0; path=/';
    window.localStorage.clear();
  });

  it('sends the CSRF cookie value on unsafe session-authenticated requests', async () => {
    document.cookie = 'csrftoken=test-token; path=/';
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.post('/companies/', { name: 'SubCo' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/companies/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-CSRFToken': 'test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('does not attach a CSRF header to safe requests', async () => {
    document.cookie = 'csrftoken=test-token; path=/';
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.get('/vehicles/');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/vehicles/',
      expect.objectContaining({
        method: 'GET',
        headers: expect.not.objectContaining({ 'X-CSRFToken': 'test-token' }),
      }),
    );
  });
});
