import { apiClient } from './client';

export type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type PageResult<T> = PaginatedResponse<T> & {
  page: number;
  pageSize?: number;
};

export type FetchAllOptions = {
  maxPages?: number;
  maxRecords?: number;
};

const DEFAULT_MAX_PAGES = 200;
const DEFAULT_MAX_RECORDS = 20_000;

export function isPaginatedResponse<T>(value: T[] | PaginatedResponse<T>): value is PaginatedResponse<T> {
  return !Array.isArray(value);
}

export function normalizePage<T>(value: T[] | PaginatedResponse<T>, page = 1): PageResult<T> {
  if (Array.isArray(value)) {
    return { count: value.length, next: null, previous: null, results: value, page, pageSize: value.length || 50 };
  }
  return { ...value, page, pageSize: 50 };
}

/**
 * Follow every server-provided `next` link. Limits fail visibly instead of
 * returning a truncated data set, which is critical for exports and selectors.
 */
export async function fetchAllPages<T>(
  path: string,
  { maxPages = DEFAULT_MAX_PAGES, maxRecords = DEFAULT_MAX_RECORDS }: FetchAllOptions = {},
): Promise<T[]> {
  const records: T[] = [];
  const visited = new Set<string>();
  let next: string | null = path;
  let pageCount = 0;

  while (next) {
    if (visited.has(next)) {
      throw new Error('Pagination cycle detected.');
    }
    if (pageCount >= maxPages) {
      throw new Error(`Pagination exceeded the ${maxPages}-page safety limit.`);
    }
    visited.add(next);
    pageCount += 1;

    const response: T[] | PaginatedResponse<T> = await apiClient.get<T[] | PaginatedResponse<T>>(next);
    const page: PageResult<T> = normalizePage<T>(response, pageCount);
    records.push(...page.results);
    if (records.length > maxRecords) {
      throw new Error(`Pagination exceeded the ${maxRecords}-record safety limit.`);
    }
    next = page.next;
  }

  return records;
}
