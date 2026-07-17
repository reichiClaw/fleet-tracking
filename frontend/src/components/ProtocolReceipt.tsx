import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { mediaDownloadUrl } from '../api/fleet';

export function ProtocolReceipt({
  mediaId,
  error,
  documentType,
  recordId,
}: {
  mediaId?: string | null;
  error?: string;
  documentType: string;
  recordId: string;
}) {
  const { t } = useTranslation();
  const status = mediaId ? 'generated' : error ? 'failed' : 'missing';
  const params = new URLSearchParams({
    status: status === 'generated' ? 'generated' : 'attention',
    type: documentType,
    record: recordId,
  });

  return (
    <section className="protocol-receipt">
      <strong>{t(`pdf.status.${status}`)}</strong>
      {error ? <p className="field-error">{t('pdf.automaticError', { error })}</p> : null}
      <div className="action-row action-row--wrap">
        {mediaId ? (
          <a className="button-link" href={mediaDownloadUrl({ id: mediaId })}>{t('workflowRedesign.openReceipt')}</a>
        ) : null}
        <Link className="button-link secondary-button" to={`/app/reports?${params.toString()}`}>
          {status === 'generated' ? t('pdf.openRegister') : t('pdf.reviewRetry')}
        </Link>
      </div>
    </section>
  );
}
