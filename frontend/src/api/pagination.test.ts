import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAllPages } from './pagination';

function response(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('fetchAllPages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('follows next links and returns records beyond the 50-row API page size', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/vehicles/')) {
        return response({
          count: 101,
          next: '/vehicles/?page=2',
          previous: null,
          results: Array.from({ length: 50 }, (_, index) => index + 1),
        });
      }
      if (url.endsWith('/vehicles/?page=2')) {
        return response({
          count: 101,
          next: '/vehicles/?page=3',
          previous: '/vehicles/',
          results: Array.from({ length: 50 }, (_, index) => index + 51),
        });
      }
      return response({ count: 101, next: null, previous: '/vehicles/?page=2', results: [101] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const records = await fetchAllPages<number>('/vehicles/');

    expect(records).toHaveLength(101);
    expect(records.at(-1)).toBe(101);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails visibly instead of returning truncated data at a safety limit', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response({
      count: 2,
      next: '/vehicles/?page=2',
      previous: null,
      results: [1],
    })));

    await expect(fetchAllPages<number>('/vehicles/', { maxPages: 1 })).rejects.toThrow('1-page safety limit');
  });

  it('detects cyclic next links', async () => {
    vi.stubGlobal('fetch', vi.fn(() => response({
      count: 2,
      next: '/vehicles/',
      previous: null,
      results: [1],
    })));

    await expect(fetchAllPages<number>('/vehicles/')).rejects.toThrow('Pagination cycle');
  });
});
