import type { ReactNode } from 'react';

/**
 * Status colour is reserved for health bands and exception severity, and every
 * use pairs it with a text label. A colour on its own never carries meaning —
 * that rule is what keeps the dashboard readable for colour-blind viewers and
 * in print.
 */
export type Band = 'green' | 'amber' | 'red';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const BAND_COLOR: Record<Band, string> = {
  green: 'var(--status-good)',
  amber: 'var(--status-warning)',
  red: 'var(--status-critical)',
};

export const BAND_LABEL: Record<Band, string> = {
  green: 'Healthy',
  amber: 'Watch',
  red: 'At risk',
};

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'var(--status-critical)',
  high: 'var(--status-serious)',
  medium: 'var(--status-warning)',
  low: 'var(--baseline)',
};

export function BandChip({ band }: { band: Band }) {
  return (
    <span className="chip" title={`Health band: ${BAND_LABEL[band]}`}>
      <span className="dot" style={{ background: BAND_COLOR[band] }} aria-hidden />
      {BAND_LABEL[band]}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className="chip">
      <span className="dot" style={{ background: SEVERITY_COLOR[severity] }} aria-hidden />
      {severity[0]!.toUpperCase() + severity.slice(1)}
    </span>
  );
}

export function Score({ score, band }: { score: number; band: Band }) {
  return (
    <span className="scorebadge" style={{ color: BAND_COLOR[band] }} title={`Health score ${score} of 100`}>
      {score}
      <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>/100</span>
    </span>
  );
}

export function Tile({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

/**
 * Portfolio band distribution. A three-part segmented bar rather than a pie:
 * the comparison is part-to-whole across three ordered states, and a legend
 * with counts carries the numbers so the bar never has to be measured by eye.
 */
export function BandBar({ counts }: { counts: Record<Band, number> }) {
  const total = counts.green + counts.amber + counts.red;
  const order: Band[] = ['green', 'amber', 'red'];
  if (total === 0) return <p className="empty">No accounts yet.</p>;

  return (
    <div>
      <div className="bandbar" role="img"
        aria-label={order.map((b) => `${counts[b]} ${BAND_LABEL[b]}`).join(', ')}>
        {order.map((b) =>
          counts[b] > 0 ? (
            <span key={b} style={{ background: BAND_COLOR[b], flexGrow: counts[b] }} />
          ) : null,
        )}
      </div>
      <div className="bandkey">
        {order.map((b) => (
          <span className="item" key={b}>
            <span className="swatch" style={{ background: BAND_COLOR[b] }} aria-hidden />
            {BAND_LABEL[b]} <strong>{counts[b]}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
