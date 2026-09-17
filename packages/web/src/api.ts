import type { CustomerIndex, ExceptionFeed, Health, GateProgress, CustomerRecord, Blocker } from '@cs/core';

/** In dev without a Worker, read the generated files the vite plugin serves. */
const FIXTURES = import.meta.env.VITE_FIXTURES === '1';

export class ApiError extends Error {
  readonly status: number;
  readonly issues: string[];
  readonly blockers: Blocker[];
  constructor(status: number, message: string, issues: string[] = [], blockers: Blocker[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
    this.blockers = blockers;
  }
}

async function get<T>(path: string, fixture?: string): Promise<T> {
  const url = FIXTURES && fixture ? fixture : path;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw await toError(res);
  return readJson<T>(res, url);
}

/**
 * A 200 that is not JSON means the request never reached the API and was
 * answered by the SPA shell instead. Parsing it raises "Unexpected token '<'",
 * which says nothing about the cause, so name it here.
 */
async function readJson<T>(res: Response, url: string): Promise<T> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new ApiError(
      502,
      `${url} did not return JSON. The request was answered by the app shell rather than the API — the endpoint is probably missing from the deployed Worker.`,
    );
  }
  return (await res.json()) as T;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  if (FIXTURES) {
    throw new ApiError(503, 'Running on fixtures — start the Worker to make changes.');
  }
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  return readJson<T>(res, path);
}

async function toError(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText}`;
  let issues: string[] = [];
  let blockers: Blocker[] = [];
  try {
    const body = (await res.json()) as { error?: string; issues?: string[]; blockers?: Blocker[] };
    if (body.error) message = body.error;
    if (body.issues) issues = body.issues;
    if (body.blockers) blockers = body.blockers;
  } catch {
    /* a non-JSON error body is still an error; keep the status line */
  }
  return new ApiError(res.status, message, issues, blockers);
}

export interface Me { email: string; role: string }

export interface RolesFile {
  default_role: string;
  users: Array<{ email: string; role: string }>;
  bootstrap: boolean;
  can_edit: boolean;
}

export interface CustomerDetail extends CustomerRecord {
  /** Blob SHA this view was built from; sent back with an edit. */
  base_sha: string | null;
  health: Health;
  gate: GateProgress | null;
  transitions: Array<{ to: string; allowed: boolean; blockers: Blocker[] }>;
}

export interface CommitEntry {
  sha: string; message: string; author: string; date: string; url: string;
}

/** In fixtures mode there is no Worker, so routes that only it can serve fail
 *  immediately rather than making a request that is certain to fail. */
function requireApi<T>(): Promise<T> {
  // Returns a rejected promise rather than throwing: a synchronous throw here
  // escapes the caller's .catch() and takes down the whole page load.
  return Promise.reject(new ApiError(503, 'Running on fixtures — start the Worker for live data.'));
}

export const api = {
  me: (): Promise<Me> =>
    FIXTURES
      ? // Dev preview runs as leadership so every edit surface is visible while
        // working on it. In production this comes from the Access identity.
        Promise.resolve({ email: 'dev@bah.com', role: 'leadership' })
      : get<Me>('/api/me').catch(() => ({ email: 'unknown', role: 'csm' }) as Me),
  index: () => get<CustomerIndex>('/api/index', '/fixtures/index.json'),
  exceptions: () => get<ExceptionFeed>('/api/exceptions', '/fixtures/exceptions.json'),
  customer: (slug: string) =>
    get<CustomerDetail>(`/api/customers/${slug}`, `/fixtures/customer/${slug}`),
  history: (slug: string) =>
    FIXTURES
      ? requireApi<{ commits: CommitEntry[] }>()
      : get<{ commits: CommitEntry[] }>(`/api/customers/${slug}/history`),

  createCustomer: (body: Record<string, unknown>) =>
    send<{ slug: string }>('POST', '/api/customers', body),
  transition: (slug: string, to: string) =>
    send<unknown>('POST', `/api/customers/${slug}/transition`, { to }),
  openHandoff: (slug: string) => send<unknown>('POST', `/api/customers/${slug}/handoff`, {}),
  completeItem: (slug: string, itemId: string, evidence: string) =>
    send<unknown>('POST', `/api/customers/${slug}/handoff/${itemId}/complete`, { evidence }),
  waiveItem: (slug: string, itemId: string, reason: string, reviewBy: string) =>
    send<unknown>('POST', `/api/customers/${slug}/handoff/${itemId}/waive`, {
      reason,
      review_by: reviewBy,
    }),
  acknowledgeOwnership: (slug: string) =>
    send<unknown>('POST', `/api/customers/${slug}/ownership/acknowledge`, {}),
  patchCustomer: (slug: string, baseSha: string, patch: Record<string, unknown>) =>
    send<unknown>('PATCH', `/api/customers/${slug}`, { base_sha: baseSha, patch }),
  reassign: (slug: string, accountable: string, deliveryLead?: string) =>
    send<unknown>('POST', `/api/customers/${slug}/ownership`, {
      accountable,
      ...(deliveryLead ? { delivery_lead: deliveryLead } : {}),
    }),
  addCommitment: (slug: string, body: Record<string, unknown>) =>
    send<unknown>('POST', `/api/customers/${slug}/commitments`, body),
  addRisk: (slug: string, body: Record<string, unknown>) =>
    send<unknown>('POST', `/api/customers/${slug}/risks`, body),
  addTouchpoint: (slug: string, body: Record<string, unknown>) =>
    send<unknown>('POST', `/api/customers/${slug}/touchpoints`, body),
  roles: () =>
    FIXTURES
      ? Promise.resolve({ default_role: 'csm', users: [], bootstrap: true, can_edit: true } as RolesFile)
      : get<RolesFile>('/api/admin/roles'),
  saveRoles: (body: { default_role: string; users: Array<{ email: string; role: string }> }) =>
    send<unknown>('PUT', '/api/admin/roles', body),
  updateCommitment: (slug: string, id: string, patch: Record<string, unknown>) =>
    send<unknown>('PATCH', `/api/customers/${slug}/commitments/${id}`, patch),
  isFixtures: FIXTURES,
};
