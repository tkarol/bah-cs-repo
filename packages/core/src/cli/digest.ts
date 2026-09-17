/**
 * Renders the leadership roll-up and per-owner nudges from exceptions.json.
 *
 * Writes markdown to stdout (and to $GITHUB_STEP_SUMMARY when present) and, if
 * DIGEST_WEBHOOK is set, posts it to a Teams/Slack incoming webhook. Email is
 * deliberately not wired in: it needs SMTP credentials this repo does not have,
 * and a webhook is the free path that works today.
 *
 *   --scope=leadership   portfolio roll-up, ranked by severity then ARR
 *   --scope=owners       one section per accountable owner, their items only
 */
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CustomerIndex, ExceptionFeed, ExceptionRecord } from '../index-build.ts';

const root = resolve(process.env.REPO_ROOT ?? process.cwd());
const scope = process.argv.find((a) => a.startsWith('--scope='))?.slice(8) ?? 'leadership';

const index: CustomerIndex = JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8'));
const feed: ExceptionFeed = JSON.parse(await readFile(resolve(root, 'exceptions.json'), 'utf8'));

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M` : `$${Math.round(n / 1000)}k`;
const SEVERITY_MARK: Record<string, string> = {
  critical: '🔴', high: '🟠', medium: '🟡', low: '⚪',
};

function line(e: ExceptionRecord): string {
  const age = e.age_days === null ? '' : ` · ${e.age_days}d`;
  return `- ${SEVERITY_MARK[e.severity]} **${e.customer}** (${money(e.arr)}) — ${e.label}: ${e.detail}${age}`;
}

let out: string;

if (scope === 'owners') {
  const byOwner = new Map<string, ExceptionRecord[]>();
  for (const e of feed.exceptions) {
    const list = byOwner.get(e.accountable_owner) ?? [];
    list.push(e);
    byOwner.set(e.accountable_owner, list);
  }
  const sections = [...byOwner.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([owner, items]) => `### ${owner} — ${items.length} open\n\n${items.map(line).join('\n')}`);
  out = `## Your open items — ${feed.as_of}\n\n${sections.join('\n\n') || '_Nothing open._'}\n`;
} else {
  const t = index.totals;
  const top = feed.exceptions.slice(0, 15);
  const share = t.arr_total === 0 ? 0 : Math.round((t.arr_not_green / t.arr_total) * 100);
  out =
    `## Customer portfolio — ${feed.as_of}\n\n` +
    `**${t.customers} accounts · ${money(t.arr_total)} ARR**\n\n` +
    `| Band | Accounts |\n|---|---|\n` +
    `| 🟢 Green | ${t.by_band.green} |\n| 🟡 Amber | ${t.by_band.amber} |\n| 🔴 Red | ${t.by_band.red} |\n\n` +
    `${money(t.arr_not_green)} of ARR (${share}%) sits on accounts that are not green. ` +
    `${t.open_commitments_past_due} commitment(s) past due, ${t.open_risks} open risk(s).\n\n` +
    `### Ranked exceptions${feed.count > top.length ? ` (top ${top.length} of ${feed.count})` : ''}\n\n` +
    `${top.map(line).join('\n') || '_No open exceptions._'}\n`;
}

console.log(out);

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, out);
}

const webhook = process.env.DIGEST_WEBHOOK;
if (webhook) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: out }),
  });
  if (!res.ok) {
    console.error(`Webhook POST failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
}
