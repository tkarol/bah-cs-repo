import type { CustomerRecord } from '../src/load.ts';
import type { Customer } from '../src/schema.ts';

export const AS_OF = new Date('2026-09-17T00:00:00Z');

export function customer(over: Partial<Customer> = {}): Customer {
  return {
    slug: 'test-co',
    name: 'Test Co',
    tier: 'strategic',
    lifecycle_stage: 'steady_state',
    stage_entered: '2026-01-01',
    contract: { value_annual: 1_000_000, start: '2026-01-01', end: '2027-12-31' },
    owners: { accountable: 'a@bah.com', acknowledged_by_accountable: true },
    attachments: [],
    ...over,
  } as Customer;
}

export function record(over: Partial<CustomerRecord> = {}): CustomerRecord {
  // `over` is spread first so the merged customer below is not clobbered by the
  // raw partial the caller passed.
  return {
    slug: 'test-co',
    stakeholders: null,
    handoff: null,
    commitments: [],
    risks: [],
    renewal: null,
    touchpoints: [],
    ...over,
    customer: customer(over.customer ?? {}),
  };
}

export function touchpoint(date: string) {
  return {
    date,
    type: 'check_in' as const,
    attendees_internal: [],
    attendees_customer: [],
    summary: 's',
    body: '',
    path: `customers/test-co/touchpoints/${date}-check-in.md`,
  };
}

export function commitment(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    title: 'A commitment',
    origin: 'presales' as const,
    made_by: 'a@bah.com',
    owner: 'a@bah.com',
    due: '2026-12-01',
    severity: 'committed' as const,
    status: 'in_progress' as const,
    evidence: null,
    accepted_at_handoff: true,
    ...over,
  } as any;
}

export function handoffItem(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    title: 'An item',
    required: true,
    status: 'complete' as const,
    evidence: 'done',
    ...over,
  } as any;
}
