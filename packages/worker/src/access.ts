/**
 * Cloudflare Access verification.
 *
 * Access sits in front of both Pages and the Worker and passes a signed JWT.
 * The presence of the header proves nothing on its own — a request that reaches
 * the Worker by another route could set it — so the signature is verified
 * against Cloudflare's published keys on every request.
 */
import { b64urlToBytes, decodeSegment } from './jwt.ts';
import type { Env } from './env.ts';

export interface Identity {
  email: string;
  /** Access's own subject id, useful for audit trails. */
  sub: string;
}

interface AccessClaims {
  aud: string[] | string;
  email?: string;
  sub: string;
  iss: string;
  exp: number;
  nbf?: number;
  iat?: number;
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

const keyCache = new Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function jwks(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const cached = keyCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };

  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys) {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  keyCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export async function verifyAccess(request: Request, env: Env): Promise<Identity> {
  // Local development only. Never reachable in a deployed Worker unless the var
  // is explicitly set, which wrangler.toml does not do.
  if (env.DEV_BYPASS_AUTH === '1') {
    return { email: env.DEV_USER ?? 'dev@bah.com', sub: 'dev' };
  }

  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) {
    throw new AuthError('Access is not configured on this Worker', 500);
  }

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    readCookie(request.headers.get('Cookie'), 'CF_Authorization');
  if (!token) throw new AuthError('Missing Access assertion');

  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed Access assertion');
  const [head, body, sig] = parts as [string, string, string];

  const header = decodeSegment<{ kid?: string; alg?: string }>(head);
  if (header.alg !== 'RS256') throw new AuthError('Unexpected Access token algorithm');
  if (!header.kid) throw new AuthError('Access token has no key id');

  const key = (await jwks(env.ACCESS_TEAM_DOMAIN)).get(header.kid);
  if (!key) throw new AuthError('Access token signed by an unknown key');

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${head}.${body}`),
  );
  if (!valid) throw new AuthError('Access token signature is invalid');

  const claims = decodeSegment<AccessClaims>(body);
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new AuthError('Access token has expired');
  if (claims.nbf && claims.nbf > now) throw new AuthError('Access token is not yet valid');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.ACCESS_AUD)) {
    throw new AuthError('Access token was issued for a different application');
  }
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) {
    throw new AuthError('Access token issuer mismatch');
  }
  if (!claims.email) throw new AuthError('Access token carries no email claim');

  return { email: claims.email.toLowerCase(), sub: claims.sub };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}
