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
  return (await res.json()) as T;
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

export interface CustomerDetail extends CustomerRecord {
  health: Health;
  gate: GateProgress | null;
  transitions: Array<{ to: string; allowed: boolean; blockers: Blocker[] }>;
}

export interface CommitEntry {
  sha: string; message: string; author: string; date: string; url: string;
}

/** In fixtures mode there is no Worker, so routes that only it can serve fail
 *  immediately rather than making a request that is certain to fail. */
function requireApi(): never {
  throw new ApiError(503, 'Running on fixtures — start the Worker for live data.');
}

export const api = {
  me: (): Promise<Me> =>
    FIXTURES
      ? Promise.resolve({ email: 'preview', role: 'csm' })
      : get<Me>('/api/me').catch(() => ({ email: 'unknown', role: 'csm' }) as Me),
  index: () => get<CustomerIndex>('/api/index', '/fixtures/index.json'),
  exceptions: () => get<ExceptionFeed>('/api/exceptions', '/fixtures/exceptions.json'),
  customer: (slug: string) =>
    FIXTURES ? requireApi() : get<CustomerDetail>(`/api/customers/${slug}`),
  history: (slug: string) =>
    FIXTURES ? requireApi() : get<{ commits: CommitEntry[] }>(`/api/customers/${slug}/history`),

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
  updateCommitment: (slug: string, id: string, patch: Record<string, unknown>) =>
    send<unknown>('PATCH', `/api/customers/${slug}/commitments/${id}`, patch),
  isFixtures: FIXTURES,
};
