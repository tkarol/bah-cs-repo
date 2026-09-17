import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerIndex, IndexEntry } from '@cs/core';
import { PHASE_LABEL, STAGE_LABEL } from '@cs/core';
import { api } from '../api.ts';
import { money } from '../format.ts';
import { BAND_COLOR, BAND_LABEL, type Band } from '../components/status.tsx';

/**
 * The main working view. Three lanes, because the question people actually have
 * is "where is this account in its life", and the interesting answer is which
 * side of the handoff it sits on.
 *
 * The handoff lane is deliberately in the middle and styled as a crossing
 * point rather than just another column — it is the moment things get lost.
 */
const LANES = [
  {
    phase: 'presales' as const,
    blurb: 'Deals being pursued. Promises made here have to survive the handoff.',
  },
  {
    phase: 'handoff' as const,
    blurb: 'The gate. Nothing reaches delivery until every required item is done or waived.',
  },
  {
    phase: 'postsales' as const,
    blurb: 'Live customers. Onboarding, steady state, renewal.',
  },
];

export function Pipeline() {
  const [index, setIndex] = useState<CustomerIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [me, setMe] = useState('');

  useEffect(() => {
    Promise.all([api.index(), api.me()])
      .then(([i, m]) => {
        setIndex(i);
        setMe(m.email);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const visible = useMemo(() => {
    if (!index) return [];
    const needle = q.trim().toLowerCase();
    return index.customers.filter(
      (c) =>
        (needle === '' ||
          c.name.toLowerCase().includes(needle) ||
          c.accountable_owner.toLowerCase().includes(needle)) &&
        (!mineOnly || c.accountable_owner.toLowerCase() === me.toLowerCase()),
    );
  }, [index, q, mineOnly, me]);

  if (error) return <div className="error">{error}</div>;
  if (!index) return <p className="empty">Loading…</p>;

  const closed = visible.filter((c) => c.phase === 'closed');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pipeline</h1>
          <p className="sub">
            {visible.length} of {index.customers.length} accounts · {money(index.totals.arr_total)}
          </p>
        </div>
        <Link className="btn primary" to="/new">
          New opportunity
        </Link>
      </div>

      <div className="controls">
        <input
          className="grow"
          placeholder="Search by name or owner"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Only mine
        </label>
      </div>

      <div className="lanes">
        {LANES.map(({ phase, blurb }) => {
          const cards = visible.filter((c) => c.phase === phase);
          const value = cards.reduce((sum, c) => sum + c.contract.value_annual, 0);
          return (
            <section className={`lane lane-${phase}`} key={phase}>
              <header>
                <h2>{PHASE_LABEL[phase]}</h2>
                <span className="lane-count">
                  {cards.length} · {money(value)}
                </span>
              </header>
              <p className="lane-blurb">{blurb}</p>
              <div className="lane-cards">
                {cards.length === 0 ? (
                  <p className="empty small">Nothing here.</p>
                ) : (
                  cards
                    .sort((a, b) => a.health.score - b.health.score)
                    .map((c) => <Card key={c.slug} entry={c} />)
                )}
              </div>
            </section>
          );
        })}
      </div>

      {closed.length > 0 ? (
        <>
          <h2 style={{ marginTop: 28 }}>Closed</h2>
          <div className="lane-cards closed-row">
            {closed.map((c) => (
              <Card key={c.slug} entry={c} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function Card({ entry }: { entry: IndexEntry }) {
  const band = entry.health.band as Band;
  const fired = entry.health.signals.filter((s) => s.fired);
  const gate = entry.handoff;

  return (
    <Link className="card account-card" to={`/a/${entry.slug}`}>
      <div className="account-card-head">
        <span className="account-name">{entry.name}</span>
        <span
          className="band-dot"
          style={{ background: BAND_COLOR[band] }}
          title={`${BAND_LABEL[band]} · ${entry.health.score}/100`}
          aria-label={BAND_LABEL[band]}
        />
      </div>
      <div className="account-meta">
        <span>{money(entry.contract.value_annual)}</span>
        <span>·</span>
        <span>{STAGE_LABEL[entry.lifecycle_stage as keyof typeof STAGE_LABEL] ?? entry.lifecycle_stage}</span>
      </div>
      <div className="account-owner">{entry.accountable_owner.replace('@bah.com', '')}</div>

      {gate ? (
        <div className="gate-strip" title={`${gate.complete} of ${gate.total} gate items complete`}>
          <div className="gate-bar">
            <span style={{ width: `${(gate.complete / Math.max(1, gate.total)) * 100}%` }} />
          </div>
          <span className="gate-text">
            {gate.complete}/{gate.total} gate
            {gate.required_incomplete > 0 ? ` · ${gate.required_incomplete} to do` : ''}
            {gate.expired_waivers > 0 ? ` · ${gate.expired_waivers} expired` : ''}
          </span>
        </div>
      ) : null}

      {fired.length > 0 ? (
        <div className="account-flags">
          {fired.slice(0, 2).map((s) => (
            <span key={s.id} className="flag">
              {s.label}
            </span>
          ))}
          {fired.length > 2 ? <span className="flag muted">+{fired.length - 2}</span> : null}
        </div>
      ) : null}
    </Link>
  );
}
