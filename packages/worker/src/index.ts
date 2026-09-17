/**
 * The API. Read paths serve the index (dashboards) or the files (single
 * customer, always fresh). Write paths commit to the repository through a
 * GitHub App, after schema validation and the gate.
 */
import { Hono } from 'hono';
import {
  CommitmentSchema,
  CustomerSchema,
  HandoffSchema,
  RenewalSchema,
  RiskSchema,
  TouchpointSchema,
  evaluateGate,
  evaluateHealth,
  gateProgress,
  loadCustomer,
  parseDate,
  SLUG_PATTERN,
  ValidationError,
  LIFECYCLE_STAGES,
  type Commitment,
  type Customer,
  type Handoff,
  type LifecycleStage,
} from '@cs/core';
import { z } from 'zod';
import { parse as parseYamlText } from 'yaml';
import { AuthError, verifyAccess, type Identity } from './access.ts';
import { denyReason, roleFor, type Actor } from './authz.ts';
import { GitHubError, listCommits } from './github.ts';
import { fileIndexProvider, type IndexProvider } from './index-provider.ts';
import { githubSource } from './source.ts';
import { BadRequest, StaleWrite, validateWith, writeText, writeYaml } from './write.ts';
import type { Env } from './env.ts';

type Vars = { identity: Identity; actor: Actor; index: IndexProvider };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const today = () => parseDate(new Date().toISOString().slice(0, 10));
const addDays = (days: number): string => {
  const d = today();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

class Forbidden extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'Forbidden';
  }
}

app.use('/api/*', async (c, next) => {
  const identity = await verifyAccess(c.req.raw, c.env);
  c.set('identity', identity);
  c.set('actor', { email: identity.email, role: await roleFor(c.env, identity.email) });
  c.set('index', fileIndexProvider(c.env));
  await next();
});

app.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status as 401);
  if (err instanceof Forbidden) return c.json({ error: err.message }, 403);
  if (err instanceof BadRequest) return c.json({ error: err.message, issues: err.issues }, 400);
  if (err instanceof StaleWrite) return c.json({ error: err.message, path: err.path }, 409);
  if (err instanceof ValidationError) {
    return c.json({ error: err.message, path: err.path, issues: err.issues }, 400);
  }
  if (err instanceof GitHubError) {
    console.error('github', err.message);
    return c.json({ error: 'Upstream repository error.' }, 502);
  }
  console.error('unhandled', err);
  return c.json({ error: 'Internal error.' }, 500);
});

/**
 * Reads the :slug URL segment and refuses anything that is not a plain
 * directory name. Every repository path in this file is built by interpolating
 * this value, so it is validated once here rather than at fourteen call sites.
 */
function slugParam(c: { req: { param(name: string): string | undefined } }): string {
  const slug = c.req.param('slug') ?? '';
  if (!SLUG_PATTERN.test(slug)) {
    throw new BadRequest(`"${slug}" is not a valid customer identifier.`);
  }
  return slug;
}

/** Loads the record straight from the files — never the index — so single
 *  customer views and every write decision act on current truth. */
async function load(c: { env: Env }, slug: string) {
  return loadCustomer(githubSource(c.env), slug);
}

function requireAllowed(
  actor: Actor,
  action: Parameters<typeof denyReason>[1],
  record: Parameters<typeof denyReason>[2],
): void {
  const reason = denyReason(actor, action, record);
  if (reason) throw new Forbidden(reason);
}

// ---------------------------------------------------------------- read routes

app.get('/api/me', (c) => {
  const actor = c.get('actor');
  return c.json({ email: actor.email, role: actor.role });
});

app.get('/api/index', async (c) => c.json(await c.get('index').getAll()));

app.get('/api/exceptions', async (c) => {
  const feed = await c.get('index').getExceptions();
  const mine = c.req.query('mine');
  if (mine === '1') {
    const me = c.get('actor').email;
    return c.json({
      ...feed,
      exceptions: feed.exceptions.filter((e) => e.accountable_owner.toLowerCase() === me),
    });
  }
  return c.json(feed);
});

