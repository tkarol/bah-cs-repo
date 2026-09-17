import { describe, expect, it } from 'vitest';
import { assertSafeSlug, loadCustomer, SLUG_PATTERN, type FileSource } from '../src/load.ts';

/** Records every path the loader asks for, so we can assert none escape. */
function spySource(): FileSource & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async list(dir) { paths.push(dir); return []; },
    async listDirs(dir) { paths.push(dir); return []; },
    async read(path) { paths.push(path); return null; },
  };
}

const HOSTILE = [
  '../../.github/workflows',
  '..',
  '../etc',
  'acme/../../../etc/passwd',
  'acme/sub',
  '/absolute',
  'UPPER',
  'has space',
  'trailing-',
  '-leading',
  'double--dash',
  '',
  '.',
  'a/./b',
  'acme%2f..%2f..',
];

describe('slug validation', () => {
  it.each(HOSTILE)('refuses %j', (slug) => {
    expect(() => assertSafeSlug(slug)).toThrow();
    expect(SLUG_PATTERN.test(slug)).toBe(false);
  });

  it.each(['acme', 'acme-corp', 'a1', 'meridian-health-systems', '123'])(
    'accepts %j',
    (slug) => {
      expect(() => assertSafeSlug(slug)).not.toThrow();
    },
  );
});

describe('loadCustomer', () => {
  it('refuses a traversing slug before touching the file source at all', async () => {
    // The danger is not just reading: the same interpolation builds write paths,
    // and a slug of "../../.github/workflows" would put a file where Actions run.
    const source = spySource();
    await expect(loadCustomer(source, '../../.github/workflows')).rejects.toThrow(/kebab-case/);
    expect(source.paths).toEqual([]);
  });

  it('never requests a path outside customers/ for a valid slug', async () => {
    const source = spySource();
    await expect(loadCustomer(source, 'acme')).rejects.toThrow(/missing required file/);
    for (const path of source.paths) {
      expect(path.startsWith('customers/acme')).toBe(true);
      expect(path.split('/')).not.toContain('..');
    }
  });
});
