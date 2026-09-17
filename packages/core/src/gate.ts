/**
 * The handoff gate. Invariant P3: the transition into onboarding is blocking,
 * with waivers as a logged, expiring escape hatch rather than a way to skip.
 *
 * This is the highest-leverage rule in the system — it is the moment where
 * pre-sales promises are either carried forward or lost.
 */
import { daysUntil } from './dates.ts';
import type { LifecycleStage } from './schema.ts';
import type { CustomerRecord } from './load.ts';

/** Legal stage moves. Anything not listed is rejected outright. */
export const ALLOWED_TRANSITIONS: Record<LifecycleStage, readonly LifecycleStage[]> = {
  prospect: ['presales', 'churned'],
  presales: ['handoff', 'churned'],
  handoff: ['onboarding', 'churned'],
  onboarding: ['steady_state', 'at_risk', 'churned'],
  steady_state: ['renewal', 'at_risk', 'churned'],
  renewal: ['steady_state', 'at_risk', 'churned'],
  at_risk: ['steady_state', 'renewal', 'churned'],
  // Win-back re-enters the pipeline rather than resurrecting old state.
  churned: ['presales'],
};

export interface Blocker {
  code:
    | 'illegal_transition'
    | 'handoff_missing'
    | 'handoff_item_incomplete'
    | 'handoff_waiver_expired'
    | 'commitment_not_accepted';
  message: string;
  ref?: string;
}

export interface GateResult {
  allowed: boolean;
  blockers: Blocker[];
}

/** Stages that require a cleared handoff gate to enter. */
const GATED_STAGES: ReadonlySet<LifecycleStage> = new Set<LifecycleStage>(['onboarding']);

export function evaluateGate(
  record: CustomerRecord,
  to: LifecycleStage,
  asOf: Date,
): GateResult {
  const from = record.customer.lifecycle_stage;
  const blockers: Blocker[] = [];

  if (from === to) {
    return { allowed: false, blockers: [{ code: 'illegal_transition', message: `Already in "${to}".` }] };
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    blockers.push({
      code: 'illegal_transition',
      message: `"${from}" cannot move directly to "${to}". Allowed: ${ALLOWED_TRANSITIONS[from].join(', ')}.`,
    });
    // An illegal move is fatal on its own; gate detail would only be noise.
    return { allowed: false, blockers };
  }

  if (!GATED_STAGES.has(to)) return { allowed: true, blockers: [] };

  const handoffRef = `customers/${record.slug}/handoff.yaml`;
  const handoff = record.handoff;
  if (!handoff) {
    blockers.push({
      code: 'handoff_missing',
      message: 'No handoff gate exists. Open one before entering onboarding.',
      ref: handoffRef,
    });
    return { allowed: false, blockers };
  }

  for (const item of handoff.items) {
    if (item.required && item.status === 'incomplete') {
      blockers.push({
        code: 'handoff_item_incomplete',
        message: `Required item not complete: "${item.title}".`,
        ref: handoffRef,
      });
    }
    if (item.status === 'waived' && item.waiver && daysUntil(item.waiver.review_by, asOf) < 0) {
      blockers.push({
        code: 'handoff_waiver_expired',
        message: `Waiver for "${item.title}" expired ${item.waiver.review_by}; re-waive or complete it.`,
        ref: handoffRef,
      });
    }
  }

  // Every promise made during the sale must be explicitly carried or dropped.
  for (const c of record.commitments) {
    if (c.origin !== 'presales') continue;
    if (c.status === 'complete' || c.status === 'waived') continue;
    if (!c.accepted_at_handoff) {
      blockers.push({
        code: 'commitment_not_accepted',
        message: `Pre-sales commitment "${c.title}" has not been accepted by the delivery owner.`,
        ref: `customers/${record.slug}/commitments/${c.id}.yaml`,
      });
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

export interface GateProgress {
  total: number;
  complete: number;
  waived: number;
  required_incomplete: number;
  expired_waivers: number;
  /** Share of items waived rather than done — docs §10 flags >30% as a sign the checklist is wrong. */
  waiver_rate: number;
}

export function gateProgress(record: CustomerRecord, asOf: Date): GateProgress | null {
  const handoff = record.handoff;
  if (!handoff) return null;
  const total = handoff.items.length;
  const complete = handoff.items.filter((i) => i.status === 'complete').length;
  const waived = handoff.items.filter((i) => i.status === 'waived').length;
  return {
    total,
    complete,
    waived,
    required_incomplete: handoff.items.filter((i) => i.required && i.status === 'incomplete').length,
    expired_waivers: handoff.items.filter(
      (i) => i.status === 'waived' && i.waiver && daysUntil(i.waiver.review_by, asOf) < 0,
    ).length,
    waiver_rate: total === 0 ? 0 : waived / total,
  };
}