app.get('/api/customers/:slug', async (c) => {
  const record = await load(c, slugParam(c));
  const asOf = today();
  return c.json({
    ...record,
    health: evaluateHealth(record, asOf),
    gate: gateProgress(record, asOf),
    transitions: LIFECYCLE_STAGES.filter((s) => s !== record.customer.lifecycle_stage).map((to) => ({
      to,
      ...evaluateGate(record, to, asOf),
    })),
  });
});

app.get('/api/customers/:slug/history', async (c) => {
  const slug = slugParam(c);
  const path = c.req.query('path') ?? `customers/${slug}`;
  // `startsWith` alone is not containment: "customers/acme/../../.github/x"
  // passes it. Rejecting any traversal segment is what makes it one.
  if (!path.startsWith(`customers/${slug}/`) && path !== `customers/${slug}`) {
    throw new BadRequest('History path must be inside the customer directory.');
  }
  if (path.split('/').includes('..')) {
    throw new BadRequest('History path may not contain path traversal.');
  }
  return c.json({ commits: await listCommits(c.env, path) });
});

// --------------------------------------------------------------- write routes

const CreateCustomerBody = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase kebab-case'),
  name: z.string().min(1),
  tier: z.enum(['strategic', 'growth', 'standard']).default('standard'),
  value_annual: z.number().nonnegative().default(0),
  contract_start: z.string().optional(),
  contract_end: z.string().optional(),
});

app.post('/api/customers', async (c) => {
  const actor = c.get('actor');
  requireAllowed(actor, 'create_customer', null);
  const body = validateWith<z.infer<typeof CreateCustomerBody>>(
    CreateCustomerBody,
    await c.req.json(),
    'Request',
  );

  const source = githubSource(c.env);
  const existing = await source.listDirs('customers');
  if (existing.includes(body.slug)) {
    throw new BadRequest(`A customer with slug "${body.slug}" already exists.`);
  }

  const customer: Customer = validateWith(CustomerSchema, {
    slug: body.slug,
    name: body.name,
    tier: body.tier,
    lifecycle_stage: 'prospect',
    stage_entered: addDays(0),
    contract: {
      value_annual: body.value_annual,
      start: body.contract_start ?? addDays(0),
      end: body.contract_end ?? addDays(365),
    },
    owners: { accountable: actor.email, acknowledged_by_accountable: true },
    attachments: [],
  }, 'Customer');

  await writeYaml<Customer>(c.env, {
    path: `customers/${body.slug}/customer.yaml`,
    mutate: () => customer,
    validate: (v) => validateWith<Customer>(CustomerSchema, v, 'Customer'),
    message: `feat(${body.slug}): create customer ${body.name}`,
    actor: actor.email,
    createIfMissing: true,
  });

  await writeText(c.env, {
    path: `customers/${body.slug}/stakeholders.yaml`,
    text: `customer: ${body.slug}\npeople: []\n`,
    message: `chore(${body.slug}): initialise stakeholders`,
    actor: actor.email,
  });

  return c.json({ slug: body.slug }, 201);
});

const PatchCustomerBody = z.object({
  base_sha: z.string().min(1),
  patch: z.record(z.unknown()),
});

app.patch('/api/customers/:slug', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);
  const body = validateWith<z.infer<typeof PatchCustomerBody>>(
    PatchCustomerBody,
    await c.req.json(),
    'Request',
  );

  // Ownership and stage are not ordinary fields: each has its own route with
  // its own rules, so they must not be patchable here.
  for (const guarded of ['owners', 'lifecycle_stage', 'stage_entered', 'slug']) {
    if (guarded in body.patch) {
      throw new BadRequest(
        `"${guarded}" cannot be changed here. Use the dedicated endpoint so the rule that governs it is applied.`,
      );
    }
  }
  requireAllowed(actor, 'write_customer', record);

  const result = await writeYaml<Customer>(c.env, {
    path: `customers/${slug}/customer.yaml`,
    expectedSha: body.base_sha,
    mutate: (current) => ({ ...current, ...(body.patch as Partial<Customer>) }),
    validate: (v) => validateWith<Customer>(CustomerSchema, v, 'Customer'),
    message: `chore(${slug}): update customer details`,
    actor: actor.email,
  });
  return c.json(result);
});

