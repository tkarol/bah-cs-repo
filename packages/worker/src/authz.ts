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

export interface RolesFile {
  default_role: Role;
  users: Array<{ email: string; role: Role }>;
}

let cache: { file: RolesFile; fetchedAt: number } | null = null;
const TTL_MS = 60 * 1000;

/** Drops the cached roles so a change through the admin page takes effect at once. */
export function invalidateRoles(): void {
  cache = null;
}

export async function loadRoles(env: Env): Promise<RolesFile> {
  if (cache && Date.now() - cache.fetchedAt <= TTL_MS) return cache.file;
  const file = await getFile(env, 'config/roles.yaml');
  const parsed = RolesFileSchema.safeParse(file ? parseYaml(file.text) : {});
  if (!parsed.success) throw new Error(`config/roles.yaml is invalid: ${parsed.error.message}`);
  cache = { file: parsed.data, fetchedAt: Date.now() };
  return parsed.data;
}

/**
 * True when nobody has been made an admin yet. Until someone is, any signed-in
 * user may manage roles — otherwise the first person to deploy is locked out of
 * the admin page by the very file they need to edit to get in.
 *
 * Access already restricts sign-in to the organisation's own domain, and this
 * closes permanently the moment one admin exists.
 */
export function needsBootstrap(roles: RolesFile): boolean {
  return !roles.users.some((u) => u.role === 'admin');
}

export async function roleFor(env: Env, email: string): Promise<Role> {
  const roles = await loadRoles(env);
  const found = roles.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  return found?.role ?? roles.default_role;
}

export type Action =
  | 'read'
  | 'write_customer'
  | 'transition_stage'
  | 'waive_gate_item'
  | 'reassign_ownership'
  | 'create_customer'
  | 'manage_roles';

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
  options: { bootstrap?: boolean } = {},
): string | null {
  if (actor.role === 'admin') return null;
  if (action === 'read') return null;

  switch (action) {
    case 'manage_roles':
      // See needsBootstrap: open until the first admin exists, closed after.
      return options.bootstrap
        ? null
        : 'Only an admin can manage people and roles. Ask an admin to grant you access.';

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
