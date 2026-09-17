/**
 * Role-based authorization (docs/ARCHITECTURE.md §8).
 *
 * The honest limit of the file model: git has no row-level security, so repo
 * access must be tighter than app access. Everything here is app-layer
 * enforcement — it governs who may write through this API, not who can read
 * the repository.
 */
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { CustomerRecord } from '@cs/core';
import { getFile } from './github.ts';
import type { Env } from './env.ts';

export const ROLES = ['csm', 'presales', 'leadership', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const RolesFileSchema = z.object({
  default_role: z.enum(ROLES).default('csm'),
  users: z
    .array(z.object({ email: z.string().email(), role: z.enum(ROLES) }))
    .default([]),
});

let cache: { map: Map<string, Role>; fallback: Role; fetchedAt: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function roleFor(env: Env, email: string): Promise<Role> {
  if (!cache || Date.now() - cache.fetchedAt > TTL_MS) {
    const file = await getFile(env, 'config/roles.yaml');
    const parsed = RolesFileSchema.safeParse(file ? parseYaml(file.text) : {});
    if (!parsed.success) throw new Error(`config/roles.yaml is invalid: ${parsed.error.message}`);
    cache = {
      map: new Map(parsed.data.users.map((u) => [u.email.toLowerCase(), u.role])),
      fallback: parsed.data.default_role,
      fetchedAt: Date.now(),
    };
  }
  return cache.map.get(email.toLowerCase()) ?? cache.fallback;
}

export type Action =
  | 'read'
  | 'write_customer'
  | 'transition_stage'
  | 'waive_gate_item'
  | 'reassign_ownership'
  | 'create_customer';

export interface Actor {
  email: string;
  role: Role;
}

function owns(actor: Actor, record: CustomerRecord): boolean {
  const o = record.customer.owners;
  return (
    o.accountable.toLowerCase() === actor.email ||
    o.delivery_lead?.toLowerCase() === actor.email ||
    o.presales_lead?.toLowerCase() === actor.email
  );
}

const PRESALES_STAGES = new Set(['prospect', 'presales', 'handoff']);

/** Returns null when permitted, or a reason string when not. */
export function denyReason(
  actor: Actor,
  action: Action,
  record: CustomerRecord | null,
): string | null {
  if (actor.role === 'admin') return null;
  if (action === 'read') return null;

  switch (action) {
    case 'create_customer':
      // Anyone who can sign in can start an account; it is the gate that matters,
      // not the creation.
      return null;

    case 'waive_gate_item':
      return actor.role === 'leadership'
        ? null
        : 'Only leadership may waive a handoff gate item. Ask your lead to record the waiver.';

    case 'reassign_ownership':
      return actor.role === 'leadership'
        ? null
        : 'Only leadership may reassign account ownership.';

    case 'write_customer':
    case 'transition_stage': {
      if (!record) return 'Customer not found.';
      if (actor.role === 'leadership') return null;
      if (owns(actor, record)) return null;
      if (actor.role === 'presales' && PRESALES_STAGES.has(record.customer.lifecycle_stage)) {
        return null;
      }
      return `You do not own ${record.customer.name}. Its accountable owner is ${record.customer.owners.accountable}.`;
    }

    default:
      return 'Unknown action.';
  }
}
