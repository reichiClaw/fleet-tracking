import { type ReactNode, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · ${t('app.name')}`;
    headingRef.current?.focus();
  }, [t, title]);

  return (
    <div className={`page-header${actions ? ' page-header--with-actions' : ''}`}>
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ?? null}
    </div>
  );
}
