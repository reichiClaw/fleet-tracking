import { useTranslation } from 'react-i18next';

import type { LoanStatus, VehicleStatus } from '../api/fleet';

type BadgeStatus = VehicleStatus | LoanStatus | string;

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const { i18n, t } = useTranslation();
  const normalized = status || 'unknown';
  const statusKey = `status.${normalized}`;
  const label = i18n.exists(statusKey) ? t(statusKey) : t('status.unknown');

  return <span className={`status-badge status-badge--${normalized}`}>{label}</span>;
}
