/** All date math is UTC and day-granular. Never uses the ambient clock: every
 *  caller passes `asOf`, which is what makes health scoring deterministic and
 *  testable. */

export function parseDate(iso: string): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${iso}`);
  return d;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const MS_PER_DAY = 86_400_000;

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === 'string' ? parseDate(from) : from;
  const b = typeof to === 'string' ? parseDate(to) : to;
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Days elapsed since `iso`, relative to `asOf`. */
export function daysSince(iso: string, asOf: Date): number {
  return daysBetween(iso, asOf);
}

/** Days remaining until `iso`. Negative once past. */
export function daysUntil(iso: string, asOf: Date): number {
  return daysBetween(asOf, iso);
}
