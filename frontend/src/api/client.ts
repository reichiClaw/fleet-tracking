const DEFAULT_API_BASE_URL = '/api/v1';

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

function buildUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, language, ...requestInit } = options;
  const isFormData = body instanceof FormData;

  const response = await fetch(buildUrl(path), {
    credentials: 'include',
    ...requestInit,
    headers: {
      Accept: 'application/json',
      ...(language ? { 'Accept-Language': language } : {}),
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
