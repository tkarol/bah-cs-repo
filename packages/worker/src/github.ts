/**
 * GitHub App client.
 *
 * Writes are authenticated as a GitHub App installation, never a personal
 * token, and the token never leaves the Worker. Commits are attributed to the
 * app with the acting human recorded in a commit trailer, so `git log` remains
 * a real audit trail.
 */
import { signRs256 } from './jwt.ts';
import { importSigningKey } from './pem.ts';
import type { Env } from './env.ts';

const API = 'https://api.github.com';
const UA = 'bah-customer-success-worker';

export class GitHubError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`GitHub API ${status}: ${body.slice(0, 400)}`);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

/** Installation tokens last an hour; reuse within the isolate until near expiry. */
let tokenCache: { token: string; expiresAt: number } | null = null;

async function installationToken(env: Env): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - 60_000 > Date.now()) return tokenCache.token;

  const now = Math.floor(Date.now() / 1000);
  const key = await importSigningKey(env.GITHUB_PRIVATE_KEY);
  const appJwt = await signRs256(
    { iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID },
    key,
  );

  const res = await fetch(`${API}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${appJwt}`,
      accept: 'application/vnd.github+json',
      'user-agent': UA,
    },
  });
  if (!res.ok) throw new GitHubError(res.status, await res.text());

  const body = (await res.json()) as { token: string; expires_at: string };
  tokenCache = { token: body.token, expiresAt: Date.parse(body.expires_at) };
  return body.token;
}

async function api(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await installationToken(env);
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': UA,
    },
  });
}

export interface FileContents {
  text: string;
  /** Blob SHA. The basis of optimistic concurrency on writes. */
  sha: string;
}

export async function getFile(env: Env, path: string): Promise<FileContents | null> {
  const res = await api(
    env,
    `/repos/${env.GITHUB_REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(res.status, await res.text());

  const body = (await res.json()) as { content: string; encoding: string; sha: string };
  if (body.encoding !== 'base64') throw new Error(`unexpected encoding ${body.encoding}`);
  return { text: decodeBase64(body.content), sha: body.sha };
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
}

export async function getTree(env: Env): Promise<TreeEntry[]> {
  const res = await api(
    env,
    `/repos/${env.GITHUB_REPO}/git/trees/${encodeURIComponent(env.GITHUB_BRANCH)}?recursive=1`,
  );
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const body = (await res.json()) as { tree: TreeEntry[]; truncated: boolean };
  if (body.truncated) {
    // At the scale this system targets this cannot happen; if it ever does,
    // silently serving half a portfolio would be far worse than failing loudly.
    throw new Error('Repository tree response was truncated — the repo has outgrown a single tree fetch');
  }
  return body.tree;
}

export interface WriteResult {
  commit: string;
  sha: string;
}

export class ConflictError extends Error {
  constructor(public readonly path: string) {
    super(`${path} was modified by someone else`);
    this.name = 'ConflictError';
  }
}

/**
 * Writes a file with optimistic concurrency. `baseSha` is the blob SHA the
 * caller read; GitHub rejects the write if it no longer matches, which is how
 * two people editing the same customer never silently clobber each other.
 */
export async function putFile(
  env: Env,
  args: {
    path: string;
    text: string;
    baseSha: string | null;
    message: string;
    actor: string;
  },
): Promise<WriteResult> {
  const body: Record<string, unknown> = {
    message: `${args.message}\n\nActed-By: ${args.actor}`,
    content: encodeBase64(args.text),
    branch: env.GITHUB_BRANCH,
  };
  if (args.baseSha) body.sha = args.baseSha;

  const res = await api(env, `/repos/${env.GITHUB_REPO}/contents/${encodePath(args.path)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  // 409 is a racing write to the branch ref; 422 with a sha mismatch is a stale
  // base. Both mean "reload and retry", which the caller handles.
  if (res.status === 409 || res.status === 422) throw new ConflictError(args.path);
  if (!res.ok) throw new GitHubError(res.status, await res.text());

  const out = (await res.json()) as { commit: { sha: string }; content: { sha: string } };
  return { commit: out.commit.sha, sha: out.content.sha };
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

/** Git history for a path — the audit trail the file model gives us for free. */
export async function listCommits(env: Env, path: string, limit = 30): Promise<CommitSummary[]> {
  const res = await api(
    env,
    `/repos/${env.GITHUB_REPO}/commits?path=${encodePath(path)}&sha=${encodeURIComponent(env.GITHUB_BRANCH)}&per_page=${limit}`,
  );
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const body = (await res.json()) as Array<{
    sha: string;
    html_url: string;
    commit: { message: string; author: { name: string; date: string } };
  }>;
  return body.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author.name,
    date: c.commit.author.date,
    url: c.html_url,
  }));
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
