import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acknowledgeAuthRecovery,
  apiClient,
  ApiError,
  AUTH_CONTINUATION_KEY,
  AUTH_EXPIRED_EVENT,
} from './client';

describe('apiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'csrftoken=; Max-Age=0; path=/';
    window.localStorage.clear();
    window.sessionStorage.clear();
    acknowledgeAuthRecovery();
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

  it('bootstraps CSRF before the first unsafe request', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith('/auth/csrf/')) {
        document.cookie = 'csrftoken=bootstrapped-token; path=/';
        return Promise.resolve(new Response(JSON.stringify({ detail: 'ok' }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient.post('/auth/login/', { username: 'ada', password: 'secret' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/csrf/');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-CSRFToken': 'bootstrapped-token' }),
    }));
  });

  it('parses the standardized backend error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: {
        code: 'invalid',
        message: 'Request validation failed.',
        details: { vehicle: ['Only available vehicles can be loaned.'] },
      },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }))));

    await expect(apiClient.get('/vehicles/')).rejects.toMatchObject({
      status: 400,
      code: 'invalid',
      message: 'Request validation failed.',
      details: { vehicle: ['Only available vehicles can be loaned.'] },
    });
  });

  it.each([401, 403])('dispatches auth expiry once for a %s unauthenticated response', async (status) => {
    window.history.pushState({}, '', '/app/qr?mode=scan#camera');
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { code: 'not_authenticated', message: 'Authentication required.', details: {} },
    }), { status, headers: { 'Content-Type': 'application/json' } }))));

    await expect(apiClient.get('/vehicles/')).rejects.toBeInstanceOf(ApiError);
    await expect(apiClient.get('/vehicles/')).rejects.toBeInstanceOf(ApiError);

    expect(expired).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(AUTH_CONTINUATION_KEY)).toBe('/app/qr?mode=scan#camera');
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });

  it('does not treat an authenticated permission denial as session expiry', async () => {
    document.cookie = 'csrftoken=test-token; path=/';
    const expired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { code: 'permission_denied', message: 'Permission denied.', details: {} },
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }))));

    await expect(apiClient.post('/users/', {})).rejects.toBeInstanceOf(ApiError);

    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  });
});
