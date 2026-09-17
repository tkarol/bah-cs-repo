/**
 * Loading a customer from a file tree. Deliberately abstracted behind
 * `FileSource` so the same loader runs against the local filesystem (indexer,
 * CI) and against the GitHub API (Worker) with no duplicated parsing.
 */
import { parse as parseYaml } from 'yaml';
import {
  CustomerSchema,
  CommitmentSchema,
  HandoffSchema,
  RenewalSchema,
  RiskSchema,
  StakeholdersSchema,
  TouchpointSchema,
  type Commitment,
  type Customer,
  type Handoff,
  type Renewal,
  type Risk,
  type Stakeholders,
  type Touchpoint,
} from './schema.ts';

export interface FileSource {
  /** Repo-relative paths of files directly inside `dir` (non-recursive). */
  list(dir: string): Promise<string[]>;
  /** File contents, or null when the file does not exist. */
  read(path: string): Promise<string | null>;
  /** Immediate subdirectory names of `dir`. */
  listDirs(dir: string): Promise<string[]>;
}

export interface CustomerRecord {
  slug: string;
  customer: Customer;
  stakeholders: Stakeholders | null;
  handoff: Handoff | null;
  commitments: Commitment[];
  risks: Risk[];
  renewal: Renewal | null;
  touchpoints: Touchpoint[];
}

export class ValidationError extends Error {
  // Written as explicit fields rather than TS parameter properties: the CLIs run
  // under Node's type stripping, which cannot rewrite parameter properties.
  readonly path: string;
  readonly issues: string[];

  constructor(path: string, issues: string[]) {
    super(`${path}: ${issues.join('; ')}`);
    this.name = 'ValidationError';
    this.path = path;
    this.issues = issues;
  }
}

function parseWith<T>(schema: { safeParse: (v: unknown) => any }, raw: string, path: string): T {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new ValidationError(path, [`invalid YAML: ${(err as Error).message}`]);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      path,
      result.error.issues.map((i: any) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    );
  }
  return result.data as T;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseTouchpoint(raw: string, path: string): Touchpoint {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new ValidationError(path, ['touchpoint must begin with YAML frontmatter']);
  }
  const front = parseWith<any>(TouchpointSchema, match[1]!, path);
  return { ...front, body: (match[2] ?? '').trim(), path };
}

/** Repo-relative directory holding all customer data. */
export const CUSTOMERS_DIR = 'customers';

/** The only shape a customer directory name may take. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Guards every path built from a slug. A slug reaches this from a URL segment,
 * so without this a value like `../../.github/workflows` would let an
 * authenticated user read or write files outside `customers/` — including
 * workflow files, which run with repository write access.
 *
 * Callers validate at their own boundary too; this is the backstop at the layer
 * that actually concatenates the path, so a future caller cannot reintroduce
 * the hole by forgetting.
 */
export function assertSafeSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new ValidationError(`${CUSTOMERS_DIR}/${slug}`, [
      'slug must be lowercase kebab-case; refusing to build a path from it',
    ]);
  }
}

export async function listCustomerSlugs(source: FileSource): Promise<string[]> {
  const dirs = await source.listDirs(CUSTOMERS_DIR);
  return dirs.sort();
}

export async function loadCustomer(source: FileSource, slug: string): Promise<CustomerRecord> {
  assertSafeSlug(slug);
  const base = `${CUSTOMERS_DIR}/${slug}`;

  const customerRaw = await source.read(`${base}/customer.yaml`);
  if (customerRaw === null) {
    throw new ValidationError(`${base}/customer.yaml`, ['missing required file']);
  }
  const customer = parseWith<Customer>(CustomerSchema, customerRaw, `${base}/customer.yaml`);
  if (customer.slug !== slug) {
    throw new ValidationError(`${base}/customer.yaml`, [
      `slug "${customer.slug}" does not match directory name "${slug}"`,
    ]);
  }

  const [stakeholdersRaw, handoffRaw, renewalRaw] = await Promise.all([
    source.read(`${base}/stakeholders.yaml`),
    source.read(`${base}/handoff.yaml`),
    source.read(`${base}/renewal.yaml`),
  ]);

  const commitments = await loadAll<Commitment>(
    source,
    `${base}/commitments`,
    CommitmentSchema,
    '.yaml',
  );
  const risks = await loadAll<Risk>(source, `${base}/risks`, RiskSchema, '.yaml');

  const touchpointPaths = (await source.list(`${base}/touchpoints`)).filter((p) =>
    p.endsWith('.md'),
  );
  const touchpoints: Touchpoint[] = [];
  for (const path of touchpointPaths.sort()) {
    const raw = await source.read(path);
    if (raw !== null) touchpoints.push(parseTouchpoint(raw, path));
  }
  touchpoints.sort((a, b) => b.date.localeCompare(a.date));

  return {
    slug,
    customer,
    stakeholders: stakeholdersRaw
      ? parseWith<Stakeholders>(StakeholdersSchema, stakeholdersRaw, `${base}/stakeholders.yaml`)
      : null,
    handoff: handoffRaw
      ? parseWith<Handoff>(HandoffSchema, handoffRaw, `${base}/handoff.yaml`)
      : null,
    commitments,
    risks,
    renewal: renewalRaw
      ? parseWith<Renewal>(RenewalSchema, renewalRaw, `${base}/renewal.yaml`)
      : null,
    touchpoints,
  };
}

async function loadAll<T>(
  source: FileSource,
  dir: string,
  schema: { safeParse: (v: unknown) => any },
  ext: string,
): Promise<T[]> {
  const paths = (await source.list(dir)).filter((p) => p.endsWith(ext)).sort();
  const out: T[] = [];
  for (const path of paths) {
    const raw = await source.read(path);
    if (raw !== null) out.push(parseWith<T>(schema, raw, path));
  }
  return out;
}

export async function loadAllCustomers(
  source: FileSource,
): Promise<{ records: CustomerRecord[]; errors: ValidationError[] }> {
  const slugs = await listCustomerSlugs(source);
  const records: CustomerRecord[] = [];
  const errors: ValidationError[] = [];
  for (const slug of slugs) {
    try {
      records.push(await loadCustomer(source, slug));
    } catch (err) {
      if (err instanceof ValidationError) errors.push(err);
      else throw err;
    }
  }
  return { records, errors };
}
