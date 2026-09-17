/** Emits JSON Schema into schemas/ so anyone hand-editing YAML gets completion
 *  and validation in their editor, from the same Zod definitions the app uses. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CustomerSchema,
  CommitmentSchema,
  HandoffSchema,
  RenewalSchema,
  RiskSchema,
  StakeholdersSchema,
  TouchpointSchema,
} from '../schema.ts';

const root = resolve(process.env.REPO_ROOT ?? process.cwd());
const out = resolve(root, 'schemas');
await mkdir(out, { recursive: true });

const schemas = {
  customer: CustomerSchema,
  commitment: CommitmentSchema,
  handoff: HandoffSchema,
  renewal: RenewalSchema,
  risk: RiskSchema,
  stakeholders: StakeholdersSchema,
  touchpoint: TouchpointSchema,
} as const;

for (const [name, schema] of Object.entries(schemas)) {
  const json = zodToJsonSchema(schema, { name, $refStrategy: 'none' });
  await writeFile(resolve(out, `${name}.schema.json`), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`  schemas/${name}.schema.json`);
}
