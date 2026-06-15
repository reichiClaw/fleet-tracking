import type { ReactNode } from 'react';

/**
 * Consistent empty-state panel for lists and search results.
 *
 * Keeps the existing `placeholder-card` styling hook while adding a friendly
 * icon, headline, supporting copy, and an optional call-to-action.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className="placeholder-card empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4 9-4V7" />
          <path d="M12 11v10" />
        </svg>
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state__actions">{action}</div> : null}
    </section>
  );
}
