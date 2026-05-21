import { useTranslation } from 'react-i18next';

import type { LoanStatus, VehicleStatus } from '../api/fleet';

type BadgeStatus = VehicleStatus | LoanStatus | string;

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const { t } = useTranslation();
  const normalized = status || 'unknown';

  return <span className={`status-badge status-badge--${normalized}`}>{t(`status.${normalized}`, normalized)}</span>;
}
