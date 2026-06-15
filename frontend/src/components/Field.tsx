import type { ReactNode } from 'react';

/**
 * Labeled form field with optional inline validation message.
 *
 * Shared across workflow forms so field markup, spacing, and error rendering
 * stay consistent everywhere.
 */
export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label>
      <span>{label}</span>
      {children}
      {hint && !error ? <small className="hint-text">{hint}</small> : null}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}
