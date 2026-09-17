import { describe, expect, it } from 'vitest';
import { normalizeTeamDomain } from '../src/access.ts';

describe('normalizeTeamDomain', () => {
  it.each([
    ['bah.cloudflareaccess.com', 'bah.cloudflareaccess.com'],
    ['https://bah.cloudflareaccess.com', 'bah.cloudflareaccess.com'],
    ['http://bah.cloudflareaccess.com', 'bah.cloudflareaccess.com'],
    ['https://bah.cloudflareaccess.com/', 'bah.cloudflareaccess.com'],
    ['  bah.cloudflareaccess.com  ', 'bah.cloudflareaccess.com'],
    // Just the team name, which is what the Zero Trust UI shows most prominently.
    ['bah', 'bah.cloudflareaccess.com'],
  ])('normalises %j', (input, expected) => {
    expect(normalizeTeamDomain(input)).toBe(expected);
  });

  it('is what the issuer check compares against, so a pasted scheme cannot break login', () => {
    const iss = `https://${normalizeTeamDomain('https://bah.cloudflareaccess.com/')}`;
    expect(iss).toBe('https://bah.cloudflareaccess.com');
  });
});
