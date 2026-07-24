import { useId } from 'react';

export type DonutSegment = { key: string; label: string; value: number; color: string };

/**
 * Accessible donut chart rendered as inline SVG (no chart dependency).
 * Exposes a text summary via `aria-label`; the legend is rendered by the caller.
 */
export function DonutChart({
  segments,
  ariaLabel,
  centerValue,
  centerLabel,
  size = 180,
}: {
  segments: DonutSegment[];
  ariaLabel: string;
  centerValue: string | number;
  centerLabel?: string;
  size?: number;
}) {
  const radius = 70;
  const center = 90;
  const stroke = 24;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  let offset = 0;

  return (
    <>
    <svg
      className="chart-donut"
      viewBox="0 0 180 180"
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel}
    >
      <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
      {total > 0 ? (
        <g transform={`rotate(-90 ${center} ${center})`}>
          {segments
            .filter((segment) => segment.value > 0)
            .map((segment) => {
              const dash = (segment.value / total) * circumference;
              const node = (
                <circle
                  key={segment.key}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return node;
            })}
        </g>
      ) : null}
      <text x={center} y={center - 4} textAnchor="middle" className="chart-donut__value">
        {centerValue}
      </text>
      {centerLabel ? (
        <text x={center} y={center + 16} textAnchor="middle" className="chart-donut__label">
          {centerLabel}
        </text>
      ) : null}
    </svg>
    <div className="visually-hidden chart-data-table">
      <table>
        <caption>{ariaLabel}</caption>
        <tbody>
          {segments.map((segment) => <tr key={segment.key}><th scope="row">{segment.label}</th><td>{segment.value}</td></tr>)}
        </tbody>
      </table>
    </div>
    </>
  );
}

/**
 * Accessible area/line chart for a small time series, rendered as inline SVG.
 * Scales responsively via viewBox; summarizes the series via `aria-label`.
 */
export function ActivityChart({
  points,
  ariaLabel,
  color = 'var(--brand-600)',
}: {
  points: { label: string; value: number }[];
  ariaLabel: string;
  color?: string;
}) {
  const gradientId = useId();
  const width = 640;
  const height = 200;
  const padding = { top: 16, right: 12, bottom: 24, left: 12 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...points.map((point) => point.value));
  const count = points.length;

  const coords = points.map((point, index) => {
    const x = count <= 1 ? padding.left + innerW / 2 : padding.left + (index / (count - 1)) * innerW;
    const y = padding.top + innerH * (1 - point.value / max);
    return { x, y };
  });

  const baseline = padding.top + innerH;
  const linePath = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`).join(' ');
  const areaPath = coords.length
    ? `M${coords[0].x.toFixed(1)} ${baseline} ${linePath.replace(/^M/, 'L')} L${coords[coords.length - 1].x.toFixed(1)} ${baseline} Z`
    : '';

  return (
    <>
    <svg
      className="chart-activity"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={padding.left} y1={baseline} x2={width - padding.right} y2={baseline} stroke="var(--border)" strokeWidth="1" />
      {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
      {linePath ? <path d={linePath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /> : null}
      {coords.map((coord, index) => (
        <circle key={index} cx={coord.x} cy={coord.y} r={points[index].value > 0 ? 3.5 : 0} fill={color} />
      ))}
    </svg>
    <div className="visually-hidden chart-data-table">
      <table>
        <caption>{ariaLabel}</caption>
        <tbody>
          {points.map((point) => <tr key={point.label}><th scope="row">{point.label}</th><td>{point.value}</td></tr>)}
        </tbody>
      </table>
    </div>
    </>
  );
}
