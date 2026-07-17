import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  mediaDownloadUrl,
  type MediaFile,
  type VehicleHistory,
  type VehicleTimelineEvent,
} from '../api/fleet';
import { formatDateTime, formatNumber } from '../utils/format';

type TimelineEntry = VehicleTimelineEvent & {
  media: MediaFile[];
  odometer?: number | null;
  hours?: string | number | null;
};

const MEDIA_RELATIONS: Record<string, string[]> = {
  check_in: ['check_in_protocol', 'check_in_protocol_pdf'],
  loan_checkout: ['loan_checkout', 'loan_checkout_pdf'],
  loan_return: ['loan_return', 'loan_return_pdf'],
  manufacturer_return: ['manufacturer_checkout_protocol', 'manufacturer_checkout_protocol_pdf'],
  damage_reported: ['damage_report'],
  damage_resolved: ['damage_report'],
  maintenance_start: ['maintenance_start'],
  maintenance_complete: ['maintenance_complete'],
};

function eventDetails(event: VehicleTimelineEvent, history: VehicleHistory) {
  if (event.type === 'check_in') {
    const item = history.check_ins.find((candidate) => candidate.id === event.id);
    return {
      description: event.description || item?.condition_notes,
      odometer: item?.odometer_km,
      hours: item?.operating_hours,
    };
  }
  if (event.type === 'loan_checkout' || event.type === 'loan_return') {
    const item = history.loans.find((candidate) => candidate.id === event.id);
    return {
      description: event.description || item?.borrower_name,
      odometer: event.type === 'loan_return' ? item?.return_odometer_km : item?.checkout_odometer_km,
      hours: event.type === 'loan_return' ? item?.return_operating_hours : item?.checkout_operating_hours,
    };
  }
  if (event.type === 'manufacturer_return') {
    const item = history.manufacturer_checkouts.find((candidate) => candidate.id === event.id);
    return {
      description: event.description || item?.condition_notes,
      odometer: item?.odometer_km,
      hours: item?.operating_hours,
    };
  }
  if (event.type === 'maintenance_start' || event.type === 'maintenance_complete') {
    const item = (history.maintenance ?? []).find((candidate) => candidate.id === event.id);
    return {
      description: event.description || (event.type === 'maintenance_start' ? item?.reason : item?.completion_notes),
      odometer: event.type === 'maintenance_start' ? item?.start_odometer_km : item?.completion_odometer_km,
      hours: event.type === 'maintenance_start' ? item?.start_operating_hours : item?.completion_operating_hours,
    };
  }
  return { description: event.description };
}

function relationMatches(media: MediaFile, event: VehicleTimelineEvent) {
  if (event.type.startsWith('damage_') && media.damage_report === event.id) return true;
  return Boolean(
    media.related_id === event.id
    && MEDIA_RELATIONS[event.type]?.includes(media.related_type || ''),
  );
}

function fallbackEvents(history: VehicleHistory): VehicleTimelineEvent[] {
  const events: VehicleTimelineEvent[] = [];
  history.check_ins.forEach((item) => events.push({
    occurred_at: item.performed_at,
    type: 'check_in',
    id: item.id,
    status: 'completed',
  }));
  history.loans.forEach((item) => {
    if (item.created_at) {
      events.push({
        occurred_at: item.created_at,
        type: 'loan_checkout',
        id: item.id,
        status: item.status,
      });
    }
    if (item.actual_return_at) {
      events.push({
        occurred_at: item.actual_return_at,
        type: 'loan_return',
        id: item.id,
        status: item.return_condition_outcome || 'returned',
      });
    }
  });
  history.manufacturer_checkouts.forEach((item) => events.push({
    occurred_at: item.performed_at,
    type: 'manufacturer_return',
    id: item.id,
    status: 'completed',
  }));
  history.damages.forEach((item) => {
    if (item.discovered_at) {
      events.push({
        occurred_at: item.discovered_at,
        type: 'damage_reported',
        id: item.id,
        status: item.resolved_at ? 'resolved' : 'open',
        description: item.description,
      });
    }
    if (item.resolved_at) {
      events.push({
        occurred_at: item.resolved_at,
        type: 'damage_resolved',
        id: item.id,
        status: 'resolved',
        description: item.resolution_notes,
      });
    }
  });
  (history.maintenance ?? []).forEach((item) => {
    events.push({
      occurred_at: item.started_at,
      type: 'maintenance_start',
      id: item.id,
      status: item.status,
      description: item.reason,
    });
    if (item.completed_at) {
      events.push({
        occurred_at: item.completed_at,
        type: 'maintenance_complete',
        id: item.id,
        status: item.status,
        description: item.completion_notes,
      });
    }
  });
  return events;
}

