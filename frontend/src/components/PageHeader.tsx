import type { ReactNode } from 'react';

/**
 * Standard page header: eyebrow label, title, supporting description, and an
 * optional actions slot aligned to the right on wide screens.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`page-header${actions ? ' page-header--with-actions' : ''}`}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ?? null}
    </div>
  );
}
