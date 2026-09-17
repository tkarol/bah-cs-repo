import { describe, expect, it } from 'vitest';
import { buildIndex, buildExceptions, buildSnapshot } from '../src/index-build.ts';
import { AS_OF, commitment, record, touchpoint } from './fixtures.ts';

const records = () => [
  record({ slug: 'alpha', customer: { slug: 'alpha', name: 'Alpha' } as any, touchpoints: [touchpoint('2026-09-16')] }),
  record({
    slug: 'beta',
    customer: { slug: 'beta', name: 'Beta', contract: { value_annual: 500_000, start: '2026-01-01', end: '2027-12-31' } } as any,
    commitments: [commitment({ id: 'late', due: '2026-01-01', severity: 'contractual' })],
  }),
];

describe('index determinism', () => {
  it('produces byte-identical output for the same data and date', () => {
    // Regression guard: a wall-clock field here would make the committed index
    // differ from a fresh rebuild on every run, failing the CI staleness check
    // on every PR and committing a no-op from the nightly sweep every night.
    const a = JSON.stringify(buildIndex(records(), AS_OF));
    const b = JSON.stringify(buildIndex(records(), AS_OF));
    expect(a).toBe(b);
  });

  it('carries no wall-clock timestamp anywhere in the index', () => {
    const json = JSON.stringify(buildIndex(records(), AS_OF));
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('produces byte-identical exception feeds too', () => {
    const feed = () => JSON.stringify(buildExceptions(buildIndex(records(), AS_OF), AS_OF));
    expect(feed()).toBe(feed());
  });
});

describe('buildIndex', () => {
  it('sorts customers by name so diffs stay reviewable', () => {
    const index = buildIndex([...records()].reverse(), AS_OF);
    expect(index.customers.map((c) => c.name)).toEqual(['Alpha', 'Beta']);
  });

  it('totals ARR and separates what is not green', () => {
    const index = buildIndex(records(), AS_OF);
    expect(index.totals.customers).toBe(2);
    expect(index.totals.arr_total).toBe(1_500_000);
    // Beta has a past-due contractual commitment, so it cannot be green.
    expect(index.totals.arr_not_green).toBe(500_000);
  });

  it('counts past-due commitments across the portfolio', () => {
    expect(buildIndex(records(), AS_OF).totals.open_commitments_past_due).toBe(1);
  });
});

describe('buildExceptions', () => {
  it('emits one exception per fired signal and ranks the worst first', () => {
    const feed = buildExceptions(buildIndex(records(), AS_OF), AS_OF);
    expect(feed.count).toBeGreaterThan(0);
    expect(feed.exceptions[0]!.severity).toBe('critical');
    expect(feed.exceptions.every((e) => e.key.includes(':'))).toBe(true);
  });

  it('gives every exception a stable key so the UI can track it across rebuilds', () => {
    const keys = () => buildExceptions(buildIndex(records(), AS_OF), AS_OF).exceptions.map((e) => e.key);
    expect(keys()).toEqual(keys());
    expect(new Set(keys()).size).toBe(keys().length);
  });

  it('omits an age for a condition dated in the future', () => {
    // A renewal date has not happened yet; "how long has this been true" is
    // meaningless for it, so the age is null rather than negative.
    const feed = buildExceptions(buildIndex(records(), AS_OF), AS_OF);
    for (const e of feed.exceptions) {
      if (e.age_days !== null) expect(e.age_days).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('buildSnapshot', () => {
  it('records one line per day with each account score', () => {
    const snap = buildSnapshot(buildIndex(records(), AS_OF));
    expect(snap.date).toBe('2026-09-17');
    expect(snap.customers).toHaveLength(2);
    expect(snap.customers[0]).toHaveProperty('band');
  });
});
