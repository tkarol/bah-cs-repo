import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CustomerIndex, IndexEntry } from '@cs/core';
import { api } from '../api.ts';
import { money, titleCase } from '../format.ts';
import { BandChip, Score, type Band } from '../components/status.tsx';

type SortKey = 'health' | 'arr' | 'name' | 'renewal' | 'contact';

/**
 * The whole index is already in memory, so filtering and sorting happen here
 * rather than on a server. At this portfolio size the dataset is a few hundred
 * KB — there is no query layer because there is nothing large enough to need one.
 */
export function Customers() {
  const [index, setIndex] = useState<CustomerIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('all');
  const [tier, setTier] = useState('all');
  const [band, setBand] = useState('all');
  const [sort, setSort] = useState<SortKey>('health');

  useEffect(() => {
    api.index().then(setIndex).catch((e: Error) => setError(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!index) return [];
    const needle = q.trim().toLowerCase();
    const filtered = index.customers.filter(
      (c) =>
        (needle === '' ||
          c.name.toLowerCase().includes(needle) ||
          c.accountable_owner.toLowerCase().includes(needle)) &&
        (stage === 'all' || c.lifecycle_stage === stage) &&
        (tier === 'all' || c.tier === tier) &&
        (band === 'all' || c.health.band === band),
    );
    const by: Record<SortKey, (a: IndexEntry, b: IndexEntry) => number> = {
      health: (a, b) => a.health.score - b.health.score,
      arr: (a, b) => b.contract.value_annual - a.contract.value_annual,
      name: (a, b) => a.name.localeCompare(b.name),
      renewal: (a, b) => a.contract.days_to_renewal - b.contract.days_to_renewal,
      contact: (a, b) => b.days_since_contact - a.days_since_contact,
    };
    return [...filtered].sort(by[sort]);
  }, [index, q, stage, tier, band, sort]);

  if (error) return <div className="error">{error}</div>;
  if (!index) return <p className="empty">Loading…</p>;

  const stages = [...new Set(index.customers.map((c) => c.lifecycle_stage))].sort();

  return (
    <>
      <h1>Customers</h1>
      <p className="sub">
        {rows.length} of {index.customers.length} accounts
        {' · '}
        <Link to="/customers/new">Add a customer</Link>
      </p>

      <div className="controls">
        <input
          className="grow"
          placeholder="Search by name or owner"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="all">All stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>{titleCase(s)}</option>
          ))}
        </select>
        <select value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="all">All tiers</option>
          <option value="strategic">Strategic</option>
          <option value="growth">Growth</option>
          <option value="standard">Standard</option>
        </select>
        <select value={band} onChange={(e) => setBand(e.target.value)}>
          <option value="all">Any health</option>
          <option value="red">At risk</option>
          <option value="amber">Watch</option>
          <option value="green">Healthy</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="health">Worst health first</option>
          <option value="arr">Largest value first</option>
          <option value="renewal">Soonest renewal</option>
          <option value="contact">Longest since contact</option>
          <option value="name">Name</option>
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Stage</th>
              <th>Health</th>
              <th className="num">Value</th>
              <th className="num">Last contact</th>
              <th className="num">Renewal</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const fired = c.health.signals.filter((s) => s.fired).length;
              const overdue = c.days_since_contact > c.cadence_days;
              return (
                <tr key={c.slug}>
                  <td>
                    <Link to={`/customers/${c.slug}`}>{c.name}</Link>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {titleCase(c.tier)}
                      {fired > 0 ? ` · ${fired} open issue${fired === 1 ? '' : 's'}` : ''}
                    </div>
                  </td>
                  <td>{titleCase(c.lifecycle_stage)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Score score={c.health.score} band={c.health.band as Band} />
                      <BandChip band={c.health.band as Band} />
                    </div>
                  </td>
                  <td className="num">{money(c.contract.value_annual)}</td>
                  <td className="num" style={overdue ? { color: 'var(--status-serious)' } : undefined}>
                    {c.days_since_contact}d
                    <div className="muted" style={{ fontSize: 12 }}>target {c.cadence_days}d</div>
                  </td>
                  <td className="num">{c.contract.days_to_renewal}d</td>
                  <td className="mono">{c.accountable_owner.replace('@bah.com', '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="empty">No accounts match those filters.</p> : null}
    </>
  );
}
