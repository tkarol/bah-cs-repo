import { parseDate } from '../dates.ts';

/** Resolves the evaluation date: AS_OF when set (tests, backfills), else today. */
export function resolveAsOf(asOf: string | undefined): Date {
  if (asOf) return parseDate(asOf);
  return parseDate(new Date().toISOString().slice(0, 10));
}
