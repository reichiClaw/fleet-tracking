import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export function FormErrorSummary({ errors }: { errors: Record<string, string> }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const messages = Array.from(new Set(Object.values(errors).filter(Boolean)));

  useEffect(() => {
    if (messages.length) {
      ref.current?.focus();
      window.setTimeout(() => {
        ref.current?.closest('form')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      }, 0);
    }
  }, [messages.join('|')]);

  if (!messages.length) return null;

  return (
    <div ref={ref} className="error-summary" role="alert" tabIndex={-1}>
      <h3>{t('forms.errorSummary')}</h3>
      <ul>
        {messages.map((message) => <li key={message}>{message}</li>)}
      </ul>
    </div>
  );
}
