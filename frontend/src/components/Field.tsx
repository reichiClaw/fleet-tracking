import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from 'react';

/**
 * Labeled form field with optional inline validation message.
 *
 * Shared across workflow forms so field markup, spacing, and error rendering
 * stay consistent everywhere.
 */
export function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  const generatedId = useId();
  const errorId = `${generatedId}-error`;
  const hintId = `${generatedId}-hint`;
  const childItems = Children.toArray(children);
  const childIndex = childItems.findIndex(
    (item) => isValidElement(item) && typeof item.type === 'string' && ['input', 'select', 'textarea'].includes(item.type),
  );
  const child = childIndex >= 0
    ? childItems[childIndex] as ReactElement<Record<string, unknown>>
    : undefined;
  const childId = String(child?.props.id ?? generatedId);
  const isRequired = required ?? Boolean(child?.props.required);
  const describedBy = [
    typeof child?.props['aria-describedby'] === 'string' ? child.props['aria-describedby'] : '',
    error ? errorId : hint ? hintId : '',
  ].filter(Boolean).join(' ') || undefined;
  const control = child
    ? childItems.map((item, index) => index === childIndex && isValidElement(item)
      ? cloneElement(item as ReactElement<Record<string, unknown>>, {
          id: childId,
          'aria-label': child.props['aria-label'] ?? label,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          'aria-required': isRequired || undefined,
        })
      : item)
    : children;

  return (
    <label htmlFor={childId}>
      <span>{label}{isRequired ? <span className="required-marker" aria-hidden="true"> *</span> : null}</span>
      {control}
      {hint && !error ? <small id={hintId} className="hint-text">{hint}</small> : null}
      {error ? <small id={errorId} className="field-error">{error}</small> : null}
    </label>
  );
}