app.post('/api/customers/:slug/transition', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'transition_stage', record);

  const body = validateWith<{ to: LifecycleStage }>(
    z.object({ to: z.enum(LIFECYCLE_STAGES) }),
    await c.req.json(),
    'Request',
  );

  // The gate. This is the one moment it can be enforced, and it is enforced
  // here rather than in the UI so it cannot be clicked past.
  const gate = evaluateGate(record, body.to, today());
  if (!gate.allowed) {
    return c.json(
      {
        error: `Cannot move ${record.customer.name} to "${body.to}" yet.`,
        blockers: gate.blockers,
      },
      422,
    );
  }

  const result = await writeYaml<Customer>(c.env, {
    path: `customers/${slug}/customer.yaml`,
    mutate: (current) => ({
      ...current,
      lifecycle_stage: body.to,
      stage_entered: addDays(0),
    }),
    validate: (v) => validateWith<Customer>(CustomerSchema, v, 'Customer'),
    message: `feat(${slug}): advance to ${body.to}`,
    actor: actor.email,
  });
  return c.json({ ...result, stage: body.to });
});

const ReassignBody = z.object({
  accountable: z.string().email(),
  delivery_lead: z.string().email().optional(),
});

app.post('/api/customers/:slug/ownership', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  await load(c, slug);
  requireAllowed(actor, 'reassign_ownership', null);
  const body = validateWith<z.infer<typeof ReassignBody>>(ReassignBody, await c.req.json(), 'Request');

  const result = await writeYaml<Customer>(c.env, {
    path: `customers/${slug}/customer.yaml`,
    mutate: (current) => ({
      ...current,
      owners: {
        ...current.owners,
        accountable: body.accountable,
        ...(body.delivery_lead ? { delivery_lead: body.delivery_lead } : {}),
        transferred_at: addDays(0),
        // Invariant P4: a transfer is not finished until the receiving owner
        // acknowledges. Until then the account sits in the exception feed.
        acknowledged_by_accountable: false,
      },
    }),
    validate: (v) => validateWith<Customer>(CustomerSchema, v, 'Customer'),
    message: `feat(${slug}): reassign ownership to ${body.accountable}`,
    actor: actor.email,
  });
  return c.json(result);
});

app.post('/api/customers/:slug/ownership/acknowledge', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);

  if (record.customer.owners.accountable.toLowerCase() !== actor.email) {
    throw new Forbidden('Only the incoming accountable owner can acknowledge the transfer.');
  }

  const result = await writeYaml<Customer>(c.env, {
    path: `customers/${slug}/customer.yaml`,
    mutate: (current) => ({
      ...current,
      owners: { ...current.owners, acknowledged_by_accountable: true },
    }),
    validate: (v) => validateWith<Customer>(CustomerSchema, v, 'Customer'),
    message: `chore(${slug}): ${actor.email} acknowledged ownership`,
    actor: actor.email,
  });
  return c.json(result);
});

// ------------------------------------------------------------- the gate items

const CompleteItemBody = z.object({
  evidence: z.string().min(1, 'evidence is required to complete a gate item (P5)'),
});

app.post('/api/customers/:slug/handoff/:itemId/complete', async (c) => {
  const slug = slugParam(c);
  const itemId = c.req.param('itemId');
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'write_customer', record);
  const body = validateWith<z.infer<typeof CompleteItemBody>>(
    CompleteItemBody,
    await c.req.json(),
    'Request',
  );

  const result = await writeYaml<Handoff>(c.env, {
    path: `customers/${slug}/handoff.yaml`,
    mutate: (current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: 'complete' as const,
              evidence: body.evidence,
              completed_by: actor.email,
              completed_at: addDays(0),
              // Completing supersedes any waiver that was standing in for it.
              waiver: undefined,
            }
          : item,
      ),
    }),
    validate: (v) => validateWith<Handoff>(HandoffSchema, v, 'Handoff'),
    message: `chore(${slug}): complete gate item ${itemId}`,
    actor: actor.email,
  });
  return c.json(result);
});

