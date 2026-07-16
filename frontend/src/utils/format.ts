export function localeCode(language: string) {
  return language.toLowerCase().startsWith('de') ? 'de-DE' : 'en-GB';
}

export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
    ? date
    : null;
}

export function parseDateTime(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateOnly(value: string | null | undefined, language: string, fallback = '') {
  if (!value) {
    return fallback;
  }
  const date = parseDateOnly(value);
  return date
    ? new Intl.DateTimeFormat(localeCode(language), { dateStyle: 'long' }).format(date)
    : fallback;
}

export function formatDateTime(
  value: string | null | undefined,
  language: string,
  fallback = '',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
) {
  const date = parseDateTime(value);
  return date ? new Intl.DateTimeFormat(localeCode(language), options).format(date) : fallback;
}

export function formatNumber(
  value: string | number | null | undefined,
  language: string,
  fallback = '',
  options?: Intl.NumberFormatOptions,
) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat(localeCode(language), options).format(number)
    : fallback;
}

export function localDateTimeToIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function isValidPhone(value: string) {
  const trimmed = value.trim();
  return /^[+()\d][+()\d\s./-]{2,79}$/.test(trimmed) && (trimmed.match(/\d/g)?.length ?? 0) >= 3;
}
