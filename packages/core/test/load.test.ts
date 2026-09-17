import { describe, expect, it } from 'vitest';
import { loadCustomer, loadAllCustomers, parseTouchpoint, ValidationError, type FileSource } from '../src/load.ts';

/** In-memory FileSource so loader tests never touch disk. */
function memSource(files: Record<string, string>): FileSource {
  return {
    async list(dir) {
      return Object.keys(files).filter(
        (p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'),
      );
    },
    async listDirs(dir) {
      const out = new Set<string>();
      for (const p of Object.keys(files)) {
        if (!p.startsWith(`${dir}/`)) continue;
        const rest = p.slice(dir.length + 1);
        if (rest.includes('/')) out.add(rest.split('/')[0]!);
      }
      return [...out];
    },
    async read(path) {
      return files[path] ?? null;
    },
  };
}

const VALID_CUSTOMER = `
slug: acme
name: Acme
tier: growth
lifecycle_stage: steady_state
stage_entered: 2026-01-01
contract:
  value_annual: 100000
  start: 2026-01-01
  end: 2027-01-01
owners:
  accountable: a@bah.com
`;

describe('loadCustomer', () => {
  it('loads a minimal customer and defaults the optional collections', async () => {
    const rec = await loadCustomer(memSource({ 'customers/acme/customer.yaml': VALID_CUSTOMER }), 'acme');
    expect(rec.customer.name).toBe('Acme');
    expect(rec.commitments).toEqual([]);
    expect(rec.handoff).toBeNull();
    expect(rec.customer.owners.acknowledged_by_accountable).toBe(true);
  });

  it('rejects a slug that disagrees with its directory', async () => {
    const src = memSource({ 'customers/other/customer.yaml': VALID_CUSTOMER });
    await expect(loadCustomer(src, 'other')).rejects.toThrow(/does not match directory/);
  });

  it('reports a missing customer.yaml as a validation error, not a crash', async () => {
    await expect(loadCustomer(memSource({}), 'ghost')).rejects.toBeInstanceOf(ValidationError);
  });

  it('names the offending field so a CI failure is actionable', async () => {
    const src = memSource({ 'customers/acme/customer.yaml': VALID_CUSTOMER.replace('growth', 'platinum') });
    await expect(loadCustomer(src, 'acme')).rejects.toThrow(/tier/);
  });

  it('refuses a commitment marked complete with no evidence (P5)', async () => {
    const src = memSource({
      'customers/acme/customer.yaml': VALID_CUSTOMER,
      'customers/acme/commitments/c1.yaml': `
id: c1
title: T
origin: presales
made_by: a@bah.com
owner: a@bah.com
due: 2026-05-01
severity: committed
status: complete
evidence: null
`,
    });
    await expect(loadCustomer(src, 'acme')).rejects.toThrow(/evidence is required/);
  });

  it('refuses a waived handoff item with no waiver', async () => {
    const src = memSource({
      'customers/acme/customer.yaml': VALID_CUSTOMER,
      'customers/acme/handoff.yaml': `
customer: acme
opened: 2026-01-01
target_completion: 2026-01-22
items:
  - id: a
    title: A
    required: true
    status: waived
`,
    });
    await expect(loadCustomer(src, 'acme')).rejects.toThrow(/requires a waiver/);
  });

  it('returns touchpoints newest first', async () => {
    const tp = (d: string) => `---\ndate: ${d}\ntype: check_in\nsummary: s\n---\nbody`;
    const rec = await loadCustomer(
      memSource({
        'customers/acme/customer.yaml': VALID_CUSTOMER,
        'customers/acme/touchpoints/2026-01-05-a.md': tp('2026-01-05'),
        'customers/acme/touchpoints/2026-08-09-b.md': tp('2026-08-09'),
        'customers/acme/touchpoints/2026-04-02-c.md': tp('2026-04-02'),
      }),
      'acme',
    );
    expect(rec.touchpoints.map((t) => t.date)).toEqual(['2026-08-09', '2026-04-02', '2026-01-05']);
  });
});

describe('parseTouchpoint', () => {
  it('splits frontmatter from body', () => {
    const tp = parseTouchpoint('---\ndate: 2026-01-01\ntype: qbr\nsummary: s\n---\n\n# Notes\n\nText.\n', 'p.md');
    expect(tp.date).toBe('2026-01-01');
    expect(tp.body).toBe('# Notes\n\nText.');
  });

  it('rejects a file with no frontmatter', () => {
    expect(() => parseTouchpoint('just text', 'p.md')).toThrow(/frontmatter/);
  });
});

describe('loadAllCustomers', () => {
  it('collects errors per customer instead of failing the whole tree', async () => {
    const src = memSource({
      'customers/acme/customer.yaml': VALID_CUSTOMER,
      'customers/broken/customer.yaml': 'slug: broken\nname: Broken\n',
    });
    const { records, errors } = await loadAllCustomers(src);
    expect(records).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.path).toContain('broken');
  });
});
