/** Minimal RS256 helpers on WebCrypto. Used for both directions: verifying the
 *  Cloudflare Access assertion, and signing the GitHub App JWT. */

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlJson(value: unknown): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeSegment<T>(segment: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(segment))) as T;
}

export async function signRs256(payload: unknown, key: CryptoKey): Promise<string> {
  const head = b64urlJson({ alg: 'RS256', typ: 'JWT' });
  const body = b64urlJson(payload);
  const data = new TextEncoder().encode(`${head}.${body}`);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  return `${head}.${body}.${bytesToB64url(sig)}`;
}
