import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  discardWorkflowDraft,
  getDashboardTasks,
  listWorkflowDraftPage,
  type OperatorTask,
  type OperatorTasks,
  type WorkflowDraft,
  type WorkflowDraftType,
} from '../api/fleet';
import { getApiErrorMessage } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from '../utils/format';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { StatusBadge } from './StatusBadge';

const GROUPS: Array<keyof OperatorTasks['groups']> = [
  'arrivals_awaiting_check_in',
  'overdue_returns',
  'reservation_handovers',
  'condition_attention',
  'failed_documents',
  'manufacturer_returns_due',
];

const DRAFT_ROUTES: Record<WorkflowDraftType, string> = {
  check_in: '/app/workflows/check-in',
  loan_checkout: '/app/workflows/loan-checkout',
  loan_return: '/app/workflows/loan-return',
  manufacturer_return: '/app/workflows/manufacturer-return',
  reservation: '/app/reservations',
  maintenance: '/app/tasks/maintenance',
};

function taskHref(group: keyof OperatorTasks['groups'], item: OperatorTask, canOperate: boolean) {
  if (!canOperate && item.vehicle_id) return `/app/vehicles/${item.vehicle_id}`;
  if (group === 'arrivals_awaiting_check_in') return `/app/workflows/check-in?vehicle=${item.vehicle_id}`;
  if (group === 'overdue_returns') return `/app/workflows/loan-return?loan=${item.related_id}`;
  if (group === 'reservation_handovers') {
    return `/app/workflows/loan-checkout?vehicle=${item.vehicle_id}&reservation=${item.related_id}`;
  }
  if (group === 'manufacturer_returns_due') return `/app/workflows/manufacturer-return?vehicle=${item.vehicle_id}`;
  if (group === 'failed_documents') {
    const params = new URLSearchParams({ status: 'failed' });
    if (item.record_id) params.set('record', item.record_id);
    if (item.document_type) params.set('type', item.document_type);
    return `/app/reports?${params.toString()}`;
  }
  if (group === 'condition_attention') {
    if (item.next_action?.action === 'maintenance_complete') {
      return `/app/tasks/maintenance?vehicle=${item.vehicle_id}&action=complete`;
    }
    if (item.next_action?.action === 'resolve_damage') {
      return `/app/tasks/maintenance?vehicle=${item.vehicle_id}&action=resolve&damage=${item.related_id}`;
    }
    return `/app/vehicles/${item.vehicle_id}`;
  }
  return item.vehicle_id ? `/app/vehicles/${item.vehicle_id}` : '/app/tasks';
}

export function OperatorTaskBoard({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canOperate = user?.role === 'admin' || user?.role === 'operations';
  const [tasks, setTasks] = useState<OperatorTasks | null>(null);
  const [drafts, setDrafts] = useState<WorkflowDraft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [discarding, setDiscarding] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    Promise.all([
      getDashboardTasks(compact ? 5 : 25, controller.signal),
      canOperate ? listWorkflowDraftPage(undefined, 1, controller.signal) : Promise.resolve(null),
    ])
      .then(([nextTasks, draftPage]) => {
        if (!active) return;
        setTasks(nextTasks);
        setDrafts(draftPage?.results ?? []);
      })
      .catch((loadError) => {
        if (active && !controller.signal.aborted) {
          setError(getApiErrorMessage(loadError, t, t('tasks.loadError')));
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [canOperate, compact, reloadToken, t]);

  const visibleGroups = useMemo(
    () => GROUPS.filter((group) => (tasks?.groups?.[group]?.count ?? 0) > 0),
    [tasks],
  );

  async function discardDraft(draft: WorkflowDraft) {
    setDiscarding(draft.id);
    try {
      await discardWorkflowDraft(draft.id);
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
    } catch (discardError) {
      setError(getApiErrorMessage(discardError, t, t('drafts.discardError')));
    } finally {
      setDiscarding(null);
    }
  }

  if (isLoading) return <LoadingState variant="skeleton" rows={compact ? 3 : 6} />;
  if (error) return <ErrorState message={error} onRetry={() => setReloadToken((value) => value + 1)} />;
  if (!tasks) return null;

  return (
    <div className="task-board">
      {drafts.length ? (
        <section className="content-card draft-list" aria-labelledby="active-drafts-title">
          <div className="card-title-row">
            <div>
              <h3 id="active-drafts-title">{t('drafts.title')}</h3>
              <p className="hint-text">{t('drafts.description')}</p>
            </div>
            <span className="task-count">{drafts.length}</span>
          </div>
          <ul className="list-stack list-stack--actions">
            {drafts.slice(0, compact ? 3 : drafts.length).map((draft) => (
              <li key={draft.id}>
                <div>
                  <strong>{t(`drafts.types.${draft.workflow_type}`)}</strong>
                  <small>{t('drafts.updated', { date: formatDateTime(draft.updated_at, i18n.language) })}</small>
                </div>
                <div className="action-row">
                  <Link
                    className="button-link"
                    to={`${draft.workflow_type === 'check_in' && draft.form_data.intake ? '/app/workflows/intake' : DRAFT_ROUTES[draft.workflow_type]}?draft=${draft.id}`}
                  >
                    {t('drafts.resume')}
                  </Link>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={discarding === draft.id}
                    onClick={() => void discardDraft(draft)}
                  >
                    {t('drafts.discard')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {visibleGroups.length ? (
        <div className="task-groups">
          {visibleGroups.map((group) => {
            const data = tasks.groups[group];
            return (
              <section className="content-card task-group" id={group} key={group}>
                <div className="card-title-row">
                  <div>
                    <h3>{t(`tasks.groups.${group}.title`)}</h3>
                    <p className="hint-text">{t(`tasks.groups.${group}.description`)}</p>
                  </div>
                  <span className="task-count" aria-label={t('tasks.itemCount', { count: data.count })}>{data.count}</span>
                </div>
                <ul className="list-stack list-stack--actions">
                  {data.items.slice(0, compact ? 3 : data.items.length).map((item, index) => (
                    <li key={`${item.related_id || item.record_id || item.vehicle_id}-${index}`}>
                      <div>
                        <strong>{item.label || item.vehicle_label || t('common.unknown')}</strong>
                        <small>
                          {item.due_at || item.performed_at
                            ? formatDateTime(item.due_at || item.performed_at, i18n.language)
                            : item.failure_reason || t(`tasks.groups.${group}.itemHint`)}
                        </small>
                      </div>
                      <StatusBadge status={item.status} />
                      <Link className="button-link secondary-button" to={taskHref(group, item, canOperate)}>
                        {canOperate ? t(`tasks.groups.${group}.action`) : t('vehicles.actions.details')}
                      </Link>
                    </li>
                  ))}
                </ul>
                {compact && data.count > data.items.slice(0, 3).length ? (
                  <Link to={`/app/tasks#${group}`}>{t('tasks.viewAll')}</Link>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState title={t('tasks.empty.title')} description={t('tasks.empty.description')} />
      )}
    </div>
  );
}
