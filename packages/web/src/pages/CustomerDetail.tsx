import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { IndexEntry, Signal } from '@cs/core';
import { api, ApiError, type CommitEntry, type CustomerDetail as Detail } from '../api.ts';
import { money, relative, titleCase } from '../format.ts';
import { BandChip, Score, SEVERITY_COLOR, type Band, type Severity } from '../components/status.tsx';

export function CustomerDetail() {
  const { slug = '' } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [fallback, setFallback] = useState<IndexEntry | null>(null);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.customer(slug));
      setFallback(null);
      api.history(slug).then((h) => setCommits(h.commits)).catch(() => setCommits([]));
    } catch (err) {
      // Without the Worker the index still carries health and gate progress,
      // which is enough for a read-only view.
      const index = await api.index().catch(() => null);
      const entry = index?.customers.find((c) => c.slug === slug) ?? null;
      if (entry) {
        setFallback(entry);
        setNotice('Read-only preview from the generated index. Start the Worker to make changes.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(done);
      await reload();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          [err.message, ...err.issues, ...err.blockers.map((b) => b.message)].join('\n'),
        );
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail && !fallback) return <div className="error">{error}</div>;

  const health = detail?.health ?? (fallback ? fallback.health : null);
  const name = detail?.customer.name ?? fallback?.name ?? slug;
  const stage = detail?.customer.lifecycle_stage ?? fallback?.lifecycle_stage ?? '';
  const arr = detail?.customer.contract.value_annual ?? fallback?.contract.value_annual ?? 0;
  const owner = detail?.customer.owners.accountable ?? fallback?.accountable_owner ?? '';

  if (!health) return <p className="empty">Loading…</p>;

  const hasSidebar =
    commits.length > 0 || (detail?.stakeholders?.people.length ?? 0) > 0 || detail !== null;

  return (
    <>
      <p className="sub" style={{ marginBottom: 6 }}>
        <Link to="/customers">← All customers</Link>
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{name}</h1>
        <Score score={health.score} band={health.band as Band} />
        <BandChip band={health.band as Band} />
      </div>
      <p className="sub">
        {titleCase(stage)} · {money(arr)} · owned by {owner}
      </p>

      {notice ? <div className="error" style={{ borderLeftColor: 'var(--accent)' }}>{notice}</div> : null}
      {error ? <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div> : null}

      {/* Only split into two columns when the sidebar actually has content;
          otherwise the main column is needlessly narrow beside empty space. */}
      <div className={hasSidebar ? 'cols' : undefined}>
        <div>
          <h2>Why this score</h2>
          <div className="card">
            {health.signals.map((s) => (
              <SignalRow key={s.id} signal={s} />
            ))}
          </div>

          {detail ? (
            <>
              <Gate detail={detail} busy={busy} act={act} />
              <Commitments detail={detail} busy={busy} act={act} />
              <Risks detail={detail} />
              <Touchpoints detail={detail} />
            </>
          ) : (
            <p className="empty">
              Commitments, the handoff gate and touchpoints need the Worker running.
            </p>
          )}
        </div>

        <div>
          {detail ? <Transitions detail={detail} busy={busy} act={act} /> : null}
          {detail?.stakeholders ? (
            <>
              <h2>Stakeholders</h2>
              <div className="card rows">
                {detail.stakeholders.people.map((p) => (
                  <div key={p.name}>
                    <div style={{ fontWeight: 560 }}>{p.name}</div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {p.role} · {titleCase(p.influence)} · {titleCase(p.sentiment)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {commits.length > 0 ? (
            <>
              <h2>History</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
                Straight from git — every change to this account, permanently.
              </p>
              <div className="card rows">
                {commits.slice(0, 12).map((c) => (
                  <div key={c.sha}>
                    <div style={{ fontSize: 13.5 }}>{c.message.split('\n')[0]}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {c.author} · {relative(c.date)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  return (
    <div className={`signal${signal.fired ? '' : ' quiet'}`}>
      <span
        className="mark"
        style={{ background: signal.fired ? SEVERITY_COLOR[signal.severity as Severity] : 'var(--baseline)' }}
        aria-hidden
      />
      <span>
        <span className="label">{signal.label}</span>
        <span className="muted" style={{ fontSize: 12.5, marginLeft: 8 }}>
          {signal.fired ? titleCase(signal.severity) : 'Clear'}
        </span>
        <div className="detail">{signal.detail}</div>
      </span>
      <span className="pts">{signal.fired ? `−${signal.points}` : '—'}</span>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

function Gate({ detail, busy, act }: { detail: Detail; busy: boolean; act: Act }) {
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const slug = detail.slug;

  if (!detail.handoff) {
    return (
      <>
        <h2>Handoff gate</h2>
        <div className="card">
          <p className="empty" style={{ padding: 0 }}>
            No gate open. Open one when the deal is won — the account cannot enter onboarding
            until it is cleared.
          </p>
          <button
            className="primary"
            disabled={busy}
            style={{ marginTop: 10 }}
            onClick={() => act(() => api.openHandoff(slug), 'Handoff gate opened.')}
          >
            Open handoff gate
          </button>
        </div>
      </>
    );
  }

  const g = detail.gate;
  return (
    <>
      <h2>Handoff gate</h2>
      {g ? (
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
          {g.complete} complete · {g.waived} waived · {g.required_incomplete} required outstanding
          {g.expired_waivers > 0 ? ` · ${g.expired_waivers} waiver past review` : ''}
          {g.waiver_rate > 0.3 ? ' — a high waiver rate usually means the checklist is wrong, not the people' : ''}
        </p>
      ) : null}
      <div className="card rows">
        {detail.handoff.items.map((item) => {
          const expired =
            item.status === 'waived' &&
            item.waiver != null &&
            item.waiver.review_by < new Date().toISOString().slice(0, 10);
          return (
            <div key={item.id} style={{ borderBottom: '1px solid var(--gridline)', paddingBottom: 10 }}>
              <div className="head">
                <span style={{ fontWeight: 560 }}>{item.title}</span>
                {!item.required ? <span className="muted" style={{ fontSize: 12.5 }}>optional</span> : null}
                <span className="chip">
                  <span
                    className="dot"
                    style={{
                      background:
                        item.status === 'complete'
                          ? 'var(--status-good)'
                          : expired
                            ? 'var(--status-critical)'
                            : item.status === 'waived'
                              ? 'var(--status-warning)'
                              : 'var(--baseline)',
                    }}
                    aria-hidden
                  />
                  {item.status === 'waived' ? (expired ? 'Waiver expired' : 'Waived') : titleCase(item.status)}
                </span>
              </div>
              {item.evidence ? <div className="detail">{item.evidence}</div> : null}
              {item.waiver ? (
                <div className="detail">
                  {item.waiver.reason} — {item.waiver.by}, review by {item.waiver.review_by}
                </div>
              ) : null}
              {item.status !== 'complete' ? (
                <div className="controls" style={{ marginTop: 8, marginBottom: 0 }}>
                  <input
                    className="grow"
                    placeholder="Evidence (a link or an attestation)"
                    value={evidence[item.id] ?? ''}
                    onChange={(e) => setEvidence({ ...evidence, [item.id]: e.target.value })}
                  />
                  <button
                    disabled={busy || !(evidence[item.id] ?? '').trim()}
                    onClick={() =>
                      act(
                        () => api.completeItem(slug, item.id, evidence[item.id]!.trim()),
                        `"${item.title}" marked complete.`,
                      )
                    }
                  >
                    Complete
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Commitments({ detail, busy, act }: { detail: Detail; busy: boolean; act: Act }) {
  const today = new Date().toISOString().slice(0, 10);
  if (detail.commitments.length === 0) {
    return (
      <>
        <h2>Commitments</h2>
        <p className="empty">Nothing recorded. Promises made in the sale belong here.</p>
      </>
    );
  }
  return (
    <>
      <h2>Commitments</h2>
      <div className="card rows">
        {detail.commitments.map((c) => {
          const open = c.status !== 'complete' && c.status !== 'waived';
          const late = open && c.due < today;
          return (
            <div key={c.id} style={{ borderBottom: '1px solid var(--gridline)', paddingBottom: 10 }}>
              <div className="head">
                <span style={{ fontWeight: 560 }}>{c.title}</span>
                <span className="chip">
                  <span
                    className="dot"
                    style={{
                      background: late
                        ? 'var(--status-critical)'
                        : c.status === 'complete'
                          ? 'var(--status-good)'
                          : 'var(--baseline)',
                    }}
                    aria-hidden
                  />
                  {late ? 'Past due' : titleCase(c.status)}
                </span>
                <span className="muted" style={{ fontSize: 12.5 }}>{titleCase(c.severity)}</span>
              </div>
              <div className="meta">
                <span>due {c.due}</span>
                <span>owner {c.owner}</span>
                <span>promised in {titleCase(c.origin)}</span>
                {c.made_to ? <span>to {c.made_to}</span> : null}
              </div>
              {c.origin === 'presales' && !c.accepted_at_handoff && open ? (
                <div style={{ marginTop: 8 }}>
                  <div className="detail" style={{ color: 'var(--status-serious)' }}>
                    Not yet accepted by the delivery owner — this blocks onboarding.
                  </div>
                  <button
                    disabled={busy}
                    style={{ marginTop: 6 }}
                    onClick={() =>
                      act(
                        () => api.updateCommitment(detail.slug, c.id, { accepted_at_handoff: true }),
                        'Commitment accepted.',
                      )
                    }
                  >
                    Accept this commitment
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Risks({ detail }: { detail: Detail }) {
  const open = detail.risks.filter((r) => r.status !== 'closed');
  if (open.length === 0) return null;
  return (
    <>
      <h2>Open risks</h2>
      <div className="card rows">
        {open.map((r) => (
          <div key={r.id}>
            <div className="head">
              <span style={{ fontWeight: 560 }}>{r.title}</span>
              <span className="chip">
                <span className="dot" style={{ background: SEVERITY_COLOR[r.severity as Severity] }} aria-hidden />
                {titleCase(r.severity)}
              </span>
            </div>
            <div className="meta">
              <span>opened {r.opened}</span>
              <span>{r.owner}</span>
            </div>
            {r.mitigation ? <div className="detail">{r.mitigation}</div> : null}
          </div>
        ))}
      </div>
    </>
  );
}

function Touchpoints({ detail }: { detail: Detail }) {
  if (detail.touchpoints.length === 0) return null;
  return (
    <>
      <h2>Touchpoints</h2>
      <div className="card rows">
        {detail.touchpoints.map((t) => (
          <div key={t.path}>
            <div className="head">
              <span style={{ fontWeight: 560 }}>{titleCase(t.type)}</span>
              <span className="muted" style={{ fontSize: 12.5 }}>{t.date}</span>
            </div>
            <div className="detail">{t.summary}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function Transitions({ detail, busy, act }: { detail: Detail; busy: boolean; act: Act }) {
  const options = detail.transitions.filter(
    (t) => t.allowed || t.blockers.some((b) => b.code !== 'illegal_transition'),
  );
  if (options.length === 0) return null;

  return (
    <>
      <h2>Move stage</h2>
      <div className="card rows">
        {options.map((t) => (
          <div key={t.to}>
            <div className="head">
              <span style={{ fontWeight: 560 }}>{titleCase(t.to)}</span>
              <button
                disabled={busy || !t.allowed}
                onClick={() => act(() => api.transition(detail.slug, t.to), `Moved to ${t.to}.`)}
              >
                {t.allowed ? 'Move' : 'Blocked'}
              </button>
            </div>
            {!t.allowed ? (
              <ul className="blockers">
                {t.blockers.map((b, i) => (
                  <li key={i}>{b.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
