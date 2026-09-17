import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index.ts';

// The Worker signs a GitHub App JWT before it can read anything, so the harness
// needs a real key. Generated in-process; it never leaves this test.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/**
 * Route-order regression guard.
 *
 * Hono matches in registration order, so a catch-all declared above a real
 * route silently swallows it — the request falls through to the static assets
 * and a fetch() expecting JSON receives the SPA's HTML instead. The symptom
 * ("Unexpected token '<'") points nowhere near the cause, so it is worth a test.
 */

const ROLES_YAML = `default_role: csm\nusers:\n  - email: boss@bah.com\n    role: admin\n`;

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

const env = {
  ASSETS: {
    fetch: async () =>
      new Response('<!doctype html><html><body>SPA</body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
  },
  GITHUB_REPO: 'acme/repo',
  GITHUB_BRANCH: 'main',
  ACCESS_AUD: '',
  ACCESS_TEAM_DOMAIN: '',
  GITHUB_APP_ID: '1',
  GITHUB_INSTALLATION_ID: '2',
  GITHUB_PRIVATE_KEY: privateKey,
  DEV_BYPASS_AUTH: '1',
  DEV_USER: 'boss@bah.com',
} as unknown as Parameters<typeof app.fetch>[1];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/access_tokens')) {
        return new Response(
          JSON.stringify({ token: 'ghs_test', expires_at: new Date(Date.now() + 3_600_000).toISOString() }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/contents/config/roles.yaml')) {
        return new Response(JSON.stringify({ content: b64(ROLES_YAML), encoding: 'base64', sha: 'abc' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`https://app.example${path}`, init), env);

describe('API routes are never swallowed by the asset catch-all', () => {
  it('serves the admin roles endpoint as JSON', async () => {
    const res = await call('/api/admin/roles');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { users: unknown[]; bootstrap: boolean };
    expect(body.users).toHaveLength(1);
    expect(body.bootstrap).toBe(false);
  });

  it('serves /api/me as JSON', async () => {
    const res = await call('/api/me');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: 'boss@bah.com', role: 'admin' });
  });

  it.each([
    '/api/unknown',
    '/api/admin/nope',
    '/api/a/b/c/d',
  ])('answers %s with JSON 404, never the SPA shell', async (path) => {
    const res = await call(path);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const text = await res.text();
    expect(text).not.toContain('<!doctype');
    expect(text).toContain('No such endpoint');
  });

  it('still serves the SPA for non-API paths', async () => {
    const res = await call('/people');
    expect(await res.text()).toContain('<!doctype');
  });
});

describe('role enforcement over HTTP', () => {
  it('refuses a role change from a non-admin', async () => {
    const res = await app.fetch(
      new Request('https://app.example/api/admin/roles', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ default_role: 'csm', users: [{ email: 'x@bah.com', role: 'admin' }] }),
      }),
      { ...env, DEV_USER: 'nobody@bah.com' } as typeof env,
    );
    expect(res.status).toBe(403);
  });

  it('refuses a payload that would remove the last admin', async () => {
    const res = await call('/api/admin/roles', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default_role: 'csm', users: [{ email: 'x@bah.com', role: 'csm' }] }),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('At least one admin');
  });
});
