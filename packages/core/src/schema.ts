/**
 * Domain schemas. These are the single definition of the data model: they
 * validate writes in the Worker, validate the tree in CI, and are emitted as
 * JSON Schema into `schemas/` so hand-editors get completion in their editor.
 */
import { z } from 'zod';

export const LIFECYCLE_STAGES = [
  'prospect',
  'presales',
  'handoff',
  'onboarding',
  'steady_state',
  'renewal',
  'at_risk',
  'churned',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const TIERS = ['strategic', 'growth', 'standard'] as const;
export type Tier = (typeof TIERS)[number];

/** Default touchpoint expectation per tier, overridable per customer. */
export const TIER_CADENCE_DAYS: Record<Tier, number> = {
  strategic: 14,
  growth: 30,
  standard: 60,
};

/**
 * How long an account may sit in a stage before it counts as stagnant.
 * `null` means the stage has no expected exit (steady_state is where healthy
 * accounts live; churned is terminal).
 */
export const STAGE_EXPECTED_DAYS: Record<LifecycleStage, number | null> = {
  prospect: 90,
  presales: 120,
  handoff: 21,
  onboarding: 90,
  steady_state: null,
  renewal: 120,
  at_risk: 60,
  churned: null,
};

const email = z.string().email();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)');
const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase kebab-case');

/** A pointer to a document that lives in its system of record, not in git. */
export const AttachmentSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  added: isoDate,
});

export const CustomerSchema = z.object({
  slug,
  name: z.string().min(1),
  tier: z.enum(TIERS),
  lifecycle_stage: z.enum(LIFECYCLE_STAGES),
  stage_entered: isoDate,
  contract: z.object({
    value_annual: z.number().nonnegative(),
    start: isoDate,
    end: isoDate,
    vehicle: z.string().nullish(),
  }),
  owners: z.object({
    /** Exactly one accountable owner, always. Invariant P4. */
    accountable: email,
    presales_lead: email.optional(),
    delivery_lead: email.optional(),
    transferred_at: isoDate.optional(),
    acknowledged_by_accountable: z.boolean().default(true),
  }),
  /** Overrides the tier default when set. */
  cadence_days: z.number().int().positive().optional(),
  attachments: z.array(AttachmentSchema).default([]),
  notes: z.string().nullish(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const COMMITMENT_SEVERITIES = ['contractual', 'committed', 'best_effort'] as const;
export const COMMITMENT_STATUSES = [
  'not_started',
  'in_progress',
  'blocked',
  'complete',
  'waived',
] as const;

export const CommitmentSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    /** Where the promise was made. `presales` is the crack this system closes. */
    origin: z.enum(['presales', 'onboarding', 'steady_state', 'renewal']),
    origin_ref: z.string().nullish(),
    made_by: email,
    made_to: z.string().nullish(),
    owner: email,
    due: isoDate,
    severity: z.enum(COMMITMENT_SEVERITIES),
    status: z.enum(COMMITMENT_STATUSES),
    /** Invariant P5: completion requires evidence, enforced below. */
    evidence: z.string().min(1).nullable().default(null),
    /** Set when the delivery owner accepts this at handoff. */
    accepted_at_handoff: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    if (c.status === 'complete' && !c.evidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence'],
        message: 'evidence is required to mark a commitment complete (P5)',
      });
    }
  });
export type Commitment = z.infer<typeof CommitmentSchema>;

export const WaiverSchema = z.object({
  by: email,
  reason: z.string().min(1),
  at: isoDate,
  /** The date this waiver returns to the exception feed. Deferral, not deletion. */
  review_by: isoDate,
});
export type Waiver = z.infer<typeof WaiverSchema>;

export const HandoffItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    required: z.boolean().default(true),
    status: z.enum(['incomplete', 'complete', 'waived']),
    evidence: z.string().min(1).nullable().default(null),
    completed_by: email.nullish(),
    completed_at: isoDate.nullish(),
    waiver: WaiverSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (item.status === 'complete' && !item.evidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence'],
        message: 'evidence is required to complete a handoff item (P5)',
      });
    }
    if (item.status === 'waived' && !item.waiver) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['waiver'],
        message: 'a waived item requires a waiver with a review_by date',
      });
    }
  });
export type HandoffItem = z.infer<typeof HandoffItemSchema>;

export const HandoffSchema = z.object({
  customer: slug,
  opened: isoDate,
  target_completion: isoDate,
  completed: isoDate.nullable().default(null),
  items: z.array(HandoffItemSchema),
});
export type Handoff = z.infer<typeof HandoffSchema>;

export const RISK_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export const RiskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: z.enum(RISK_SEVERITIES),
  opened: isoDate,
  owner: email,
  status: z.enum(['open', 'mitigating', 'closed']),
  closed: isoDate.nullable().default(null),
  mitigation: z.string().nullish(),
});
export type Risk = z.infer<typeof RiskSchema>;

export const StakeholderSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  email: email.nullish(),
  influence: z.enum(['economic_buyer', 'champion', 'user', 'blocker', 'unknown']),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'unknown']).default('unknown'),
  last_contact: isoDate.nullable().default(null),
});

export const StakeholdersSchema = z.object({
  customer: slug,
  people: z.array(StakeholderSchema),
});
export type Stakeholders = z.infer<typeof StakeholdersSchema>;

export const RenewalSchema = z.object({
  customer: slug,
  renewal_date: isoDate,
  owner: email,
  strategy: z.string().min(1),
  risk_level: z.enum(['low', 'medium', 'high']),
  expansion_target: z.number().nonnegative().nullish(),
  next_step: z.string().nullish(),
  next_step_due: isoDate.nullish(),
});
export type Renewal = z.infer<typeof RenewalSchema>;

/** YAML frontmatter of a touchpoint markdown file. */
export const TouchpointSchema = z.object({
  date: isoDate,
  type: z.enum(['qbr', 'check_in', 'escalation', 'kickoff', 'technical', 'exec']),
  attendees_internal: z.array(email).default([]),
  attendees_customer: z.array(z.string()).default([]),
  summary: z.string().min(1),
});
export type Touchpoint = z.infer<typeof TouchpointSchema> & { body: string; path: string };
