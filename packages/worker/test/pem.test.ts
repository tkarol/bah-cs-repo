import { describe, expect, it } from 'vitest';
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { importSigningKey, pkcs1ToPkcs8 } from '../src/pem.ts';

// Generated in-process so the test is self-contained and runs in CI. Node's
// "pkcs1" export is exactly the format GitHub hands you for a GitHub App.
const { privateKey: pkcs1, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/** The reference conversion to compare our hand-rolled DER wrapper against. */
const pkcs8 = createPrivateKey(pkcs1).export({ type: 'pkcs8', format: 'pem' }).toString();

function bodyBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

describe('pkcs1ToPkcs8', () => {
  it('produces exactly what a real crypto library produces', () => {
    // The strongest available check: byte-identical to the reference conversion.
    expect(Buffer.from(pkcs1ToPkcs8(bodyBytes(pkcs1)))).toEqual(Buffer.from(bodyBytes(pkcs8)));
  });
});

describe('importSigningKey', () => {
  it('imports the PKCS#1 key GitHub actually hands you', async () => {
    const key = await importSigningKey(pkcs1);
    expect(key.type).toBe('private');
  });

  it('imports an already-converted PKCS#8 key too', async () => {
    const key = await importSigningKey(pkcs8);
    expect(key.type).toBe('private');
  });

  it('produces a signature that verifies against the real public key', async () => {
    const key = await importSigningKey(pkcs1);
    const data = new TextEncoder().encode('github app jwt payload');
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);

    const pub = await crypto.subtle.importKey(
      'spki',
      bodyBytes(publicKey) as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, sig, data)).toBe(true);
  });

  it('survives newlines mangled by a dashboard paste', async () => {
    const key = await importSigningKey(pkcs1.replace(/\n/g, ' '));
    expect(key.type).toBe('private');
  });

  it('explains itself when handed something that is not a key', async () => {
    await expect(importSigningKey('hunter2')).rejects.toThrow(/whole .pem file/);
  });

  it('rejects a public key with a message naming the mistake', async () => {
    await expect(importSigningKey(publicKey)).rejects.toThrow(/PUBLIC KEY/);
  });
});
