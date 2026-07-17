import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

describe('responsive layout rules', () => {
  it('uses shrink-safe auto-fit grids instead of fixed desktop columns', () => {
    expect(styles).toMatch(/repeat\(auto-fit,\s*minmax\(min\(100%,/);
    expect(styles).toContain('.form-grid--two');
    expect(styles).toContain('.form-grid--three');
  });

  it('includes a mobile navigation drawer and 320px-safe breakpoint rules', () => {
    expect(styles).toContain('.mobile-nav-trigger');
    expect(styles).toContain('.side-nav.is-open');
    expect(styles).toMatch(/@media\s*\(max-width:\s*420px\)/);
  });
});
