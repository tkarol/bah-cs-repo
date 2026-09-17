import { describe, expect, it } from 'vitest';
import { evaluateHealth, bandFor, cadenceFor, lastContactDate } from '../src/health.ts';
import { AS_OF, commitment, handoffItem, record, touchpoint } from './fixtures.ts';

function signal(rec: Parameters<typeof evaluateHealth>[0], id: string) {
  const s = evaluateHealth(rec, AS_OF).signals.find((x) => x.id === id);
  if (!s) throw new Error(`no signal ${id}`);
  return s;
}

describe('bandFor', () => {
  it('maps scores to bands at the documented thresholds', () => {
    expect(bandFor(100)).toBe('green');
    expect(bandFor(75)).toBe('green');
    expect(bandFor(74)).toBe('amber');
    expect(bandFor(45)).toBe('amber');
    expect(bandFor(44)).toBe('red');
    expect(bandFor(0)).toBe('red');
  });
});

describe('contact decay', () => {
  it('stays quiet inside the cadence window', () => {
    const rec = record({ touchpoints: [touchpoint('2026-09-10')] });
    expect(signal(rec, 'contact_decay').fired).toBe(false);
  });

  it('fires once past the tier cadence and escalates weekly', () => {
    const near = record({ touchpoints: [touchpoint('2026-08-30')] }); // 18d, cadence 14
    const far = record({ touchpoints: [touchpoint('2026-06-01')] }); // 108d
    expect(signal(near, 'contact_decay').fired).toBe(true);
    expect(signal(far, 'contact_decay').points).toBeGreaterThan(
      signal(near, 'contact_decay').points,
    );
  });

  it('caps the penalty so one silent account cannot dominate the score', () => {
    const ancient = record({ touchpoints: [touchpoint('2020-01-01')] });
    expect(signal(ancient, 'contact_decay').points).toBe(25);
  });

  it('honours an explicit cadence override', () => {
    const rec = record({ customer: { cadence_days: 90 } as any, touchpoints: [touchpoint('2026-08-01')] });
    expect(cadenceFor(rec)).toBe(90);
    expect(signal(rec, 'contact_decay').fired).toBe(false);
  });

  it('falls back to stage entry when no touchpoint was ever logged', () => {
    const rec = record({ customer: { stage_entered: '2026-09-15' } as any });
    expect(lastContactDate(rec)).toBe('2026-09-15');
    expect(signal(rec, 'contact_decay').fired).toBe(false);
  });
});

describe('past-due commitments', () => {
  it('ignores commitments that are complete or waived', () => {
    const rec = record({
      commitments: [
        commitment({ id: 'a', due: '2026-01-01', status: 'complete', evidence: 'x' }),
        commitment({ id: 'b', due: '2026-01-01', status: 'waived' }),
      ],
    });
    expect(signal(rec, 'past_due_commitments').fired).toBe(false);
  });

  it('does not fire on the due date itself', () => {
    const rec = record({ commitments: [commitment({ due: '2026-09-17' })] });
    expect(signal(rec, 'past_due_commitments').fired).toBe(false);
  });

  it('weights a contractual breach above a best-effort one', () => {
    const contractual = record({ commitments: [commitment({ due: '2026-08-01', severity: 'contractual' })] });
    const best = record({ commitments: [commitment({ due: '2026-08-01', severity: 'best_effort' })] });
    expect(signal(contractual, 'past_due_commitments').points).toBeGreaterThan(
      signal(best, 'past_due_commitments').points,
    );
    expect(signal(contractual, 'past_due_commitments').severity).toBe('critical');
    expect(signal(best, 'past_due_commitments').severity).toBe('high');
  });
});

describe('handoff debt', () => {
  it('is silent when there is no gate', () => {
    expect(signal(record(), 'handoff_debt').fired).toBe(false);
  });

  it('ignores incomplete optional items', () => {
    const rec = record({
      handoff: {
        customer: 'test-co', opened: '2026-01-01', target_completion: '2026-01-22', completed: null,
        items: [handoffItem({ required: false, status: 'incomplete', evidence: null })],
      } as any,
    });
    expect(signal(rec, 'handoff_debt').fired).toBe(false);
  });

  it('fires on an expired waiver — deferral, not deletion', () => {
    const rec = record({
      handoff: {
        customer: 'test-co', opened: '2026-01-01', target_completion: '2026-01-22', completed: null,
        items: [handoffItem({
          status: 'waived', evidence: null,
          waiver: { by: 'b@bah.com', reason: 'r', at: '2026-01-10', review_by: '2026-08-01' },
        })],
      } as any,
    });
    const s = signal(rec, 'handoff_debt');
    expect(s.fired).toBe(true);
    expect(s.detail).toContain('waiver');
  });

  it('stays quiet while a waiver is still within its review window', () => {
    const rec = record({
      handoff: {
        customer: 'test-co', opened: '2026-01-01', target_completion: '2026-01-22', completed: null,
        items: [handoffItem({
          status: 'waived', evidence: null,
          waiver: { by: 'b@bah.com', reason: 'r', at: '2026-01-10', review_by: '2026-12-01' },
        })],
      } as any,
    });
    expect(signal(rec, 'handoff_debt').fired).toBe(false);
  });
});

