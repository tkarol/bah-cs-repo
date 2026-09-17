/**
 * Private key import that accepts whatever GitHub hands you.
 *
 * GitHub issues PKCS#1 (`BEGIN RSA PRIVATE KEY`); Web Crypto only imports
 * PKCS#8 (`BEGIN PRIVATE KEY`). Rather than making every operator run openssl
 * before they can deploy, we do the conversion here — it is a fixed DER wrapper
 * around the same key material, not a re-encoding.
 */

/** DER: tag + length + content. */
function der(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

/** DER length: short form below 128, else long form with a leading count byte. */
function derLength(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>>= 8) bytes.unshift(v & 0xff);
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

/** AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) with NULL params. */
const RSA_ALGORITHM_ID = new Uint8Array([
  0x30, 0x0d,
  0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  0x05, 0x00,
]);

/** PKCS#8 ::= SEQUENCE { version INTEGER, algorithm AlgorithmIdentifier, privateKey OCTET STRING } */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const wrapped = der(0x04, pkcs1);
  const body = new Uint8Array(version.length + RSA_ALGORITHM_ID.length + wrapped.length);
  body.set(version, 0);
  body.set(RSA_ALGORITHM_ID, version.length);
  body.set(wrapped, version.length + RSA_ALGORITHM_ID.length);
  return der(0x30, body);
}

/** Decodes standard base64 (not base64url) to bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const PEM_BODY = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END [A-Z ]+-----/;

/**
 * Imports an RSA private key for RS256 signing from a PEM in either format.
 * Whitespace inside the body is ignored, so a key pasted into a dashboard field
 * with mangled newlines still works.
 */
export async function importSigningKey(pem: string): Promise<CryptoKey> {
  const match = PEM_BODY.exec(pem.trim());
  if (!match) {
    throw new Error(
      'GITHUB_PRIVATE_KEY is not a PEM private key. Paste the whole .pem file, including the BEGIN and END lines.',
    );
  }

  const label = match[1]!.trim();
  const der = base64ToBytes(match[2]!.replace(/\s+/g, ''));

  let pkcs8: Uint8Array;
  if (label === 'RSA PRIVATE KEY') {
    pkcs8 = pkcs1ToPkcs8(der); // what GitHub downloads
  } else if (label === 'PRIVATE KEY') {
    pkcs8 = der; // already PKCS#8
  } else {
    throw new Error(
      `GITHUB_PRIVATE_KEY is a "${label}", which cannot be used for signing. ` +
        'Use the private key GitHub generated for the App.',
    );
  }

  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      pkcs8 as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch (cause) {
    throw new Error(
      'GITHUB_PRIVATE_KEY could not be imported. Re-download the key from the GitHub App and paste it unmodified.',
      { cause },
    );
  }
}
