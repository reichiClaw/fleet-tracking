import { useTranslation } from 'react-i18next';

import type { PageResult } from '../api/pagination';

export function PaginationControls<T>({
  page,
  disabled,
  onPageChange,
}: {
  page: PageResult<T>;
  disabled?: boolean;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const first = page.count === 0 ? 0 : (page.page - 1) * (page.pageSize ?? 50) + 1;
  const last = page.count === 0 ? 0 : first + page.results.length - 1;

  return (
    <nav className="pagination" aria-label={t('pagination.label')}>
      <p aria-live="polite">
        {t('pagination.count', { first, last, count: page.count })}
      </p>
      <div className="action-row">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || !page.previous}
          onClick={() => onPageChange(Math.max(1, page.page - 1))}
        >
          {t('pagination.previous')}
        </button>
        <span>{t('pagination.page', { page: page.page })}</span>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || !page.next}
          onClick={() => onPageChange(page.page + 1)}
        >
          {t('pagination.next')}
        </button>
      </div>
    </nav>
  );
}
