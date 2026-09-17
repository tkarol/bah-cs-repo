/**
 * Derived health. Invariant P2: no human ever sets an account's colour.
 *
 * Every signal is a pure function of the customer's files plus `asOf`. Each
 * returns the penalty points it contributes AND a human-readable reason, because
 * a red account that cannot explain itself trains people to ignore the colour.
 */
import { daysSince, daysUntil } from './dates.ts';
import {
  STAGE_EXPECTED_DAYS,
  TIER_CADENCE_DAYS,
  type Commitment,
  type Risk,
} from './schema.ts';
import type { CustomerRecord } from './load.ts';

export const SIGNAL_IDS = [
  'contact_decay',
  'past_due_commitments',
  'handoff_debt',
  'stage_stagnation',
  'risk_aging',
  'ownership_gap',
  'renewal_exposure',
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Band = 'green' | 'amber' | 'red';

export interface Signal {
  id: SignalId;
  label: string;
  fired: boolean;
  points: number;
  severity: Severity;
  /** Shown verbatim in the UI. Must state the fact, not the judgement. */
  detail: string;
  /** When the condition began, used to rank the exception feed. */
  since: string | null;
  /** Repo-relative paths of the records responsible. */
  refs: string[];
}

export interface Health {
  score: number;
  band: Band;
  signals: Signal[];
}

/** Score thresholds. Tune against real accounts after the pilot (docs §11). */
export const BAND_THRESHOLDS = { green: 75, amber: 45 } as const;

const COMMITMENT_WEIGHT: Record<Commitment['severity'], number> = {
  contractual: 20,
  committed: 10,
  best_effort: 4,
};

const RISK_WEIGHT: Record<Risk['severity'], number> = {
  critical: 15,
  high: 9,
  medium: 4,
  low: 1,
};

const OPEN_COMMITMENT_STATUSES: ReadonlySet<Commitment['status']> = new Set([
  'not_started',
  'in_progress',
  'blocked',
]);

function ok(id: SignalId, label: string, detail: string): Signal {
  return { id, label, fired: false, points: 0, severity: 'low', detail, since: null, refs: [] };
}

/** Effective touchpoint cadence: explicit override, else the tier default. */
export function cadenceFor(record: CustomerRecord): number {
  return record.customer.cadence_days ?? TIER_CADENCE_DAYS[record.customer.tier];
}

/** The most recent touchpoint, or the stage entry date when there are none. */
export function lastContactDate(record: CustomerRecord): string {
  return record.touchpoints[0]?.date ?? record.customer.stage_entered;
}

function contactDecay(record: CustomerRecord, asOf: Date): Signal {
  const label = 'Contact decay';
  const cadence = cadenceFor(record);
  const last = lastContactDate(record);
  const elapsed = daysSince(last, asOf);
  const hadContact = record.touchpoints.length > 0;

  if (elapsed <= cadence) {
    return ok('contact_decay', label, `Last contact ${elapsed}d ago, within ${cadence}d cadence.`);
  }

  const overdueWeeks = Math.floor((elapsed - cadence) / 7);
  const points = Math.min(25, 5 + overdueWeeks * 5);
  return {
    id: 'contact_decay',
    label,
    fired: true,
    points,
    severity: points >= 20 ? 'high' : 'medium',
    detail: hadContact
      ? `No contact in ${elapsed}d; ${record.customer.tier} cadence is ${cadence}d.`
      : `No touchpoint ever logged; ${elapsed}d since entering ${record.customer.lifecycle_stage}.`,
    since: last,
    refs: record.touchpoints[0] ? [record.touchpoints[0].path] : [],
  };
}

function pastDueCommitments(record: CustomerRecord, asOf: Date): Signal {
  const label = 'Past-due commitments';
  const overdue = record.commitments.filter(
    (c) => OPEN_COMMITMENT_STATUSES.has(c.status) && daysUntil(c.due, asOf) < 0,
  );

  if (overdue.length === 0) {
    return ok('past_due_commitments', label, 'No commitments past due.');
  }

  const raw = overdue.reduce((sum, c) => sum + COMMITMENT_WEIGHT[c.severity], 0);
  const points = Math.min(40, raw);
  const worst = overdue.some((c) => c.severity === 'contractual');
  const oldest = overdue.reduce((a, b) => (a.due <= b.due ? a : b));

  return {
    id: 'past_due_commitments',
    label,
    fired: true,
    points,
    severity: worst ? 'critical' : 'high',
    detail:
      `${overdue.length} commitment${overdue.length === 1 ? '' : 's'} past due` +
      (worst ? ', including a contractual one' : '') +
      `. Oldest: "${oldest.title}" due ${oldest.due}.`,
    since: oldest.due,
    refs: overdue.map((c) => `customers/${record.slug}/commitments/${c.id}.yaml`),
  };
}

function handoffDebt(record: CustomerRecord, asOf: Date): Signal {
  const label = 'Handoff debt';
  const handoff = record.handoff;
  if (!handoff) return ok('handoff_debt', label, 'No handoff gate open.');

  const ref = `customers/${record.slug}/handoff.yaml`;
  const incomplete = handoff.items.filter((i) => i.required && i.status === 'incomplete');
  const expired = handoff.items.filter(
    (i) => i.status === 'waived' && i.waiver && daysUntil(i.waiver.review_by, asOf) < 0,
  );

  if (incomplete.length === 0 && expired.length === 0) {
    return ok('handoff_debt', label, 'Handoff gate clear.');
  }

  const points = Math.min(35, incomplete.length * 12 + expired.length * 10);
  const parts: string[] = [];
  if (incomplete.length) parts.push(`${incomplete.length} required item(s) incomplete`);
  if (expired.length) parts.push(`${expired.length} waiver(s) past review date`);

  const sinceCandidates = [
    ...incomplete.map(() => handoff.target_completion),
    ...expired.map((i) => i.waiver!.review_by),
  ].sort();

  return {
    id: 'handoff_debt',
    label,
    fired: true,
    points,
    severity: expired.length > 0 || incomplete.length > 2 ? 'high' : 'medium',
    detail: `${parts.join('; ')}. Gate opened ${handoff.opened}, target ${handoff.target_completion}.`,
    since: sinceCandidates[0] ?? handoff.target_completion,
    refs: [ref],
  };
}

function stageStagnation(record: CustomerRecord, asOf: Date): Signal {
  const label = 'Stage stagnation';
  const stage = record.customer.lifecycle_stage;
  const expected = STAGE_EXPECTED_DAYS[stage];
  const elapsed = daysSince(record.customer.stage_entered, asOf);

  if (expected === null) {
    return ok('stage_stagnation', label, `Stage "${stage}" has no expected exit.`);
  }
  if (elapsed <= expected) {
    return ok('stage_stagnation', label, `${elapsed}d in "${stage}", within ${expected}d band.`);
  }

  const doubled = elapsed > expected * 2;
  return {
    id: 'stage_stagnation',
    label,
    fired: true,
    points: doubled ? 16 : 8,
    severity: doubled ? 'high' : 'medium',
    detail: `${elapsed}d in "${stage}", ${elapsed - expected}d beyond the ${expected}d band.`,
    since: record.customer.stage_entered,
    refs: [`customers/${record.slug}/customer.yaml`],
  };
}

function riskAging(record: CustomerRecord, asOf: Date): Signal {
  const label = 'Risk aging';
  const open = record.risks.filter((r) => r.status !== 'closed');
  if (open.length === 0) return ok('risk_aging', label, 'No open risks.');

  let raw = 0;
  for (const risk of open) {
    const age = Math.max(0, daysSince(risk.opened, asOf));
    // An unresolved risk gets worse the longer it sits, up to 2x its weight.
    const agingMultiplier = Math.min(2, 1 + age / 90);
    raw += RISK_WEIGHT[risk.severity] * agingMultiplier;
  }
  const points = Math.min(30, Math.round(raw));
  const oldest = open.reduce((a, b) => (a.opened <= b.opened ? a : b));
  const worst = open.some((r) => r.severity === 'critical');

  return {
    id: 'risk_aging',
    label,
    fired: true,
    points,
    severity: worst ? 'critical' : points >= 15 ? 'high' : 'medium',
    detail:
      `${open.length} open risk${open.length === 1 ? '' : 's'}. ` +
      `Oldest: "${oldest.title}" (${oldest.severity}) open ${daysSince(oldest.opened, asOf)}d.`,
    since: oldest.opened,
    refs: open.map((r) => `customers/${record.slug}/risks/${r.id}.yaml`),
  };
}

function ownershipGap(record: CustomerRecord, asOf: Date): Signal {
  const label = 'Ownership gap';
  const { owners } = record.customer;
  const ref = `customers/${record.slug}/customer.yaml`;

  if (!owners.acknowledged_by_accountable) {
    const since = owners.transferred_at ?? record.customer.stage_entered;
    const elapsed = daysSince(since, asOf);
    return {
      id: 'ownership_gap',
      label,
      fired: true,
      points: 15,
      severity: elapsed > 14 ? 'high' : 'medium',
      detail: `Ownership transferred to ${owners.accountable} ${elapsed}d ago, not yet acknowledged.`,
      since,
      refs: [ref],
    };
  }
  return ok('ownership_gap', label, `Owned by ${owners.accountable}, acknowledged.`);
}

function renewalExposure(record: CustomerRecord, asOf: Date): Signal {
  const label = 'Renewal exposure';
  const end = record.customer.contract.end;
  const remaining = daysUntil(end, asOf);
  const ref = `customers/${record.slug}/customer.yaml`;

  if (record.customer.lifecycle_stage === 'churned') {
    return ok('renewal_exposure', label, 'Account churned; renewal not applicable.');
  }
  if (remaining > 180) {
    return ok('renewal_exposure', label, `Renewal ${remaining}d out; no plan required yet.`);
  }
  if (record.renewal) {
    return ok('renewal_exposure', label, `Renewal ${remaining}d out; plan on file.`);
  }

  // Graduated deliberately: a renewal 5 months out with no plan is a nudge, not
  // an alarm. Firing "high" that early would leave well-run accounts permanently
  // amber, which is how people learn to ignore the colour.
  const points = remaining <= 30 ? 30 : remaining <= 90 ? 20 : 8;
  const severity: Severity = remaining <= 30 ? 'critical' : remaining <= 90 ? 'high' : 'medium';
  return {
    id: 'renewal_exposure',
    label,
    fired: true,
    points,
    severity,
    detail:
      remaining < 0
        ? `Contract ended ${-remaining}d ago with no renewal plan on file.`
        : `Renewal in ${remaining}d with no renewal.yaml on file.`,
    since: end,
    refs: [ref],
  };
}

const EVALUATORS: ReadonlyArray<(r: CustomerRecord, asOf: Date) => Signal> = [
  contactDecay,
  pastDueCommitments,
  handoffDebt,
  stageStagnation,
  riskAging,
  ownershipGap,
  renewalExposure,
];

export function bandFor(score: number): Band {
  if (score >= BAND_THRESHOLDS.green) return 'green';
  if (score >= BAND_THRESHOLDS.amber) return 'amber';
  return 'red';
}

export function evaluateHealth(record: CustomerRecord, asOf: Date): Health {
  const signals = EVALUATORS.map((fn) => fn(record, asOf));
  const penalty = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.max(0, 100 - penalty);
  return { score, band: bandFor(score), signals };
}
