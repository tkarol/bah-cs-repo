import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerIndex, ExceptionFeed } from '@cs/core';
import { api } from '../api.ts';
import { money, titleCase } from '../format.ts';
import { BandBar, SeverityChip, Tile, type Severity } from '../components/status.tsx';

/** Lower is more severe, so an "and above" filter is a <= comparison. */
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * The leadership landing page is deliberately not a grid of account tiles. It
 * is a ranked list of what is wrong, because the question leadership actually
 * has is "what needs me today", not "show me everything".
 */
export function Attention() {
  const [index, setIndex] = useState<CustomerIndex | null>(null);
  const [feed, setFeed] = useState<ExceptionFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [me, setMe] = useState<string>('');

  useEffect(() => {
    Promise.all([api.index(), api.exceptions(), api.me()])
      .then(([i, f, m]) => {
        setIndex(i);
        setFeed(f);
        setMe(m.email);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const visible = useMemo(() => {
    if (!feed) return [];
    const floor = severity === 'all' ? Infinity : SEVERITY_RANK[severity];
    return feed.exceptions.filter(
      (e) =>
        // "and above" means at least this severe, not exactly this severe.
        SEVERITY_RANK[e.severity as Severity] <= floor &&
        (!mineOnly || e.accountable_owner.toLowerCase() === me.toLowerCase()),
    );
  }, [feed, severity, mineOnly, me]);

  if (error) return <div className="error">{error}</div>;
  if (!index || !feed) return <p className="empty">Loading…</p>;

  const t = index.totals;
  const share = t.arr_total === 0 ? 0 : Math.round((t.arr_not_green / t.arr_total) * 100);

  return (
    <>
      <h1>Portfolio</h1>
      <p className="sub">
        {t.customers} accounts · as of {index.as_of}
      </p>

      <div className="tiles">
        <Tile label="Annual value" value={money(t.arr_total)} note={`${t.customers} accounts`} />
        <Tile
          label="ARR not healthy"
          value={money(t.arr_not_green)}
          note={`${share}% of the portfolio`}
        />
        <Tile
          label="Commitments past due"
          value={t.open_commitments_past_due}
          note="promises we have already missed"
        />
        <Tile label="Open risks" value={t.open_risks} note="across all accounts" />
      </div>

      <h2>Account health</h2>
      <div className="card">
        <BandBar counts={t.by_band} />
      </div>

      <h2>What needs attention</h2>
      <div className="controls">
        <select value={severity} onChange={(e) => setSeverity(e.target.value as 'all' | Severity)}>
          <option value="all">All severities</option>
          <option value="critical">Critical only</option>
          <option value="high">High and above</option>
          <option value="medium">Medium and above</option>
          <option value="low">Low and above</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Only accounts I own
        </label>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>
          {visible.length} of {feed.count}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="empty">Nothing open. Either everything is genuinely fine, or the sweep has not run.</p>
      ) : (
        <div className="rows">
          {visible.map((e) => (
            <div className={`row sev-${e.severity}`} key={e.key}>
              <div className="head">
                <SeverityChip severity={e.severity} />
                <Link className="name" to={`/a/${e.slug}`}>
                  {e.customer}
                </Link>
                <span className="muted">{e.label}</span>
              </div>
              <div className="detail">{e.detail}</div>
              <div className="meta">
                <span>{money(e.arr)}</span>
                <span>{titleCase(e.lifecycle_stage)}</span>
                <span>{e.accountable_owner}</span>
                {e.age_days !== null ? <span>open {e.age_days}d</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
