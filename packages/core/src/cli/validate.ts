/**
 * Schema validation over the whole customer tree. Runs on every PR.
 *
 * This is the discipline that separates "files as a database" from "a folder of
 * YAML that slowly rots". Without it, the storage design in docs/ARCHITECTURE.md
 * should not be used.
 */
import { resolve } from 'node:path';
import { fsSource } from '../node.ts';
import { loadAllCustomers } from '../load.ts';
import { evaluateGate, gateProgress } from '../gate.ts';
import { resolveAsOf } from './util.ts';

const root = resolve(process.env.REPO_ROOT ?? process.cwd());
const asOf = resolveAsOf(process.env.AS_OF);

const { records, errors } = await loadAllCustomers(fsSource(root));

for (const e of errors) console.error(`  ✗ ${e.message}`);

// Cross-file invariants that no single schema can express.
const invariantErrors: string[] = [];
for (const record of records) {
  const base = `customers/${record.slug}`;

  if (record.stakeholders && record.stakeholders.customer !== record.slug) {
    invariantErrors.push(`${base}/stakeholders.yaml: customer field does not match directory`);
  }
  if (record.handoff && record.handoff.customer !== record.slug) {
    invariantErrors.push(`${base}/handoff.yaml: customer field does not match directory`);
  }
  if (record.renewal && record.renewal.customer !== record.slug) {
    invariantErrors.push(`${base}/renewal.yaml: customer field does not match directory`);
  }

  const ids = new Set<string>();
  for (const c of record.commitments) {
    if (ids.has(c.id)) invariantErrors.push(`${base}: duplicate commitment id "${c.id}"`);
    ids.add(c.id);
  }

  if (record.customer.contract.end < record.customer.contract.start) {
    invariantErrors.push(`${base}/customer.yaml: contract.end precedes contract.start`);
  }

  // The gate is enforced at write time by the Worker, which is the only moment
  // it can be enforced. Here it is a warning: an account can legitimately drift
  // into an unmet gate afterwards (a waiver expires, a new required item is added
  // by a template change). That is unhealthy state for the exception feed to
  // surface, not malformed data that should fail CI and block the repo.
  if (record.customer.lifecycle_stage === 'onboarding') {
    const staged = { ...record, customer: { ...record.customer, lifecycle_stage: 'handoff' as const } };
    const gate = evaluateGate(staged, 'onboarding', asOf);
    for (const b of gate.blockers) {
      console.warn(`  ⚠ ${base}: in onboarding with an unmet gate — ${b.message}`);
    }
  }

  const progress = gateProgress(record, asOf);
  if (progress && progress.total > 0 && progress.waiver_rate > 0.3) {
    console.warn(
      `  ⚠ ${base}: ${Math.round(progress.waiver_rate * 100)}% of gate items waived — ` +
        `the checklist may be wrong, not the people (docs §10).`,
    );
  }
}

for (const message of invariantErrors) console.error(`  ✗ ${message}`);

const total = errors.length + invariantErrors.length;
if (total > 0) {
  console.error(`\n${total} validation error(s) across ${records.length} customer(s).\n`);
  process.exit(1);
}
console.log(`\n✓ ${records.length} customer(s) valid.\n`);
