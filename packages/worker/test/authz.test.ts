import { describe, expect, it } from 'vitest';
import { denyReason, needsBootstrap, type Actor } from '../src/authz.ts';
import type { CustomerRecord } from '@cs/core';

const actor = (role: Actor['role'], email = 'me@bah.com'): Actor => ({ email, role });

function rec(over: { stage?: string; accountable?: string; delivery?: string; presales?: string } = {}) {
  return {
    slug: 'acme',
    customer: {
      name: 'Acme',
      lifecycle_stage: over.stage ?? 'steady_state',
      owners: {
        accountable: over.accountable ?? 'owner@bah.com',
        delivery_lead: over.delivery,
        presales_lead: over.presales,
      },
    },
  } as unknown as CustomerRecord;
}

describe('admin', () => {
  it('is permitted everything', () => {
    for (const action of ['write_customer', 'waive_gate_item', 'reassign_ownership'] as const) {
      expect(denyReason(actor('admin'), action, rec())).toBeNull();
    }
  });
});

describe('reading', () => {
  it('is open to every role — the constraint is on writes', () => {
    for (const role of ['csm', 'presales', 'leadership'] as const) {
      expect(denyReason(actor(role), 'read', rec())).toBeNull();
    }
  });
});

describe('writing a customer', () => {
  it('is allowed for the accountable owner', () => {
    expect(denyReason(actor('csm'), 'write_customer', rec({ accountable: 'me@bah.com' }))).toBeNull();
  });

  it('is allowed for the delivery lead', () => {
    expect(denyReason(actor('csm'), 'write_customer', rec({ delivery: 'me@bah.com' }))).toBeNull();
  });

  it('is refused for a CSM who does not own the account', () => {
    const reason = denyReason(actor('csm'), 'write_customer', rec());
    expect(reason).toContain('do not own');
    // The refusal names who to go to, rather than just saying no.
    expect(reason).toContain('owner@bah.com');
  });

  it('is allowed for leadership on any account', () => {
    expect(denyReason(actor('leadership'), 'write_customer', rec())).toBeNull();
  });

  it('lets pre-sales write an account still in a pre-sales stage', () => {
    expect(denyReason(actor('presales'), 'write_customer', rec({ stage: 'presales' }))).toBeNull();
    expect(denyReason(actor('presales'), 'write_customer', rec({ stage: 'handoff' }))).toBeNull();
  });

  it('stops pre-sales writing an account that has moved into delivery', () => {
    expect(denyReason(actor('presales'), 'write_customer', rec({ stage: 'onboarding' }))).not.toBeNull();
    expect(denyReason(actor('presales'), 'write_customer', rec({ stage: 'steady_state' }))).not.toBeNull();
  });
});

describe('waiving a gate item', () => {
  it('is leadership-only, so skipping the gate stays visible and accountable', () => {
    expect(denyReason(actor('leadership'), 'waive_gate_item', rec())).toBeNull();
    expect(denyReason(actor('csm'), 'waive_gate_item', rec({ accountable: 'me@bah.com' }))).not.toBeNull();
    expect(denyReason(actor('presales'), 'waive_gate_item', rec())).not.toBeNull();
  });

  it('refuses the owner too — owning the account is not authority to waive its gate', () => {
    const reason = denyReason(actor('csm'), 'waive_gate_item', rec({ accountable: 'me@bah.com' }));
    expect(reason).toContain('leadership');
  });
});

describe('reassigning ownership', () => {
  it('is leadership-only', () => {
    expect(denyReason(actor('leadership'), 'reassign_ownership', rec())).toBeNull();
    expect(denyReason(actor('csm'), 'reassign_ownership', rec({ accountable: 'me@bah.com' }))).not.toBeNull();
  });
});

describe('creating a customer', () => {
  it('is open to anyone who can sign in — the gate is what matters, not creation', () => {
    expect(denyReason(actor('csm'), 'create_customer', null)).toBeNull();
    expect(denyReason(actor('presales'), 'create_customer', null)).toBeNull();
  });
});

describe('a missing record', () => {
  it('is refused rather than defaulting open', () => {
    expect(denyReason(actor('csm'), 'write_customer', null)).toBe('Customer not found.');
  });
});

describe('managing roles', () => {
  it('is admin-only once an admin exists', () => {
    for (const role of ['csm', 'presales', 'leadership'] as const) {
      expect(denyReason(actor(role), 'manage_roles', null, { bootstrap: false })).not.toBeNull();
    }
    expect(denyReason(actor('admin'), 'manage_roles', null, { bootstrap: false })).toBeNull();
  });

  it('is open to anyone while no admin exists yet', () => {
    // Otherwise the first person to deploy is locked out of the admin page by
    // the very file they need to edit to get into it.
    for (const role of ['csm', 'presales', 'leadership'] as const) {
      expect(denyReason(actor(role), 'manage_roles', null, { bootstrap: true })).toBeNull();
    }
  });

  it('defaults to closed when the caller says nothing about bootstrap', () => {
    expect(denyReason(actor('csm'), 'manage_roles', null)).not.toBeNull();
  });
});

describe('needsBootstrap', () => {
  it('is true only while no admin is listed', () => {
    expect(needsBootstrap({ default_role: 'csm', users: [] })).toBe(true);
    expect(
      needsBootstrap({ default_role: 'csm', users: [{ email: 'a@bah.com', role: 'leadership' }] }),
    ).toBe(true);
    expect(
      needsBootstrap({ default_role: 'csm', users: [{ email: 'a@bah.com', role: 'admin' }] }),
    ).toBe(false);
  });
});
