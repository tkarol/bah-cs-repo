import { useEffect, useState } from 'react';
import { api, ApiError, type RolesFile } from '../api.ts';
import { Field } from '../components/form.tsx';

const ROLES = ['csm', 'presales', 'leadership', 'admin'] as const;
type Role = (typeof ROLES)[number];

const ROLE_BLURB: Record<Role, string> = {
  csm: 'Read everything; edit only the accounts they own.',
  presales: 'Read everything; edit accounts still in a pre-sales stage.',
  leadership: 'Everything above, plus waiving gate items and reassigning ownership.',
  admin: 'Everything, plus managing this page.',
};

export function Admin() {
  const [roles, setRoles] = useState<RolesFile | null>(null);
  const [users, setUsers] = useState<Array<{ email: string; role: Role }>>([]);
  const [defaultRole, setDefaultRole] = useState<Role>('csm');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<Role>('csm');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .roles()
      .then((r) => {
        setRoles(r);
        setUsers(r.users.map((u) => ({ email: u.email, role: u.role as Role })));
        setDefaultRole(r.default_role as Role);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
  }, []);

  const dirty =
    roles !== null &&
    (defaultRole !== roles.default_role ||
      users.length !== roles.users.length ||
      users.some((u, i) => u.email !== roles.users[i]?.email || u.role !== roles.users[i]?.role));

  const save = async (next = users, nextDefault = defaultRole) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await api.saveRoles({ default_role: nextDefault, users: next });
      await load();
      setSaved('Saved. The change is committed to config/roles.yaml.');
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (users.some((u) => u.email.toLowerCase() === email)) {
      setError(`${email} is already listed.`);
      return;
    }
    const next = [...users, { email, role: newRole }];
    setUsers(next);
    setNewEmail('');
    void save(next);
  };

  if (error && !roles) return <div className="error">{error}</div>;
  if (!roles) return <p className="empty">Loading…</p>;

  const readOnly = !roles.can_edit;
  const adminCount = users.filter((u) => u.role === 'admin').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="sub">
            Who can sign in is controlled by Cloudflare Access. This page controls what they
            can do once they are in.
          </p>
        </div>
      </div>

      {roles.bootstrap ? (
        <div className="notice warn">
          <strong>No admin has been set yet.</strong> Until one exists, anyone who can sign in
          can edit this page. Add yourself as an <strong>admin</strong> below to close that.
        </div>
      ) : null}
      {readOnly ? (
        <div className="notice">
          You can see this page but not change it. Ask an admin for access.
        </div>
      ) : null}
      {error ? <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div> : null}
      {saved ? <div className="notice ok">{saved}</div> : null}

      <h2>Team</h2>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th className="num" />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty">
                  Nobody listed yet. Everyone signing in gets the default role below.
                </td>
              </tr>
            ) : (
              users.map((u, i) => (
                <tr key={u.email}>
                  <td className="mono">{u.email}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={readOnly || busy}
                      onChange={(e) => {
                        const next = [...users];
                        next[i] = { ...u, role: e.target.value as Role };
                        setUsers(next);
                        void save(next);
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <button
                      className="linklike danger"
                      disabled={readOnly || busy || (u.role === 'admin' && adminCount === 1)}
                      title={
                        u.role === 'admin' && adminCount === 1
                          ? 'This is the only admin — promote someone else first.'
                          : 'Remove'
                      }
                      onClick={() => {
                        const next = users.filter((_, j) => j !== i);
                        setUsers(next);
                        void save(next);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!readOnly ? (
        <form className="card add-row" onSubmit={add} style={{ marginTop: 12 }}>
          <Field label="Add someone">
            <input
              type="email"
              placeholder="name@bah.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Role" hint={ROLE_BLURB[newRole]}>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} disabled={busy}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn primary" type="submit" disabled={busy || !newEmail.trim()}>
            Add
          </button>
        </form>
      ) : null}

      <h2>Everyone else</h2>
      <div className="card">
        <Field
          label="Default role"
          hint="Applied to anyone who signs in but is not listed above."
        >
          <select
            value={defaultRole}
            disabled={readOnly || busy}
            onChange={(e) => {
              const next = e.target.value as Role;
              setDefaultRole(next);
              void save(users, next);
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r} — {ROLE_BLURB[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <p className="muted" style={{ fontSize: 13, marginTop: 18 }}>
        Every change here is a commit to <code>config/roles.yaml</code>, so who granted what,
        and when, is permanently in the repository history.
        {dirty && busy ? ' Saving…' : ''}
      </p>
    </>
  );
}
