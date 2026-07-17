import { ApiError } from './client';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const HUMANIZE_SKIP = new Set(['detail', 'non_field_errors', 'nonFieldErrors', '__all__']);

function humanizeFieldName(field: string, t?: Translate): string {
  if (!field || HUMANIZE_SKIP.has(field)) {
    return '';
  }
  const key = `apiFields.${field}`;
  const translated = t?.(key, { defaultValue: '' });
  if (translated && translated !== key) {
    return translated;
  }
  const spaced = field.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Recursively collect human-readable strings from a DRF-style error body.
 *
 * DRF returns either `{"detail": "..."}`, `{"field": ["msg", ...]}`, nested
 * objects, or a bare list. We flatten everything into "Field: message" lines
 * (omitting the prefix for non-field/detail errors).
 */
function collectMessages(value: unknown, field: string, out: string[], t?: Translate): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const label = humanizeFieldName(field, t);
    out.push(label ? `${label}: ${trimmed}` : trimmed);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMessages(item, field, out, t));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectMessages(child, key, out, t);
    }
    return;
  }
}

/**
 * Turn any thrown error into a precise, user-facing message.
 *
 * - Validation/permission/throttle details from the backend are surfaced as-is
 *   (already localized via the Accept-Language header), e.g.
 *   "Vehicle: Only available or checked-in vehicles can be loaned."
 * - Network failures and unexpected errors map to clear, translated guidance.
 * - `fallback` (a context-specific message) is used only when nothing more
 *   specific can be derived.
 */
export function getApiErrorMessage(error: unknown, t: Translate, fallback?: string): string {
  const fallbackMessage = fallback ?? t('errors.generic');

  if (error instanceof ApiError) {
    if (error.code === 'request_timeout' || error.status === 408) {
      return t('errors.timeout');
    }
    if (error.details && typeof error.details === 'object') {
      const messages: string[] = [];
      collectMessages(error.details, '', messages, t);
      const unique = Array.from(new Set(messages.map((message) => message.trim()).filter(Boolean)));
      if (unique.length) {
        return unique.join(' ');
      }
    }
    if (typeof error.details === 'string' && error.details.trim()) {
      return error.details.trim();
    }
    if (error.code !== 'error' && error.message && error.message !== error.name) {
      return error.message;
    }

    if (error.status === 401 || error.status === 403) {
      return t('errors.permission');
    }
    if (error.status === 404) {
      return t('errors.notFound');
    }
    if (error.status === 413) {
      return t('errors.tooLarge');
    }
    if (error.status === 429) {
      return t('errors.throttled');
    }
    if (error.status >= 500) {
      return t('errors.server');
    }
    return `${fallbackMessage} (${error.status})`;
  }

  // fetch() rejects with a TypeError on network/DNS/CORS failures, which the API
  // client re-throws without wrapping.
  return t('errors.connection');
}

export function getApiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object' || Array.isArray(error.details)) {
    return {};
  }
  const result: Record<string, string> = {};
  Object.entries(error.details as Record<string, unknown>).forEach(([field, value]) => {
    const messages: string[] = [];
    collectMessages(value, '', messages);
    if (messages.length) result[field] = messages.join(' ');
  });
  return result;
}
