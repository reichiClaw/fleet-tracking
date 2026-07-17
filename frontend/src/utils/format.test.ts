import { describe, expect, it } from 'vitest';

import {
  formatDateOnly,
  formatNumber,
  isValidPhone,
  localDateTimeToIso,
  parseDateOnly,
} from './format';

describe('locale format utilities', () => {
  it('parses date-only values locally and rejects rolled-over dates', () => {
    expect(parseDateOnly('2026-02-28')).toBeInstanceOf(Date);
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(formatDateOnly('2026-07-16', 'de')).toContain('2026');
    expect(formatDateOnly('invalid', 'en', '—')).toBe('—');
  });

  it('formats decimal values for German and English locales', () => {
    expect(formatNumber(1234.5, 'de', '')).toBe('1.234,5');
    expect(formatNumber(1234.5, 'en', '')).toBe('1,234.5');
  });

  it('preserves international phone input semantics while validating digits', () => {
    expect(isValidPhone('+49 0170 001 23')).toBe(true);
    expect(isValidPhone('020 001 00')).toBe(true);
    expect(isValidPhone('++')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
  });

  it('converts valid local date-times to ISO and rejects invalid values', () => {
    expect(localDateTimeToIso('2026-07-16T14:30')).toMatch(/^2026-07-16T/);
    expect(localDateTimeToIso('not-a-date')).toBeUndefined();
  });
});
