import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { Reservation } from '../api/fleet';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lightweight horizontal timeline of active reservations (and an optional
 * manufacturer-return-due marker), built with CSS — no chart dependency.
 */
export function ReservationTimeline({
  reservations,
  returnDue,
}: {
  reservations: Reservation[];
  returnDue?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language]);

  const active = useMemo(() => reservations.filter((reservation) => reservation.status === 'active'), [reservations]);

  const window = useMemo(() => {
    const now = Date.now();
    const starts = active.map((reservation) => new Date(reservation.start_at).getTime());
    const ends = active.map((reservation) => new Date(reservation.end_at).getTime());
    const dueMs = returnDue ? new Date(returnDue).getTime() : null;
    const min = Math.min(now, ...starts.length ? starts : [now]);
    const candidates = [now + 30 * DAY_MS, ...ends, ...(dueMs ? [dueMs] : [])];
    const max = Math.max(...candidates);
    return { min, max: max > min ? max : min + 30 * DAY_MS };
  }, [active, returnDue]);

  const range = window.max - window.min || DAY_MS;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - window.min) / range) * 100));

  const todayPct = pct(Date.now());
  const dueMs = returnDue ? new Date(returnDue).getTime() : null;

  if (!active.length && !dueMs) {
    return null;
  }

  return (
    <div className="timeline" role="img" aria-label={t('reservations.timeline.summary', { count: active.length })}>
      <div className="timeline__track">
        <span className="timeline__today" style={{ left: `${todayPct}%` }} title={t('reservations.timeline.today')} />
        {dueMs ? (
          <span
            className="timeline__due"
            style={{ left: `${pct(dueMs)}%` }}
            title={t('reservations.returnDue.marker', { date: dateFormatter.format(new Date(dueMs)) })}
          />
        ) : null}
        {active.map((reservation) => {
          const start = new Date(reservation.start_at).getTime();
          const end = new Date(reservation.end_at).getTime();
          const left = pct(start);
          const width = Math.max(1.5, pct(end) - left);
          const label = `${reservation.reserved_for || t('reservations.untitled')}: ${dateFormatter.format(
            new Date(start),
          )} – ${dateFormatter.format(new Date(end))}`;
          return (
            <span
              key={reservation.id}
              className="timeline__bar"
              style={{ left: `${left}%`, width: `${width}%` }}
              title={label}
            >
              <span className="timeline__bar-label">{reservation.reserved_for || t('reservations.untitled')}</span>
            </span>
          );
        })}
      </div>
      <div className="timeline__axis">
        <span>{dateFormatter.format(new Date(window.min))}</span>
        <span>{dateFormatter.format(new Date(window.max))}</span>
      </div>
    </div>
  );
}
