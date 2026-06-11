import { describe, expect, it } from 'vitest';

import deCommon from './locales/de/common.json';
import enCommon from './locales/en/common.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key));
}

const vehicleStatusKeys = [
  'status.announced',
  'status.checked_in',
  'status.available',
  'status.reserved',
  'status.loaned',
  'status.maintenance',
  'status.damaged',
  'status.manufacturer_checkout',
  'status.archived',
];

const requiredCoverageKeys = [
  'dashboard.title',
  'vehicles.title',
  'vehicles.empty.title',
  'workflows.loanCheckout.title',
  'workflows.validation.borrowerRequired',
  'imports.status.uploaded',
  'imports.actions.create',
  'imports.fields.internal_number',
  'media.download',
  'pdf.generateReturn',
  'qr.scan.start',
  'qr.targets.loanReturn.title',
  ...vehicleStatusKeys,
];

describe('translation resources', () => {
  it('keeps German and English keys aligned', () => {
    expect(flattenKeys(enCommon).sort()).toEqual(flattenKeys(deCommon).sort());
  });

  it('keeps representative workflow, import, media, PDF, and status keys populated', () => {
    for (const resources of [deCommon, enCommon]) {
      for (const key of requiredCoverageKeys) {
        const value = key.split('.').reduce<unknown>((current, part) => {
          if (!current || typeof current !== 'object' || Array.isArray(current)) {
            return undefined;
          }
          return (current as Record<string, unknown>)[part];
        }, resources);

        expect(value, key).toEqual(expect.any(String));
        expect((value as string).trim(), key).not.toBe('');
      }
    }
  });
});