const WaiveItemBody = z.object({
  reason: z.string().min(10, 'a waiver needs a reason someone else can evaluate'),
  review_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

app.post('/api/customers/:slug/handoff/:itemId/waive', async (c) => {
  const slug = slugParam(c);
  const itemId = c.req.param('itemId');
  const actor = c.get('actor');
  const record = await load(c, slug);
  // Waiving is a leadership act by design: the gate's job is to make skipping
  // visible and accountable, not impossible.
  requireAllowed(actor, 'waive_gate_item', record);
  const body = validateWith<z.infer<typeof WaiveItemBody>>(WaiveItemBody, await c.req.json(), 'Request');

  if (body.review_by <= addDays(0)) {
    throw new BadRequest('review_by must be in the future — a waiver is a deferral, not a deletion.');
  }

  const result = await writeYaml<Handoff>(c.env, {
    path: `customers/${slug}/handoff.yaml`,
    mutate: (current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: 'waived' as const,
              waiver: { by: actor.email, reason: body.reason, at: addDays(0), review_by: body.review_by },
            }
          : item,
      ),
    }),
    validate: (v) => validateWith<Handoff>(HandoffSchema, v, 'Handoff'),
    message: `chore(${slug}): waive gate item ${itemId} until ${body.review_by}`,
    actor: actor.email,
  });
  return c.json(result);
});

app.post('/api/customers/:slug/handoff', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'write_customer', record);
  if (record.handoff) throw new BadRequest('A handoff gate is already open for this customer.');

  const source = githubSource(c.env);
  const template = await source.read('templates/customer/handoff.template.yaml');
  if (!template) throw new BadRequest('Handoff template is missing from the repository.');

  const text = template
    .replaceAll('{{slug}}', slug)
    .replaceAll('{{today}}', addDays(0))
    .replaceAll('{{today_plus_21}}', addDays(21));

  const result = await writeYaml<Handoff>(c.env, {
    path: `customers/${slug}/handoff.yaml`,
    mutate: () => validateWith<Handoff>(HandoffSchema, parseYamlText(text), 'Handoff'),
    validate: (v) => validateWith<Handoff>(HandoffSchema, v, 'Handoff'),
    message: `feat(${slug}): open handoff gate`,
    actor: actor.email,
    createIfMissing: true,
  });
  return c.json(result, 201);
});

// ------------------------------------------------------------- commitments

const NewCommitmentBody = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  origin: z.enum(['presales', 'onboarding', 'steady_state', 'renewal']),
  origin_ref: z.string().nullish(),
  made_to: z.string().nullish(),
  owner: z.string().email(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  severity: z.enum(['contractual', 'committed', 'best_effort']),
});

app.post('/api/customers/:slug/commitments', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'write_customer', record);
  const body = validateWith<z.infer<typeof NewCommitmentBody>>(
    NewCommitmentBody,
    await c.req.json(),
    'Request',
  );

  if (record.commitments.some((x) => x.id === body.id)) {
    throw new BadRequest(`A commitment with id "${body.id}" already exists for this customer.`);
  }

  const commitment = validateWith<Commitment>(
    CommitmentSchema,
    {
      ...body,
      made_by: actor.email,
      status: 'not_started',
      evidence: null,
      // A promise recorded before the handoff still has to be accepted at it.
      accepted_at_handoff: false,
    },
    'Commitment',
  );

  const result = await writeYaml<Commitment>(c.env, {
    path: `customers/${slug}/commitments/${body.id}.yaml`,
    mutate: () => commitment,
    validate: (v) => validateWith<Commitment>(CommitmentSchema, v, 'Commitment'),
    message: `feat(${slug}): record commitment "${body.title}"`,
    actor: actor.email,
    createIfMissing: true,
  });
  return c.json(result, 201);
});

const UpdateCommitmentBody = z.object({
  status: z.enum(['not_started', 'in_progress', 'blocked', 'complete', 'waived']).optional(),
  evidence: z.string().min(1).nullish(),
  owner: z.string().email().optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  accepted_at_handoff: z.boolean().optional(),
});

