import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.ts';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function NewCustomer() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tier, setTier] = useState('standard');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createCustomer({
        slug: effectiveSlug,
        name: name.trim(),
        tier,
        value_annual: value === '' ? 0 : Number(value),
      });
      nav(`/customers/${created.slug}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>Add a customer</h1>
      <p className="sub">
        Creates <span className="mono">customers/{effectiveSlug || '…'}/</span> in the repository.
        The account starts in <strong>prospect</strong> and you become its accountable owner.
      </p>

      {error ? <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div> : null}

      <form className="card" onSubmit={submit} style={{ display: 'grid', gap: 14, maxWidth: 560 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 560, fontSize: 14 }}>Account name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 560, fontSize: 14 }}>Directory name</span>
          <input
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
          />
          <span className="muted" style={{ fontSize: 12.5 }}>
            Permanent — it is the folder name in git and cannot be changed later without
            rewriting history.
          </span>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 560, fontSize: 14 }}>Tier</span>
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="strategic">Strategic — 14 day contact cadence</option>
            <option value="growth">Growth — 30 day contact cadence</option>
            <option value="standard">Standard — 60 day contact cadence</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 560, fontSize: 14 }}>Annual value (optional)</span>
          <input
            type="number"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
          />
        </label>

        <div>
          <button className="primary" type="submit" disabled={busy || !name.trim() || !effectiveSlug}>
            {busy ? 'Creating…' : 'Create customer'}
          </button>
        </div>
      </form>
    </>
  );
}
