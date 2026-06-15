const DEFAULT_API_BASE_URL = '/api/v1';
const LANGUAGE_STORAGE_KEY = 'fleet-language';
const SUPPORTED_REQUEST_LANGUAGES = new Set(['de', 'en']);
const CSRF_COOKIE_NAME = 'csrftoken';
const CSRF_HEADER_NAME = 'X-CSRFToken';
const CSRF_PATH = '/auth/csrf/';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown>;
  language?: string;
};

function normalizeLanguage(language?: string | null) {
  const code = language?.split('-', 1)[0]?.toLowerCase();
  return code && SUPPORTED_REQUEST_LANGUAGES.has(code) ? code : undefined;
}

function resolveRequestLanguage(language?: string) {
  if (language) {
    return normalizeLanguage(language);
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  return (
    normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)) ??
    normalizeLanguage(document.documentElement.lang) ??
    normalizeLanguage(window.navigator.language) ??
    'de'
  );
}

function getCookie(name: string) {
  if (typeof document === 'undefined') {
    return undefined;
  }

  const match = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

function isUnsafeMethod(method?: string) {
  return UNSAFE_METHODS.has((method ?? 'GET').toUpperCase());
}

let csrfBootstrap: Promise<void> | null = null;

async function ensureCsrfToken() {
  if (getCookie(CSRF_COOKIE_NAME)) {
    return;
  }
  // Django only issues the CSRF cookie on demand. Fetch it once so that
  // authenticated writes (which require X-CSRFToken) work after a reload or
  // before the first login, not only immediately after logging in.
  if (!csrfBootstrap) {
    csrfBootstrap = fetch(buildApiUrl(CSRF_PATH), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        csrfBootstrap = null;
      });
  }
  await csrfBootstrap;
}

export function buildApiUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalizedPath}`;
  if (!query) {
    return url;
  }

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  });

  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, language, ...requestInit } = options;
  const isFormData = body instanceof FormData;
  const requestLanguage = resolveRequestLanguage(language);
  if (isUnsafeMethod(requestInit.method)) {
    await ensureCsrfToken();
  }
  const csrfToken = isUnsafeMethod(requestInit.method) ? getCookie(CSRF_COOKIE_NAME) : undefined;

  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    ...requestInit,
    headers: {
      Accept: 'application/json',
      ...(requestLanguage ? { 'Accept-Language': requestLanguage } : {}),
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
      ...(!isFormData && body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body && !isFormData && typeof body !== 'string' ? JSON.stringify(body) : body,
  });

  if (!response.ok) {
    let details: unknown;
    try {
      details = await response.json();
    } catch {
      details = undefined;
    }
    throw new ApiError(response.status, response.statusText, details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
