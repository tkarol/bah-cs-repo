/**
 * Regenerates index.json and exceptions.json from the customer files, and with
 * --snapshot appends a daily health line to history/health-YYYY-MM.jsonl.
 *
 * Run by .github/workflows/index.yml on push and by sweep.yml nightly. The
 * nightly run matters because most exceptions are time-based (a commitment goes
 * past due, a waiver expires) and fire with no data change at all.
 */
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fsSource } from '../node.ts';
import { loadAllCustomers } from '../load.ts';
import { buildIndex, buildExceptions, buildSnapshot } from '../index-build.ts';
import { resolveAsOf } from './util.ts';

const args = new Set(process.argv.slice(2));
const root = resolve(process.env.REPO_ROOT ?? process.cwd());
const asOf = resolveAsOf(process.env.AS_OF);
const writeSnapshot = args.has('--snapshot');

const source = fsSource(root);
const { records, errors } = await loadAllCustomers(source);

if (errors.length > 0) {
  console.error(`\n${errors.length} customer file(s) failed validation:\n`);
  for (const e of errors) console.error(`  ✗ ${e.message}`);
  console.error('\nIndex not written. Fix the files above and re-run.\n');
  process.exit(1);
}

const index = buildIndex(records, asOf);
const exceptions = buildExceptions(index, asOf);

await writeJson(resolve(root, 'index.json'), index);
await writeJson(resolve(root, 'exceptions.json'), exceptions);

if (writeSnapshot) {
  const snapshot = buildSnapshot(index);
  const file = resolve(root, `history/health-${snapshot.date.slice(0, 7)}.jsonl`);
  await mkdir(dirname(file), { recursive: true });
  // One line per day: re-running the same day replaces rather than duplicates.
  const existing = await readFile(file, 'utf8').catch(() => '');
  const kept = existing
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith(`{"date":"${snapshot.date}"`))
    .join('\n');
  await writeFile(file, kept ? `${kept}\n` : '');
  await appendFile(file, `${JSON.stringify(snapshot)}\n`);
  console.log(`  history/health-${snapshot.date.slice(0, 7)}.jsonl  (snapshot for ${snapshot.date})`);
}

const { by_band } = index.totals;
console.log(
  `\nIndexed ${index.totals.customers} customers as of ${index.as_of}\n` +
    `  green ${by_band.green}  amber ${by_band.amber}  red ${by_band.red}\n` +
    `  ${exceptions.count} open exception(s)\n`,
);

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}
