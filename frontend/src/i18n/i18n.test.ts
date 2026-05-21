import { describe, expect, it } from 'vitest';

import deCommon from './locales/de/common.json';
import enCommon from './locales/en/common.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

describe('translation resources', () => {
  it('keeps German and English keys aligned', () => {
    expect(flattenKeys(enCommon).sort()).toEqual(flattenKeys(deCommon).sort());
  });
});
