/**
 * Building index.json and exceptions.json.
 *
 * These are generated artifacts that happen to live in the repo. Nothing here
 * is a database: the index is a pure function of the customer files, so it can
 * be deleted and regenerated at any time.
 */
import { daysSince, daysUntil, toISODate } from './dates.ts';
import { evaluateHealth, cadenceFor, lastContactDate, type Band, type Severity, type Signal } from './health.ts';
import { gateProgress, type GateProgress } from './gate.ts';
import type { CustomerRecord } from './load.ts';

/** Bump when the shape changes so a stale index is detectable rather than silently wrong. */
export const INDEX_SCHEMA_VERSION = 1;

export interface IndexEntry {
  slug: string;
  name: string;
  tier: string;
  lifecycle_stage: string;
  stage_entered: string;
  days_in_stage: number;
  contract: { value_annual: number; start: string; end: string; days_to_renewal: number };
  accountable_owner: string;
  delivery_lead: string | null;
  presales_lead: string | null;
  health: { score: number; band: Band; signals: Signal[] };
  counts: {
    commitments_total: number;
    commitments_open: number;
    commitments_past_due: number;
    risks_open: number;
    touchpoints: number;
    stakeholders: number;
  };
  last_contact: string;
  days_since_contact: number;
  cadence_days: number;
  handoff: GateProgress | null;
  renewal_on_file: boolean;
}

export interface PortfolioTotals {
  customers: number;
  by_band: Record<Band, number>;
  arr_total: number;
  /** ARR attached to accounts that are not green — the number leadership asks for. */
  arr_not_green: number;
  exceptions_by_severity: Record<Severity, number>;
  open_commitments_past_due: number;
  open_risks: number;
}

export interface CustomerIndex {
  schema_version: number;
  generated_at: string;
  as_of: string;
  totals: PortfolioTotals;
  customers: IndexEntry[];
}

export interface ExceptionRecord {
  /** Stable across rebuilds, so the UI can track dismissals later. */
  key: string;
  slug: string;
  customer: string;
  tier: string;
  lifecycle_stage: string;
  accountable_owner: string;
  signal: string;
  label: string;
  detail: string;
  severity: Severity;
  points: number;
  since: string | null;
  age_days: number | null;
  arr: number;
  refs: string[];
}

export interface ExceptionFeed {
  schema_version: number;
  generated_at: string;
  as_of: string;
  count: number;
  exceptions: ExceptionRecord[];
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function nonNegativeAge(since: string, asOf: Date): number | null {
  const age = daysSince(since, asOf);
  return age >= 0 ? age : null;
}

const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked']);

export function buildEntry(record: CustomerRecord, asOf: Date): IndexEntry {
  const health = evaluateHealth(record, asOf);
  const last = lastContactDate(record);
  const openCommitments = record.commitments.filter((c) => OPEN_STATUSES.has(c.status));

  return {
    slug: record.slug,
    name: record.customer.name,
    tier: record.customer.tier,
    lifecycle_stage: record.customer.lifecycle_stage,
    stage_entered: record.customer.stage_entered,
    days_in_stage: daysSince(record.customer.stage_entered, asOf),
    contract: {
      value_annual: record.customer.contract.value_annual,
      start: record.customer.contract.start,
      end: record.customer.contract.end,
      days_to_renewal: daysUntil(record.customer.contract.end, asOf),
    },
    accountable_owner: record.customer.owners.accountable,
    delivery_lead: record.customer.owners.delivery_lead ?? null,
    presales_lead: record.customer.owners.presales_lead ?? null,
    health,
    counts: {
      commitments_total: record.commitments.length,
      commitments_open: openCommitments.length,
      commitments_past_due: openCommitments.filter((c) => daysUntil(c.due, asOf) < 0).length,
      risks_open: record.risks.filter((r) => r.status !== 'closed').length,
      touchpoints: record.touchpoints.length,
      stakeholders: record.stakeholders?.people.length ?? 0,
    },
    last_contact: last,
    days_since_contact: daysSince(last, asOf),
    cadence_days: cadenceFor(record),
    handoff: gateProgress(record, asOf),
    renewal_on_file: record.renewal !== null,
  };
}

export function buildIndex(records: CustomerRecord[], asOf: Date): CustomerIndex {
  const customers = records
    .map((r) => buildEntry(r, asOf))
    .sort((a, b) => a.name.localeCompare(b.name));

  const totals: PortfolioTotals = {
    customers: customers.length,
    by_band: { green: 0, amber: 0, red: 0 },
    arr_total: 0,
    arr_not_green: 0,
    exceptions_by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
    open_commitments_past_due: 0,
    open_risks: 0,
  };

  for (const c of customers) {
    totals.by_band[c.health.band] += 1;
    totals.arr_total += c.contract.value_annual;
    if (c.health.band !== 'green') totals.arr_not_green += c.contract.value_annual;
    totals.open_commitments_past_due += c.counts.commitments_past_due;
    totals.open_risks += c.counts.risks_open;
    for (const s of c.health.signals) {
      if (s.fired) totals.exceptions_by_severity[s.severity] += 1;
    }
  }

  return {
    schema_version: INDEX_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    as_of: toISODate(asOf),
    totals,
    customers,
  };
}

/**
 * The exception feed is the same rule engine as health scoring, projected
 * differently. There is deliberately no second set of rules to drift out of sync.
 */
export function buildExceptions(index: CustomerIndex, asOf: Date): ExceptionFeed {
  const exceptions: ExceptionRecord[] = [];

  for (const c of index.customers) {
    for (const signal of c.health.signals) {
      if (!signal.fired) continue;
      exceptions.push({
        key: `${c.slug}:${signal.id}`,
        slug: c.slug,
        customer: c.name,
        tier: c.tier,
        lifecycle_stage: c.lifecycle_stage,
        accountable_owner: c.accountable_owner,
        signal: signal.id,
        label: signal.label,
        detail: signal.detail,
        severity: signal.severity,
        points: signal.points,
        since: signal.since,
        // `since` can be a future date (a renewal that has not happened yet), and
        // "how long has this been true" is meaningless for those. Null rather
        // than a negative number, so the UI simply omits the age.
        age_days: signal.since ? nonNegativeAge(signal.since, asOf) : null,
        arr: c.contract.value_annual,
        refs: signal.refs,
      });
    }
  }

  exceptions.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    if (b.points !== a.points) return b.points - a.points;
    if (b.arr !== a.arr) return b.arr - a.arr;
    return (b.age_days ?? 0) - (a.age_days ?? 0);
  });

  return {
    schema_version: INDEX_SCHEMA_VERSION,
    generated_at: index.generated_at,
    as_of: toISODate(asOf),
    count: exceptions.length,
    exceptions,
  };
}

export interface HealthSnapshot {
  date: string;
  totals: Pick<PortfolioTotals, 'customers' | 'by_band' | 'arr_total' | 'arr_not_green'>;
  customers: Array<{ slug: string; score: number; band: Band }>;
}

/** One append-only line per day. Git gives us the time series for free. */
export function buildSnapshot(index: CustomerIndex): HealthSnapshot {
  return {
    date: index.as_of,
    totals: {
      customers: index.totals.customers,
      by_band: index.totals.by_band,
      arr_total: index.totals.arr_total,
      arr_not_green: index.totals.arr_not_green,
    },
    customers: index.customers.map((c) => ({
      slug: c.slug,
      score: c.health.score,
      band: c.health.band,
    })),
  };
}