describe('stage stagnation', () => {
  it('never fires for steady_state, which has no expected exit', () => {
    const rec = record({ customer: { lifecycle_stage: 'steady_state', stage_entered: '2020-01-01' } as any });
    expect(signal(rec, 'stage_stagnation').fired).toBe(false);
  });

  it('escalates once past double the expected band', () => {
    const over = record({ customer: { lifecycle_stage: 'handoff', stage_entered: '2026-08-20' } as any });
    const way = record({ customer: { lifecycle_stage: 'handoff', stage_entered: '2026-06-01' } as any });
    expect(signal(over, 'stage_stagnation').points).toBe(8);
    expect(signal(way, 'stage_stagnation').points).toBe(16);
  });
});

describe('ownership gap', () => {
  it('fires until the receiving owner acknowledges', () => {
    const rec = record({
      customer: { owners: { accountable: 'n@bah.com', transferred_at: '2026-09-01', acknowledged_by_accountable: false } } as any,
    });
    expect(signal(rec, 'ownership_gap').fired).toBe(true);
  });

  it('clears on acknowledgement', () => {
    expect(signal(record(), 'ownership_gap').fired).toBe(false);
  });
});

describe('renewal exposure', () => {
  it('is quiet beyond 180 days', () => {
    const rec = record({ customer: { contract: { value_annual: 1, start: '2026-01-01', end: '2027-06-01' } } as any });
    expect(signal(rec, 'renewal_exposure').fired).toBe(false);
  });

  it('nudges at medium severity in the 90-180 day window', () => {
    const rec = record({ customer: { contract: { value_annual: 1, start: '2026-01-01', end: '2027-01-31' } } as any });
    const s = signal(rec, 'renewal_exposure');
    expect(s.fired).toBe(true);
    expect(s.severity).toBe('medium');
  });

  it('escalates to critical inside 30 days', () => {
    const rec = record({ customer: { contract: { value_annual: 1, start: '2026-01-01', end: '2026-10-01' } } as any });
    expect(signal(rec, 'renewal_exposure').severity).toBe('critical');
  });

  it('clears once a renewal plan is on file', () => {
    const rec = record({
      customer: { contract: { value_annual: 1, start: '2026-01-01', end: '2026-10-01' } } as any,
      renewal: { customer: 'test-co', renewal_date: '2026-10-01', owner: 'a@bah.com', strategy: 's', risk_level: 'low' } as any,
    });
    expect(signal(rec, 'renewal_exposure').fired).toBe(false);
  });

  it('does not chase a churned account', () => {
    const rec = record({
      customer: { lifecycle_stage: 'churned', contract: { value_annual: 1, start: '2026-01-01', end: '2026-10-01' } } as any,
    });
    expect(signal(rec, 'renewal_exposure').fired).toBe(false);
  });
});

describe('scoring', () => {
  it('gives a clean account a perfect score', () => {
    const rec = record({ touchpoints: [touchpoint('2026-09-16')] });
    expect(evaluateHealth(rec, AS_OF).score).toBe(100);
  });

  it('clamps at zero rather than going negative', () => {
    const rec = record({
      customer: { lifecycle_stage: 'handoff', stage_entered: '2025-01-01', owners: { accountable: 'a@bah.com', acknowledged_by_accountable: false } } as any,
      commitments: [
        commitment({ id: 'a', due: '2025-01-01', severity: 'contractual' }),
        commitment({ id: 'b', due: '2025-01-01', severity: 'contractual' }),
      ],
      risks: [{ id: 'r', title: 't', severity: 'critical', opened: '2025-01-01', owner: 'a@bah.com', status: 'open', closed: null }] as any,
    });
    expect(evaluateHealth(rec, AS_OF).score).toBe(0);
  });

  it('always reports every signal, fired or not, so the UI can explain itself', () => {
    expect(evaluateHealth(record(), AS_OF).signals).toHaveLength(7);
  });
});
