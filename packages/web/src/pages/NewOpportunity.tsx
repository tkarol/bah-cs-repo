import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.ts';
import { Field } from '../components/form.tsx';

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Deliberately three fields. Everything else has a sensible default and is
 * editable on the account page — asking for a contract vehicle before the deal
 * exists is how people stop using a tool.
 */
export function NewOpportunity() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [tier, setTier] = useState('standard');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = slugify(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createCustomer({
        slug,
        name: name.trim(),
        tier,
        value_annual: value === '' ? 0 : Number(value),
      });
      nav(`/a/${created.slug}`);
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>New opportunity</h1>
      <p className="sub">
        Starts in <strong>pre-sales</strong> with you as the owner. Everything else can be filled
        in as you learn it.
      </p>

      {error ? <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div> : null}

      <form className="card" onSubmit={submit} style={{ maxWidth: 520 }}>
        <Field label="Company name">
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>

        <Field
          label="Tier"
          hint="Sets how often you are expected to be in contact before the system flags silence."
        >
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="strategic">Strategic — every 14 days</option>
            <option value="growth">Growth — every 30 days</option>
            <option value="standard">Standard — every 60 days</option>
          </select>
        </Field>

        <Field label="Expected annual value" hint="A guess is fine. Change it any time.">
          <input
            type="number"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
          />
        </Field>

        {slug ? (
          <p className="field-hint">
            Saved as <code>customers/{slug}/</code>
          </p>
        ) : null}

        <div className="row-form" style={{ marginTop: 6 }}>
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button type="button" className="btn subtle" onClick={() => nav('/')}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
