import { describe, expect, it } from 'vitest';
import { evaluateGate, gateProgress, ALLOWED_TRANSITIONS } from '../src/gate.ts';
import { AS_OF, commitment, handoffItem, record } from './fixtures.ts';

function handoff(items: any[]) {
  return {
    customer: 'test-co',
    opened: '2026-07-01',
    target_completion: '2026-07-22',
    completed: null,
    items,
  } as any;
}

const clearGate = [
  handoffItem({ id: 'a' }),
  handoffItem({ id: 'b' }),
];

describe('transition legality', () => {
  it('rejects a move to the stage it is already in', () => {
    const rec = record({ customer: { lifecycle_stage: 'handoff' } as any });
    const res = evaluateGate(rec, 'handoff', AS_OF);
    expect(res.allowed).toBe(false);
    expect(res.blockers[0]!.code).toBe('illegal_transition');
  });

  it('rejects skipping the handoff stage entirely', () => {
    const rec = record({ customer: { lifecycle_stage: 'presales' } as any });
    const res = evaluateGate(rec, 'onboarding', AS_OF);
    expect(res.allowed).toBe(false);
    expect(res.blockers[0]!.code).toBe('illegal_transition');
  });

  it('does not bury an illegal move under gate detail', () => {
    const rec = record({ customer: { lifecycle_stage: 'prospect' } as any });
    expect(evaluateGate(rec, 'onboarding', AS_OF).blockers).toHaveLength(1);
  });

  it('allows ungated moves without inspecting the gate', () => {
    const rec = record({ customer: { lifecycle_stage: 'onboarding' } as any });
    expect(evaluateGate(rec, 'steady_state', AS_OF).allowed).toBe(true);
  });

  it('permits win-back out of churned', () => {
    expect(ALLOWED_TRANSITIONS.churned).toContain('presales');
  });
});

describe('the gate into onboarding', () => {
  const inHandoff = (over: any = {}) =>
    record({ customer: { lifecycle_stage: 'handoff' } as any, ...over });

  it('blocks when no gate has been opened at all', () => {
    const res = evaluateGate(inHandoff(), 'onboarding', AS_OF);
    expect(res.allowed).toBe(false);
    expect(res.blockers[0]!.code).toBe('handoff_missing');
  });

  it('passes a fully complete gate', () => {
    const res = evaluateGate(inHandoff({ handoff: handoff(clearGate) }), 'onboarding', AS_OF);
    expect(res.allowed).toBe(true);
  });

  it('blocks on an incomplete required item', () => {
    const rec = inHandoff({
      handoff: handoff([handoffItem({ status: 'incomplete', evidence: null })]),
    });
    const res = evaluateGate(rec, 'onboarding', AS_OF);
    expect(res.allowed).toBe(false);
    expect(res.blockers.map((b) => b.code)).toContain('handoff_item_incomplete');
  });

  it('lets an incomplete optional item through', () => {
    const rec = inHandoff({
      handoff: handoff([handoffItem({ required: false, status: 'incomplete', evidence: null })]),
    });
    expect(evaluateGate(rec, 'onboarding', AS_OF).allowed).toBe(true);
  });

  it('accepts a live waiver — the escape hatch has to actually work', () => {
    const rec = inHandoff({
      handoff: handoff([handoffItem({
        status: 'waived', evidence: null,
        waiver: { by: 'b@bah.com', reason: 'sponsor on leave', at: '2026-07-10', review_by: '2026-12-01' },
      })]),
    });
    expect(evaluateGate(rec, 'onboarding', AS_OF).allowed).toBe(true);
  });

  it('blocks on an expired waiver', () => {
    const rec = inHandoff({
      handoff: handoff([handoffItem({
        status: 'waived', evidence: null,
        waiver: { by: 'b@bah.com', reason: 'r', at: '2026-07-10', review_by: '2026-08-01' },
      })]),
    });
    const res = evaluateGate(rec, 'onboarding', AS_OF);
    expect(res.allowed).toBe(false);
    expect(res.blockers.map((b) => b.code)).toContain('handoff_waiver_expired');
  });

  it('blocks when a pre-sales promise was never accepted by delivery', () => {
    const rec = inHandoff({
      handoff: handoff(clearGate),
      commitments: [commitment({ origin: 'presales', accepted_at_handoff: false })],
    });
    const res = evaluateGate(rec, 'onboarding', AS_OF);
    expect(res.allowed).toBe(false);
    expect(res.blockers.map((b) => b.code)).toContain('commitment_not_accepted');
  });

  it('does not demand acceptance of promises made after the sale', () => {
    const rec = inHandoff({
      handoff: handoff(clearGate),
      commitments: [commitment({ origin: 'onboarding', accepted_at_handoff: false })],
    });
    expect(evaluateGate(rec, 'onboarding', AS_OF).allowed).toBe(true);
  });

  it('does not demand acceptance of a pre-sales promise already closed out', () => {
    const rec = inHandoff({
      handoff: handoff(clearGate),
      commitments: [
        commitment({ id: 'x', origin: 'presales', status: 'complete', evidence: 'e', accepted_at_handoff: false }),
        commitment({ id: 'y', origin: 'presales', status: 'waived', accepted_at_handoff: false }),
      ],
    });
    expect(evaluateGate(rec, 'onboarding', AS_OF).allowed).toBe(true);
  });

  it('reports every blocker at once rather than one at a time', () => {
    const rec = inHandoff({
      handoff: handoff([
        handoffItem({ id: 'a', status: 'incomplete', evidence: null }),
        handoffItem({ id: 'b', status: 'incomplete', evidence: null }),
      ]),
      commitments: [commitment({ origin: 'presales', accepted_at_handoff: false })],
    });
    expect(evaluateGate(rec, 'onboarding', AS_OF).blockers).toHaveLength(3);
  });
});

describe('gateProgress', () => {
  it('is null when no gate exists', () => {
    expect(gateProgress(record(), AS_OF)).toBeNull();
  });

  it('surfaces the waiver rate that signals a wrong checklist', () => {
    const rec = record({
      handoff: handoff([
        handoffItem({ id: 'a' }),
        handoffItem({ id: 'b', status: 'waived', evidence: null,
          waiver: { by: 'b@bah.com', reason: 'r', at: '2026-07-10', review_by: '2026-12-01' } }),
      ]),
    });
    const p = gateProgress(rec, AS_OF)!;
    expect(p.waiver_rate).toBe(0.5);
    expect(p.expired_waivers).toBe(0);
    expect(p.complete).toBe(1);
  });
});
