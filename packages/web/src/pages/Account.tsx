import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PHASE_LABEL,
  STAGE_LABEL,
  STAGE_PHASE,
  recordNoun,
  type LifecycleStage,
  type Signal,
} from '@cs/core';
import { api, ApiError, type CommitEntry, type CustomerDetail, type Me } from '../api.ts';
import { money, relative, titleCase } from '../format.ts';
import { BandChip, Score, SEVERITY_COLOR, type Band, type Severity } from '../components/status.tsx';
import { Disclosure, Field, InlineEdit } from '../components/form.tsx';

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function Account() {
  const { slug = '' } = useParams();
  const [d, setD] = useState<CustomerDetail | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [commits, setCommits] = useState<CommitEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [detail, who] = await Promise.all([api.customer(slug), api.me()]);
    setD(detail);
    setMe(who);
    api.history(slug).then((h) => setCommits(h.commits)).catch(() => setCommits([]));
  }, [slug]);

  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
  }, [reload]);

  /** Runs an edit, surfaces whatever went wrong, and refreshes. */
  const act = useCallback(
    async (fn: () => Promise<unknown>, done: string) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await reload();
        setFlash(done);
        setTimeout(() => setFlash(null), 2500);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? [err.message, ...err.issues, ...err.blockers.map((b) => b.message)].join('\n')
            : String(err),
        );
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (error && !d) return <div className="error">{error}</div>;
  if (!d || !me) return <p className="empty">Loading…</p>;

  const stage = d.customer.lifecycle_stage as LifecycleStage;
  const phase = STAGE_PHASE[stage];
  const noun = recordNoun(stage);
  const canEdit = me.role !== 'csm' || d.customer.owners.accountable.toLowerCase() === me.email;
  const isLeadership = me.role === 'leadership' || me.role === 'admin';

  const patch = (p: Record<string, unknown>, done: string) =>
    act(() => api.patchCustomer(slug, d.base_sha ?? '', p), done);

  return (
    <>
      <p className="crumb">
        <Link to="/">← Pipeline</Link>
      </p>

      <div className="page-head">
        <div>
          <div className="title-row">
            <h1>{d.customer.name}</h1>
            <span className={`phase-badge phase-${phase}`}>{PHASE_LABEL[phase]}</span>
          </div>
          <p className="sub">
            {noun === 'opportunity' ? 'Opportunity' : 'Customer'} · {STAGE_LABEL[stage]} ·{' '}
            {money(d.customer.contract.value_annual)}
          </p>
        </div>
        <div className="health-block">
          <Score score={d.health.score} band={d.health.band as Band} />
          <BandChip band={d.health.band as Band} />
        </div>
      </div>

      {flash ? <div className="notice ok">{flash}</div> : null}
      {error ? <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div> : null}
      {!canEdit ? (
        <div className="notice">
          You can read this account but not change it — {d.customer.owners.accountable} owns it.
        </div>
      ) : null}

      <div className="cols">
        <div>
          <Responsibilities d={d} canEdit={canEdit} isLeadership={isLeadership} me={me} busy={busy} act={act} />
          <Handoff d={d} phase={phase} canEdit={canEdit} isLeadership={isLeadership} busy={busy} act={act} />
          <Commitments d={d} phase={phase} canEdit={canEdit} busy={busy} act={act} />
          <Risks d={d} canEdit={canEdit} busy={busy} act={act} />
          <Touchpoints d={d} canEdit={canEdit} me={me} busy={busy} act={act} />
        </div>

        <div>
          <Details d={d} canEdit={canEdit} patch={patch} />
          <StageControl d={d} canEdit={canEdit} busy={busy} act={act} />
          <Why signals={d.health.signals} />
          {commits.length > 0 ? (
            <section className="panel">
              <h2>History</h2>
              <div className="stack">
                {commits.slice(0, 10).map((c) => (
                  <div key={c.sha} className="history-row">
                    <span>{c.message.split('\n')[0]}</span>
                    <span className="muted">
                      {c.author} · {relative(c.date)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

type Act = (fn: () => Promise<unknown>, done: string) => Promise<void>;

// ---------------------------------------------------------------- pieces

function Responsibilities({
  d,
  canEdit,
  isLeadership,
  me,
  busy,
  act,
}: {
  d: CustomerDetail;
  canEdit: boolean;
  isLeadership: boolean;
  me: Me;
  busy: boolean;
  act: Act;
}) {
  const o = d.customer.owners;
  const [next, setNext] = useState('');
  const unacknowledged = !o.acknowledged_by_accountable;
  const isIncoming = o.accountable.toLowerCase() === me.email.toLowerCase();

  return (
    <section className="panel">
      <h2>Who is responsible</h2>
      <div className="owners">
        <div>
          <span className="owner-role">Accountable</span>
          <span className="owner-name">{o.accountable}</span>
          <span className="owner-note">Single owner. Always exactly one.</span>
        </div>
        <div>
          <span className="owner-role">Delivery lead</span>
          <span className="owner-name">{o.delivery_lead ?? <span className="muted">Not assigned</span>}</span>
          <span className="owner-note">Carries the commitments after handoff.</span>
        </div>
        <div>
          <span className="owner-role">Pre-sales lead</span>
          <span className="owner-name">{o.presales_lead ?? <span className="muted">Not assigned</span>}</span>
          <span className="owner-note">Made the promises during the sale.</span>
        </div>
      </div>

      {unacknowledged ? (
        <div className="notice warn" style={{ marginTop: 12 }}>
          <strong>Transfer not acknowledged.</strong> {o.accountable} has not confirmed they have
          picked this up{o.transferred_at ? `, ${relative(o.transferred_at)}` : ''}.
          {isIncoming ? (
            <button
              className="btn"
              style={{ marginLeft: 10 }}
              disabled={busy}
              onClick={() => act(() => api.acknowledgeOwnership(d.slug), 'Ownership acknowledged.')}
            >
              I have got it
            </button>
          ) : null}
        </div>
      ) : null}

      {isLeadership ? (
        <Disclosure label="Reassign ownership">
          <div className="row-form">
            <input
              type="email"
              placeholder="new.owner@bah.com"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={busy || !next.trim()}
              onClick={() =>
                act(() => api.reassign(d.slug, next.trim()), 'Reassigned. Waiting on acknowledgement.')
              }
            >
              Reassign
            </button>
          </div>
          <p className="field-hint">
            The new owner has to acknowledge before the account is considered handed over.
          </p>
        </Disclosure>
      ) : (
        <p className="field-hint" style={{ marginTop: 10 }}>
          Only leadership can reassign ownership.
        </p>
      )}
    </section>
  );
}

function Handoff({
  d,
  phase,
  canEdit,
  isLeadership,
  busy,
  act,
}: {
  d: CustomerDetail;
  phase: string;
  canEdit: boolean;
  isLeadership: boolean;
  busy: boolean;
  act: Act;
}) {
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [waiving, setWaiving] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reviewBy, setReviewBy] = useState(plusDays(30));

  if (!d.handoff) {
    return (
      <section className="panel">
        <h2>Handoff</h2>
        <p className="muted">
          No gate open yet. Open one when the deal is won — this account cannot move into
          onboarding until every required item is done or waived.
        </p>
        {canEdit ? (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => act(() => api.openHandoff(d.slug), 'Handoff gate opened.')}
          >
            Open the handoff gate
          </button>
        ) : null}
      </section>
    );
  }

  const g = d.gate;
  const pct = g && g.total > 0 ? Math.round(((g.complete + g.waived) / g.total) * 100) : 0;

  return (
    <section className="panel">
      <h2>Handoff</h2>
      {g ? (
        <>
          <div className="gate-bar big">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="gate-summary">
            <strong>{g.complete} done</strong>, {g.waived} waived, {g.required_incomplete} still
            required
            {g.expired_waivers > 0 ? (
              <span className="danger-text"> · {g.expired_waivers} waiver past its review date</span>
            ) : null}
          </p>
          {g.waiver_rate > 0.3 ? (
            <p className="field-hint">
              Over a third of this gate is waived. That usually means the checklist is wrong, not
              the people.
            </p>
          ) : null}
        </>
      ) : null}

      <div className="stack">
        {d.handoff.items.map((item) => {
          const expired =
            item.status === 'waived' && item.waiver != null && item.waiver.review_by < today();
          const state = item.status === 'waived' ? (expired ? 'expired' : 'waived') : item.status;
          return (
            <div className={`gate-item state-${state}`} key={item.id}>
              <div className="gate-item-head">
                <span className="gate-title">{item.title}</span>
                {!item.required ? <span className="tag">optional</span> : null}
                <span className={`tag state-${state}`}>
                  {state === 'expired' ? 'Waiver expired' : titleCase(state)}
                </span>
              </div>
              {item.evidence ? <p className="gate-evidence">{item.evidence}</p> : null}
              {item.waiver ? (
                <p className="gate-evidence">
                  Waived by {item.waiver.by}: {item.waiver.reason} · review by{' '}
                  {item.waiver.review_by}
                </p>
              ) : null}

              {item.status !== 'complete' && canEdit ? (
                <div className="gate-actions">
                  <input
                    placeholder="Evidence — a link, or who confirmed it"
                    value={evidence[item.id] ?? ''}
                    onChange={(e) => setEvidence({ ...evidence, [item.id]: e.target.value })}
                  />
                  <button
                    className="btn"
                    disabled={busy || !(evidence[item.id] ?? '').trim()}
                    onClick={() =>
                      act(
                        () => api.completeItem(d.slug, item.id, evidence[item.id]!.trim()),
                        'Marked complete.',
                      )
                    }
                  >
                    Done
                  </button>
                  {isLeadership ? (
                    <button className="btn subtle" onClick={() => setWaiving(item.id)}>
                      Waive
                    </button>
                  ) : null}
                </div>
              ) : null}

              {waiving === item.id ? (
                <div className="waive-form">
                  <Field label="Why is this being skipped?">
                    <textarea
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Sponsor on leave until mid-October; intro already scheduled."
                    />
                  </Field>
                  <Field
                    label="Come back to it on"
                    hint="A waiver is a deferral. It returns to the attention list on this date."
                  >
                    <input
                      type="date"
                      value={reviewBy}
                      min={plusDays(1)}
                      onChange={(e) => setReviewBy(e.target.value)}
                    />
                  </Field>
                  <div className="row-form">
                    <button
                      className="btn primary"
                      disabled={busy || reason.trim().length < 10}
                      onClick={() =>
                        act(async () => {
                          await api.waiveItem(d.slug, item.id, reason.trim(), reviewBy);
                          setWaiving(null);
                          setReason('');
                        }, 'Waived, with a review date.')
                      }
                    >
                      Record the waiver
                    </button>
                    <button className="btn subtle" onClick={() => setWaiving(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Commitments({
  d,
  phase,
  canEdit,
  busy,
  act,
}: {
  d: CustomerDetail;
  phase: string;
  canEdit: boolean;
  busy: boolean;
  act: Act;
}) {
  const [form, setForm] = useState({
    title: '',
    owner: d.customer.owners.accountable,
    due: plusDays(30),
    severity: 'committed',
    origin: 'presales',
    made_to: '',
  });

  const unaccepted = d.commitments.filter(
    (c) => c.origin === 'presales' && !c.accepted_at_handoff && c.status !== 'complete' && c.status !== 'waived',
  );

  return (
    <section className="panel">
      <h2>Commitments</h2>
      <p className="panel-blurb">
        Promises with an owner and a date. The ones made during the sale are what get lost at
        the handoff, so they carry where they came from.
      </p>

      {/* Only once the handoff is actually in play. Warning that something
          "blocks onboarding" on a deal still being pursued is noise two stages
          early, and noise is how warnings stop being read. */}
      {unaccepted.length > 0 && (phase === 'handoff' || d.handoff !== null) ? (
        <div className="notice warn">
          <strong>
            {unaccepted.length} pre-sales {unaccepted.length === 1 ? 'promise has' : 'promises have'}{' '}
            not been accepted by delivery.
          </strong>{' '}
          This blocks the move into onboarding.
        </div>
      ) : null}

      <div className="stack">
        {d.commitments.length === 0 ? (
          <p className="empty small">Nothing recorded yet.</p>
        ) : (
          d.commitments.map((c) => {
            const open = c.status !== 'complete' && c.status !== 'waived';
            const late = open && c.due < today();
            return (
              <div className={`commitment${late ? ' late' : ''}`} key={c.id}>
                <div className="commitment-head">
                  <span className="commitment-title">{c.title}</span>
                  <span className={`tag ${late ? 'state-expired' : `state-${c.status}`}`}>
                    {late ? 'Past due' : titleCase(c.status)}
                  </span>
                </div>
                <div className="commitment-meta">
                  <span>due {c.due}</span>
                  <span>{c.owner.replace('@bah.com', '')}</span>
                  <span>{titleCase(c.severity)}</span>
                  <span>from {titleCase(c.origin)}</span>
                  {c.made_to ? <span>to {c.made_to}</span> : null}
                </div>

                {canEdit ? (
                  <div className="commitment-actions">
                    {c.origin === 'presales' && !c.accepted_at_handoff && open ? (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() =>
                          act(
                            () => api.updateCommitment(d.slug, c.id, { accepted_at_handoff: true }),
                            'Accepted — it now travels with delivery.',
                          )
                        }
                      >
                        Accept for delivery
                      </button>
                    ) : null}
                    {open ? (
                      <select
                        value={c.status}
                        disabled={busy}
                        onChange={(e) =>
                          act(
                            () => api.updateCommitment(d.slug, c.id, { status: e.target.value }),
                            'Status updated.',
                          )
                        }
                      >
                        <option value="not_started">Not started</option>
                        <option value="in_progress">In progress</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    ) : null}
                    {open ? (
                      <CompleteWithEvidence
                        busy={busy}
                        onDone={(evidence) =>
                          act(
                            () => api.updateCommitment(d.slug, c.id, { status: 'complete', evidence }),
                            'Marked complete.',
                          )
                        }
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {canEdit ? (
        <Disclosure label="Record a commitment">
          <div className="grid-form">
            <Field label="What was promised">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="SAML SSO integration with their IdP"
              />
            </Field>
            <Field label="Promised to">
              <input
                value={form.made_to}
                onChange={(e) => setForm({ ...form, made_to: e.target.value })}
                placeholder="Dana Vance, CTO"
              />
            </Field>
            <Field label="Owner">
              <input
                type="email"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
              />
            </Field>
            <Field label="Due">
              <input
                type="date"
                value={form.due}
                onChange={(e) => setForm({ ...form, due: e.target.value })}
              />
            </Field>
            <Field label="Where was it promised?">
              <select
                value={form.origin}
                onChange={(e) => setForm({ ...form, origin: e.target.value })}
              >
                <option value="presales">During the sale</option>
                <option value="onboarding">During onboarding</option>
                <option value="steady_state">While live</option>
                <option value="renewal">At renewal</option>
              </select>
            </Field>
            <Field label="How binding?" hint="Contractual failures dominate the health score.">
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
              >
                <option value="contractual">Contractual</option>
                <option value="committed">Committed</option>
                <option value="best_effort">Best effort</option>
              </select>
            </Field>
          </div>
          <button
            className="btn primary"
            disabled={busy || !form.title.trim()}
            onClick={() =>
              act(async () => {
                await api.addCommitment(d.slug, {
                  id: slugify(form.title),
                  title: form.title.trim(),
                  origin: form.origin,
                  made_to: form.made_to.trim() || null,
                  owner: form.owner.trim(),
                  due: form.due,
                  severity: form.severity,
                });
                setForm({ ...form, title: '', made_to: '' });
              }, 'Commitment recorded.')
            }
          >
            Record it
          </button>
        </Disclosure>
      ) : null}
    </section>
  );
}

function CompleteWithEvidence({
  busy,
  onDone,
}: {
  busy: boolean;
  onDone: (evidence: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState('');
  if (!open) {
    return (
      <button className="btn subtle" onClick={() => setOpen(true)}>
        Mark done
      </button>
    );
  }
  return (
    <span className="row-form">
      <input
        autoFocus
        placeholder="Evidence — a link or who signed off"
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
      />
      <button
        className="btn primary"
        disabled={busy || !evidence.trim()}
        onClick={() => {
          onDone(evidence.trim());
          setOpen(false);
          setEvidence('');
        }}
      >
        Save
      </button>
    </span>
  );
}

function Risks({ d, canEdit, busy, act }: { d: CustomerDetail; canEdit: boolean; busy: boolean; act: Act }) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('medium');
  const open = d.risks.filter((r) => r.status !== 'closed');

  return (
    <section className="panel">
      <h2>Risks</h2>
      <div className="stack">
        {open.length === 0 ? (
          <p className="empty small">No open risks.</p>
        ) : (
          open.map((r) => (
            <div className="risk" key={r.id}>
              <span
                className="sev-dot"
                style={{ background: SEVERITY_COLOR[r.severity as Severity] }}
                aria-hidden
              />
              <div>
                <div className="risk-title">{r.title}</div>
                <div className="commitment-meta">
                  <span>{titleCase(r.severity)}</span>
                  <span>open since {r.opened}</span>
                  <span>{r.owner.replace('@bah.com', '')}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {canEdit ? (
        <Disclosure label="Log a risk">
          <div className="row-form">
            <input
              className="grow"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Exec sponsor has left the company"
            />
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <button
              className="btn primary"
              disabled={busy || !title.trim()}
              onClick={() =>
                act(async () => {
                  await api.addRisk(d.slug, {
                    id: slugify(title),
                    title: title.trim(),
                    severity,
                    owner: d.customer.owners.accountable,
                  });
                  setTitle('');
                }, 'Risk logged.')
              }
            >
              Log it
            </button>
          </div>
        </Disclosure>
      ) : null}
    </section>
  );
}

function Touchpoints({
  d,
  canEdit,
  me,
  busy,
  act,
}: {
  d: CustomerDetail;
  canEdit: boolean;
  me: Me;
  busy: boolean;
  act: Act;
}) {
  const [form, setForm] = useState({ date: today(), type: 'check_in', summary: '', body: '' });

  return (
    <section className="panel">
      <h2>Contact</h2>
      <div className="stack">
        {d.touchpoints.length === 0 ? (
          <p className="empty small">Nothing logged. Silence is what the system watches for.</p>
        ) : (
          d.touchpoints.slice(0, 6).map((t) => (
            <div className="touchpoint" key={t.path}>
              <div className="commitment-head">
                <span className="commitment-title">{titleCase(t.type)}</span>
                <span className="muted">{t.date}</span>
              </div>
              <p className="gate-evidence">{t.summary}</p>
            </div>
          ))
        )}
      </div>
      {canEdit ? (
        <Disclosure label="Log contact">
          <div className="grid-form">
            <Field label="When">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </Field>
            <Field label="What kind">
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="check_in">Check-in</option>
                <option value="qbr">Business review</option>
                <option value="kickoff">Kickoff</option>
                <option value="technical">Technical</option>
                <option value="exec">Executive</option>
                <option value="escalation">Escalation</option>
              </select>
            </Field>
          </div>
          <Field label="One-line summary">
            <input
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="Quarterly review — adoption ahead of plan, expansion signal on claims"
            />
          </Field>
          <Field label="Notes" hint="Optional. Markdown is fine.">
            <textarea
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </Field>
          <button
            className="btn primary"
            disabled={busy || !form.summary.trim()}
            onClick={() =>
              act(async () => {
                await api.addTouchpoint(d.slug, {
                  date: form.date,
                  type: form.type,
                  summary: form.summary.trim(),
                  body: form.body,
                  attendees_internal: [me.email],
                });
                setForm({ ...form, summary: '', body: '' });
              }, 'Contact logged.')
            }
          >
            Log it
          </button>
        </Disclosure>
      ) : null}
    </section>
  );
}

function Details({
  d,
  canEdit,
  patch,
}: {
  d: CustomerDetail;
  canEdit: boolean;
  patch: (p: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const c = d.customer;
  return (
    <section className="panel">
      <h2>Details</h2>
      <dl className="detail-list">
        <dt>Tier</dt>
        <dd>
          {canEdit ? (
            <select
              value={c.tier}
              onChange={(e) => patch({ tier: e.target.value }, 'Tier updated.')}
            >
              <option value="strategic">Strategic — contact every 14d</option>
              <option value="growth">Growth — every 30d</option>
              <option value="standard">Standard — every 60d</option>
            </select>
          ) : (
            titleCase(c.tier)
          )}
        </dd>

        <dt>Annual value</dt>
        <dd>
          <InlineEdit
            type="number"
            disabled={!canEdit}
            display={(v) => money(Number(v) || 0)}
            value={String(c.contract.value_annual)}
            onSave={(v) =>
              patch({ contract: { ...c.contract, value_annual: Number(v) || 0 } }, 'Value updated.')
            }
          />
        </dd>

        <dt>Contract</dt>
        <dd>
          <InlineEdit
            type="date"
            disabled={!canEdit}
            value={c.contract.start}
            onSave={(v) => patch({ contract: { ...c.contract, start: v } }, 'Start date updated.')}
          />
          {' → '}
          <InlineEdit
            type="date"
            disabled={!canEdit}
            value={c.contract.end}
            onSave={(v) => patch({ contract: { ...c.contract, end: v } }, 'End date updated.')}
          />
        </dd>

        <dt>Vehicle</dt>
        <dd>
          <InlineEdit
            disabled={!canEdit}
            value={c.contract.vehicle ?? ''}
            onSave={(v) => patch({ contract: { ...c.contract, vehicle: v || null } }, 'Vehicle updated.')}
          />
        </dd>

        <dt>Last contact</dt>
        <dd>
          {d.touchpoints[0]?.date ?? <span className="muted">Never</span>}
        </dd>
      </dl>

      {d.stakeholders && d.stakeholders.people.length > 0 ? (
        <>
          <h3>Their people</h3>
          <div className="stack">
            {d.stakeholders.people.map((p) => (
              <div key={p.name}>
                <div className="owner-name">{p.name}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {p.role} · {titleCase(p.influence)}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function StageControl({
  d,
  canEdit,
  busy,
  act,
}: {
  d: CustomerDetail;
  canEdit: boolean;
  busy: boolean;
  act: Act;
}) {
  const [confirmChurn, setConfirmChurn] = useState(false);
  if (!canEdit) return null;

  const relevant = d.transitions.filter(
    (t) => t.allowed || t.blockers.some((b) => b.code !== 'illegal_transition'),
  );
  // Churn is an ending, not a step forward. It gets its own subdued control with
  // a confirmation, so a $3M account is never one stray click from closed.
  const forward = relevant.filter((t) => t.to !== 'churned');
  const churn = relevant.find((t) => t.to === 'churned');
  if (forward.length === 0 && !churn) return null;

  return (
    <section className="panel">
      <h2>Move it forward</h2>
      <div className="stack">
        {forward.map((t) => (
          <div key={t.to}>
            <div className="row-form">
              <span className="grow">{STAGE_LABEL[t.to as LifecycleStage] ?? t.to}</span>
              <button
                className={t.allowed ? 'btn primary' : 'btn subtle'}
                disabled={busy || !t.allowed}
                onClick={() => act(() => api.transition(d.slug, t.to), `Moved to ${t.to}.`)}
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
        {forward.length === 0 ? (
          <p className="muted">No further stage available from here.</p>
        ) : null}
      </div>

      {churn?.allowed ? (
        <div className="churn-zone">
          {confirmChurn ? (
            <>
              <p className="field-hint">
                This closes {d.customer.name} as lost. The record and its history stay, but it
                leaves the active pipeline.
              </p>
              <div className="row-form">
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await api.transition(d.slug, 'churned');
                      setConfirmChurn(false);
                    }, 'Closed as churned.')
                  }
                >
                  Yes, close it as churned
                </button>
                <button className="btn subtle" onClick={() => setConfirmChurn(false)}>
                  Keep it open
                </button>
              </div>
            </>
          ) : (
            <button className="linklike danger" onClick={() => setConfirmChurn(true)}>
              Close as churned
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Why({ signals }: { signals: Signal[] }) {
  const fired = signals.filter((s) => s.fired);
  return (
    <section className="panel">
      <h2>Why this score</h2>
      {fired.length === 0 ? (
        <p className="muted">Nothing is wrong with this account right now.</p>
      ) : (
        <div className="stack">
          {fired.map((s) => (
            <div className="signal-row" key={s.id}>
              <span
                className="sev-dot"
                style={{ background: SEVERITY_COLOR[s.severity as Severity] }}
                aria-hidden
              />
              <div>
                <div className="owner-name">
                  {s.label} <span className="muted">−{s.points}</span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {s.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
