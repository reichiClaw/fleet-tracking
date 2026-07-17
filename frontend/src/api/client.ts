const DEFAULT_API_BASE_URL = '/api/v1';
const LANGUAGE_STORAGE_KEY = 'fleet-language';
const SUPPORTED_REQUEST_LANGUAGES = new Set(['de', 'en']);
const CSRF_COOKIE_NAME = 'csrftoken';
const CSRF_HEADER_NAME = 'X-CSRFToken';
const CSRF_PATH = '/auth/csrf/';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const AUTH_EXPIRED_EVENT = 'fleet:auth-expired';
export const AUTH_CONTINUATION_KEY = 'fleet-auth-continuation';
export const API_CONNECTIVITY_EVENT = 'fleet:api-connectivity';
const DEFAULT_GET_TIMEOUT_MS = 15_000;
const DEFAULT_WRITE_TIMEOUT_MS = 60_000;
const SAFE_GET_RETRY_DELAY_MS = 250;
const RETRYABLE_GET_STATUSES = new Set([502, 503, 504]);

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, message: string, details?: unknown, code = 'error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown>;
  language?: string;
  timeoutMs?: number;
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
let authExpiryDispatched = false;

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
      .then(async (response) => {
        if (!response.ok) {
          throw await apiErrorFromResponse(response);
        }
      })
      .finally(() => {
        csrfBootstrap = null;
      });
  }
  await csrfBootstrap;
}

export function buildApiUrl(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
  if (/^https?:\/\//i.test(path)) {
    if (!query) return path;
    const absolute = new URL(path);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') absolute.searchParams.set(key, String(value));
    });
    return absolute.toString();
  }
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

async function apiErrorFromResponse(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const envelope = body as ErrorEnvelope | undefined;
  const payload = envelope?.error;
  return new ApiError(
    response.status,
    payload?.message || response.statusText || 'Request failed',
    payload ? payload.details : body,
    payload?.code || 'error',
  );
}

function notifyAuthExpired(path: string) {
  if (
    authExpiryDispatched ||
    typeof window === 'undefined' ||
    path.includes('/auth/login/') ||
    path.includes('/auth/me/')
  ) return;
  authExpiryDispatched = true;
  const continuation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (continuation !== '/login' && !continuation.startsWith('/login?')) {
    window.sessionStorage.setItem(AUTH_CONTINUATION_KEY, continuation);
  }
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
}

export function acknowledgeAuthRecovery() {
  authExpiryDispatched = false;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, language, timeoutMs, signal: suppliedSignal, ...requestInit } = options;
  const isFormData = body instanceof FormData;
  const requestLanguage = resolveRequestLanguage(language);
  if (isUnsafeMethod(requestInit.method)) {
    await ensureCsrfToken();
  }
  const csrfToken = isUnsafeMethod(requestInit.method) ? getCookie(CSRF_COOKIE_NAME) : undefined;

  const method = (requestInit.method ?? 'GET').toUpperCase();
  const timeoutController = new AbortController();
  const effectiveTimeout = timeoutMs ?? (method === 'GET' ? DEFAULT_GET_TIMEOUT_MS : DEFAULT_WRITE_TIMEOUT_MS);
  let didTimeout = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  if (effectiveTimeout > 0) {
    timeout = setTimeout(() => {
      didTimeout = true;
      timeoutController.abort();
    }, effectiveTimeout);
  }
  if (suppliedSignal) {
    const forwardAbort = () => timeoutController.abort(suppliedSignal.reason);
    if (suppliedSignal.aborted) forwardAbort();
    else suppliedSignal.addEventListener('abort', forwardAbort, { once: true });
    removeAbortListener = () => suppliedSignal.removeEventListener('abort', forwardAbort);
  }

  let response: Response | undefined;
  const attempts = method === 'GET' ? 2 : 1;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        response = await fetch(buildApiUrl(path), {
          credentials: 'include',
          ...requestInit,
          signal: timeoutController.signal,
          headers: {
            Accept: 'application/json',
            ...(requestLanguage ? { 'Accept-Language': requestLanguage } : {}),
            ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
            ...(!isFormData && body ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          body: body && !isFormData && typeof body !== 'string' ? JSON.stringify(body) : body,
        });
      } catch (error) {
        if (
          attempt < attempts
          && !timeoutController.signal.aborted
          && error instanceof TypeError
        ) {
          await retryDelay(timeoutController.signal);
          continue;
        }
        throw error;
      }
      if (
        attempt < attempts
        && RETRYABLE_GET_STATUSES.has(response.status)
        && !timeoutController.signal.aborted
      ) {
        await retryDelay(timeoutController.signal);
        continue;
      }
      break;
    }
    notifyConnectivity(true);
  } catch (error) {
    if (didTimeout) {
      throw new ApiError(408, 'Request timed out.', undefined, 'request_timeout');
    }
    if (!timeoutController.signal.aborted && !suppliedSignal?.aborted) {
      notifyConnectivity(false);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    removeAbortListener?.();
  }

  if (!response) {
    throw new ApiError(0, 'Request did not return a response.', undefined, 'no_response');
  }
  if (!response.ok) {
    const error = await apiErrorFromResponse(response);
    // DRF's session authenticator returns 403 (rather than 401) when no
    // session exists because it does not advertise a WWW-Authenticate scheme.
    // Distinguish that response from legitimate permission denials by code.
    if (response.status === 401 || (response.status === 403 && error.code === 'not_authenticated')) {
      notifyAuthExpired(path);
    }
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function retryDelay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Request cancelled.', 'AbortError'));
      return;
    }
    const handleAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Request cancelled.', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, SAFE_GET_RETRY_DELAY_MS);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function notifyConnectivity(online: boolean) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(API_CONNECTIVITY_EVENT, { detail: { online } }));
  }
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: RequestOptions['body'], options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