function buildEntries(history: VehicleHistory): TimelineEntry[] {
  const workflowEvents = history.timeline?.length ? history.timeline : fallbackEvents(history);
  const usedMedia = new Set<string>();
  const entries: TimelineEntry[] = workflowEvents.map((event) => {
    const media = history.media.filter((item) => relationMatches(item, event));
    media.forEach((item) => usedMedia.add(item.id));
    return { ...event, ...eventDetails(event, history), media };
  });

  history.reservations.forEach((item) => {
    entries.push({
      occurred_at: item.start_at,
      type: 'reservation',
      id: item.id,
      status: item.status,
      description: item.reserved_for,
      media: [],
    });
  });

  history.media.forEach((item) => {
    if (!usedMedia.has(item.id) && item.created_at) {
      entries.push({
        occurred_at: item.created_at,
        type: 'evidence',
        id: item.id,
        status: item.media_type,
        description: item.original_filename,
        media: [item],
      });
    }
  });

  return entries.sort(
    (left, right) => new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime(),
  );
}

export function VehicleConditionTimeline({ history }: { history: VehicleHistory }) {
  const { t, i18n } = useTranslation();
  const entries = useMemo(() => buildEntries(history), [history]);

  function translatedStatus(status: string) {
    const statusKey = `status.${status}`;
    const outcomeKey = `workflowRedesign.outcomes.${status}`;
    if (i18n.exists(statusKey)) return t(statusKey);
    if (i18n.exists(outcomeKey)) return t(outcomeKey);
    if (i18n.exists(`media.types.${status}`)) return t(`media.types.${status}`);
    return status;
  }

  return (
    <section className="content-card" aria-labelledby="condition-timeline-title">
      <div className="card-title-row">
        <div>
          <h3 id="condition-timeline-title">{t('conditionTimeline.title')}</h3>
          <p className="hint-text">{t('conditionTimeline.description')}</p>
        </div>
        <span className="task-count" aria-label={t('conditionTimeline.eventCount', { count: entries.length })}>
          {entries.length}
        </span>
      </div>
      {entries.length ? (
        <ol className="condition-timeline">
          {entries.map((entry, index) => (
            <li key={`${entry.type}-${entry.id}-${entry.occurred_at}-${index}`}>
              <span className="condition-timeline__marker" aria-hidden="true" />
              <article>
                <div className="condition-timeline__heading">
                  <div>
                    <h4>{t(`conditionTimeline.types.${entry.type}`)}</h4>
                    <time dateTime={entry.occurred_at}>
                      {formatDateTime(entry.occurred_at, i18n.language, t('common.notAvailable'))}
                    </time>
                  </div>
                  <span className={`timeline-status timeline-status--${entry.status}`}>
                    {translatedStatus(entry.status)}
                  </span>
                </div>
                {entry.description ? <p>{entry.description}</p> : null}
                {entry.odometer != null || entry.hours != null ? (
                  <dl className="condition-timeline__readings">
                    {entry.odometer != null ? (
                      <div>
                        <dt>{t('vehicles.fields.odometer')}</dt>
                        <dd>{formatNumber(entry.odometer, i18n.language, t('common.notAvailable'))} km</dd>
                      </div>
                    ) : null}
                    {entry.hours != null ? (
                      <div>
                        <dt>{t('vehicles.fields.hours')}</dt>
                        <dd>{formatNumber(entry.hours, i18n.language, t('common.notAvailable'))}</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
                {entry.media.length ? (
                  <ul className="evidence-links" aria-label={t('conditionTimeline.evidenceLabel')}>
                    {entry.media.map((media) => (
                      <li key={media.id}>
                        <a href={mediaDownloadUrl(media)}>
                          {t(`media.types.${media.media_type}`)} · {media.original_filename}
                          {media.language ? ` · ${t(`language.options.${media.language}`)}` : ''}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint-text">{t('conditionTimeline.empty')}</p>
      )}
    </section>
  );
}
