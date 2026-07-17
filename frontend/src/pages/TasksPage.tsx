import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { OperatorTaskBoard } from '../components/OperatorTaskBoard';
import { PageHeader } from '../components/PageHeader';

export function TasksPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canOperate = user?.role === 'admin' || user?.role === 'operations';
  const isAdmin = user?.role === 'admin';

  return (
    <section className="page-stack">
      <PageHeader eyebrow={t('tasks.eyebrow')} title={t('tasks.title')} description={t('tasks.description')} />
      <nav className="task-actions" aria-label={t('tasks.actionLabel')}>
        <Link className="quick-action" to="/app/qr?mode=scan">{t('tasks.actions.scan')}</Link>
        {canOperate ? (
          <>
            {isAdmin ? (
              <Link className="quick-action" to="/app/workflows/add-vehicle">{t('tasks.actions.createRecord')}</Link>
            ) : null}
            <Link className="quick-action quick-action--success" to="/app/workflows/intake">{t('tasks.actions.intake')}</Link>
            <Link className="quick-action quick-action--success" to="/app/workflows/check-in">{t('tasks.actions.checkIn')}</Link>
            <Link className="quick-action" to="/app/workflows/loan-checkout">{t('tasks.actions.loan')}</Link>
            <Link className="quick-action" to="/app/workflows/loan-return">{t('tasks.actions.returnLoan')}</Link>
            <Link className="quick-action quick-action--danger" to="/app/workflows/manufacturer-return">{t('tasks.actions.manufacturerReturn')}</Link>
            <Link className="quick-action quick-action--warning" to="/app/tasks#condition_attention">{t('tasks.actions.condition')}</Link>
          </>
        ) : null}
      </nav>
      <OperatorTaskBoard />
    </section>
  );
}