app.patch('/api/customers/:slug/commitments/:id', async (c) => {
  const slug = slugParam(c);
  const id = c.req.param('id');
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'write_customer', record);
  const body = validateWith<z.infer<typeof UpdateCommitmentBody>>(
    UpdateCommitmentBody,
    await c.req.json(),
    'Request',
  );

  const result = await writeYaml<Commitment>(c.env, {
    path: `customers/${slug}/commitments/${id}.yaml`,
    mutate: (current) => ({ ...current, ...stripUndefined(body) }),
    // CommitmentSchema refuses status:complete without evidence, so P5 is
    // enforced here by the same rule that enforces it in CI.
    validate: (v) => validateWith<Commitment>(CommitmentSchema, v, 'Commitment'),
    message: `chore(${slug}): update commitment ${id}`,
    actor: actor.email,
  });
  return c.json(result);
});

// ------------------------------------------------------------- touchpoints

const TouchpointBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['qbr', 'check_in', 'escalation', 'kickoff', 'technical', 'exec']),
  summary: z.string().min(1),
  attendees_internal: z.array(z.string().email()).default([]),
  attendees_customer: z.array(z.string()).default([]),
  body: z.string().default(''),
});

app.post('/api/customers/:slug/touchpoints', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'write_customer', record);
  const body = validateWith<z.infer<typeof TouchpointBody>>(TouchpointBody, await c.req.json(), 'Request');

  const { body: markdown, ...front } = body;
  validateWith(TouchpointSchema, front, 'Touchpoint');

  const path = `customers/${slug}/touchpoints/${body.date}-${body.type.replace('_', '-')}.md`;
  const text =
    `---\n` +
    `date: ${front.date}\n` +
    `type: ${front.type}\n` +
    `attendees_internal:\n${front.attendees_internal.map((a) => `  - ${a}`).join('\n') || '  []'}\n` +
    `attendees_customer:\n${front.attendees_customer.map((a) => `  - ${a}`).join('\n') || '  []'}\n` +
    `summary: ${JSON.stringify(front.summary)}\n` +
    `---\n\n${markdown}\n`;

  const result = await writeText(c.env, {
    path,
    text,
    message: `docs(${slug}): log ${body.type} touchpoint ${body.date}`,
    actor: actor.email,
    mustNotExist: true,
  });
  return c.json({ ...result, path }, 201);
});

// ------------------------------------------------------------- risks, renewal

const NewRiskBody = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  owner: z.string().email(),
  mitigation: z.string().nullish(),
});

app.post('/api/customers/:slug/risks', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'write_customer', record);
  const body = validateWith<z.infer<typeof NewRiskBody>>(NewRiskBody, await c.req.json(), 'Request');

  const result = await writeYaml(c.env, {
    path: `customers/${slug}/risks/${body.id}.yaml`,
    mutate: () => ({ ...body, opened: addDays(0), status: 'open' as const, closed: null }),
    validate: (v) => validateWith(RiskSchema, v, 'Risk'),
    message: `feat(${slug}): record risk "${body.title}"`,
    actor: actor.email,
    createIfMissing: true,
  });
  return c.json(result, 201);
});

const RenewalBody = z.object({
  renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  owner: z.string().email(),
  strategy: z.string().min(1),
  risk_level: z.enum(['low', 'medium', 'high']),
  expansion_target: z.number().nonnegative().nullish(),
  next_step: z.string().nullish(),
  next_step_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

app.put('/api/customers/:slug/renewal', async (c) => {
  const slug = slugParam(c);
  const actor = c.get('actor');
  const record = await load(c, slug);
  requireAllowed(actor, 'write_customer', record);
  const body = validateWith<z.infer<typeof RenewalBody>>(RenewalBody, await c.req.json(), 'Request');

  const result = await writeYaml(c.env, {
    path: `customers/${slug}/renewal.yaml`,
    mutate: () => ({ customer: slug, ...body }),
    validate: (v) => validateWith(RenewalSchema, v, 'Renewal'),
    message: `feat(${slug}): record renewal plan`,
    actor: actor.email,
    createIfMissing: true,
  });
  return c.json(result);
});

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}



/**
 * Anything that is not /api/* is the SPA. In the deployed Worker this rarely
 * runs — `run_worker_first` only routes /api/* here — but it keeps the Worker
 * correct if that config is ever widened, and makes `wrangler dev` serve the
 * built app on its own.
 */
app.all('*', async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
