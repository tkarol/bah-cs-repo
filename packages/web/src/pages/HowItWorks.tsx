import { SIGNAL_IDS } from '@cs/core';

/**
 * The orientation page. It exists because adoption is the top risk on this
 * system (docs/ARCHITECTURE.md §10): a gate people do not understand is a gate
 * they route around. It explains the mechanism, not just the screens.
 */
export function HowItWorks() {
  return (
    <div className="prose">
      <h1>How it works</h1>
      <p className="sub">
        One system for running a customer from first contact through renewal, and for
        showing leadership the truth about every account without asking anyone.
      </p>

      <h2>The problem it solves</h2>
      <p>
        Things do not fall through the cracks evenly. They fall through at three specific
        moments, and every mechanism here targets one of them.
      </p>
      <div className="tiles">
        <div className="card tile">
          <div className="label">The handoff</div>
          <p className="note" style={{ fontSize: 14, marginTop: 8 }}>
            Promises the sales team made that delivery never heard about.
          </p>
        </div>
        <div className="card tile">
          <div className="label">The ownership change</div>
          <p className="note" style={{ fontSize: 14, marginTop: 8 }}>
            Someone leaves or reassigns, and open items lose their owner.
          </p>
        </div>
        <div className="card tile">
          <div className="label">The quiet decay</div>
          <p className="note" style={{ fontSize: 14, marginTop: 8 }}>
            No single failure — just ninety days of nobody calling.
          </p>
        </div>
      </div>

      <h2>Where the data lives</h2>
      <p>
        There is no database. Each customer is a directory of YAML and Markdown in a git
        repository, and that is the only copy of the truth. A GitHub Action recomputes a
        single <code>index.json</code> whenever anything changes; the app loads that one
        file and filters it in your browser.
      </p>

      <figure className="figure">
        <svg viewBox="0 0 760 336" role="img" className="diagram"
          aria-label="Writes go from the browser through the Worker to the git repository, which triggers an Action that rebuilds the index; dashboards read the rebuilt index while a single customer view reads the files directly.">
          <defs>
            <marker id="hiw-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>

          {/* Write path */}
          <text x="0" y="14" fontSize="12" fontWeight="600" fill="currentColor">WRITE</text>

          <rect x="0" y="28" width="132" height="46" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="66" y="56" fontSize="13" textAnchor="middle" fill="currentColor">Browser</text>

          <line x1="132" y1="51" x2="196" y2="51" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#hiw-arrow)" />
          <text x="164" y="42" fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.75">edit</text>

          <rect x="198" y="28" width="150" height="46" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="273" y="49" fontSize="13" textAnchor="middle" fill="currentColor">Worker</text>
          <text x="273" y="64" fontSize="10.5" textAnchor="middle" fill="currentColor" opacity="0.75">validate · gate · SHA</text>

          <line x1="348" y1="51" x2="412" y2="51" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#hiw-arrow)" />
          <text x="380" y="42" fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.75">commit</text>

          <rect x="414" y="28" width="150" height="46" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="489" y="49" fontSize="13" textAnchor="middle" fill="currentColor">Git repository</text>
          <text x="489" y="64" fontSize="10.5" textAnchor="middle" fill="currentColor" opacity="0.75">the source of truth</text>

          <line x1="564" y1="51" x2="628" y2="51" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#hiw-arrow)" />
          <text x="596" y="42" fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.75">push</text>

          <rect x="630" y="28" width="130" height="46" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="695" y="49" fontSize="13" textAnchor="middle" fill="currentColor">Action</text>
          <text x="695" y="64" fontSize="10.5" textAnchor="middle" fill="currentColor" opacity="0.75">rebuild index</text>

          {/* Action writes the index back */}
          <polyline points="695,74 695,116 489,116" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeDasharray="4 3" markerEnd="url(#hiw-arrow)" />
          <text x="600" y="110" fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.75">
            writes index.json back
          </text>

          {/* Read path */}
          <text x="0" y="192" fontSize="12" fontWeight="600" fill="currentColor">READ</text>

          <rect x="0" y="206" width="132" height="46" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="66" y="234" fontSize="13" textAnchor="middle" fill="currentColor">Browser</text>

          {/* Dashboards read the generated index. */}
          <text x="272" y="212" fontSize="11" textAnchor="middle" fill="#2a78d6">
            dashboards · whole index, filtered in the browser
          </text>
          <line x1="132" y1="224" x2="412" y2="224" stroke="#2a78d6" strokeWidth="2" markerEnd="url(#hiw-arrow)" />

          <rect x="414" y="202" width="150" height="44" rx="8" fill="none" stroke="#2a78d6" strokeWidth="2" />
          <text x="489" y="229" fontSize="13" textAnchor="middle" fill="currentColor">index.json</text>

          {/* A single customer bypasses the index entirely. */}
          <polyline points="66,252 66,296 412,296" fill="none" stroke="currentColor" strokeWidth="1.5"
            markerEnd="url(#hiw-arrow)" />
          <text x="278" y="288" fontSize="11" textAnchor="middle" fill="currentColor" opacity="0.75">
            one customer · read from the files, always fresh
          </text>

          <rect x="414" y="274" width="150" height="44" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text x="489" y="301" fontSize="13" textAnchor="middle" fill="currentColor">customer files</text>

        </svg>
        <figcaption>
          The index is a generated file, never a system of record. Delete it and the next
          push rebuilds it — which is why losing it costs nothing and why a database can
          replace it later without touching the rest of the system.
        </figcaption>
      </figure>

      <h2>What happens automatically</h2>
      <table>
        <thead>
          <tr><th>When</th><th>What runs</th><th>Why</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Every change to a customer</td>
            <td>Index rebuild</td>
            <td>Dashboards reflect the edit within about a minute.</td>
          </tr>
          <tr>
            <td>Every night</td>
            <td>Health recompute and exception sweep</td>
            <td>
              Most problems are time-based — a commitment goes past due, a waiver expires,
              contact decays. They appear with no data change at all, so waiting for
              someone to edit something would miss them.
            </td>
          </tr>
          <tr>
            <td>Every Monday</td>
            <td>Leadership roll-up and per-owner nudges</td>
            <td>The system escalates so nobody has to remember to.</td>
          </tr>
          <tr>
            <td>Every pull request</td>
            <td>Schema validation, tests, stale-index check</td>
            <td>A malformed file cannot reach the main branch.</td>
          </tr>
        </tbody>
      </table>

      <h2>How health is calculated</h2>
      <p>
        Nobody sets an account to green. Every account starts at 100 and loses points to
        seven signals, each computed from the files. The detail page always shows which
        signals fired and why — a red account that cannot explain itself just teaches
        people to ignore the colour.
      </p>
      <table>
        <thead>
          <tr><th>Signal</th><th>Fires when</th><th className="num">Max</th></tr>
        </thead>
        <tbody>
          <tr><td>Contact decay</td><td>Silence exceeds the tier's cadence (14 / 30 / 60 days)</td><td className="num">25</td></tr>
          <tr><td>Past-due commitments</td><td>An open promise is past its date, weighted by severity</td><td className="num">40</td></tr>
          <tr><td>Handoff debt</td><td>A required gate item is incomplete, or a waiver expired</td><td className="num">35</td></tr>
          <tr><td>Stage stagnation</td><td>The account sits in a stage beyond its expected band</td><td className="num">16</td></tr>
          <tr><td>Risk aging</td><td>Open risks, weighted by severity and how long they have sat</td><td className="num">30</td></tr>
          <tr><td>Ownership gap</td><td>A transfer has not been acknowledged by the new owner</td><td className="num">15</td></tr>
          <tr><td>Renewal exposure</td><td>Renewal inside 180 days with no plan on file</td><td className="num">30</td></tr>
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 13.5 }}>
        75 and above is healthy, 45 to 74 is watch, below 45 is at risk. These weights are
        a starting point and are meant to be retuned against real accounts after the pilot.
        All {SIGNAL_IDS.length} signals are evaluated for every account on every rebuild.
      </p>

      <h2>The handoff gate</h2>
      <p>
        This is the part that does the real work. When a deal is won, a checklist is opened
        on the account. Until every required item is complete or waived,{' '}
        <strong>the account cannot be moved into onboarding</strong> — the rule lives in
        the API, not the interface, so it cannot be clicked past.
      </p>
      <p>The gate also checks something a checklist alone would miss:</p>
      <blockquote>
        Every commitment made during the sale must be explicitly accepted, reassigned or
        waived by the incoming delivery owner before the account can advance.
      </blockquote>
      <p>
        That is the mechanism that closes the handoff crack. Each commitment records where
        it was promised and by whom, so at transition the system can list every promise
        made during the sale and demand an answer on each one.
      </p>
      <p>
        <strong>Waivers are deferrals, not deletions.</strong> A waiver needs a reason and a
        review date, can only be granted by leadership, and returns to the exception feed on
        that date. The gate's job is to make skipping visible and accountable rather than
        impossible — if more than about a third of items get waived, the checklist is wrong,
        and the app says so.
      </p>

      <h2>Who can do what</h2>
      <table>
        <thead>
          <tr><th>Role</th><th>Can do</th></tr>
        </thead>
        <tbody>
          <tr><td>CSM / delivery</td><td>Read everything; write the accounts they own</td></tr>
          <tr><td>Pre-sales</td><td>Read everything; write accounts still in a pre-sales stage</td></tr>
          <tr><td>Leadership</td><td>Everything above, plus waive gate items and reassign ownership</td></tr>
          <tr><td>Admin</td><td>Schema and template changes</td></tr>
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Roles live in <code>config/roles.yaml</code>, so a permission change is a reviewable
        commit rather than a console click nobody can audit. One honest limit: git has no
        per-row security, so anyone with access to the repository can read every account.
        Repository access has to be tighter than app access.
      </p>

      <h2>The tech stack</h2>
      <table>
        <thead>
          <tr><th>Layer</th><th>Built with</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td>Source of truth</td><td>GitHub repository</td><td>YAML and Markdown, one directory per customer</td></tr>
          <tr><td>Rules engine</td><td>TypeScript, Zod</td><td>Health, the gate and validation — pure functions, 65 tests</td></tr>
          <tr><td>API</td><td>Cloudflare Workers, Hono</td><td>Also serves the app; no database bindings</td></tr>
          <tr><td>Front end</td><td>React, Vite, React Router</td><td>Plain CSS tokens, light and dark</td></tr>
          <tr><td>Sign-in</td><td>Cloudflare Access</td><td>SSO and device posture; the Worker verifies the signed token</td></tr>
          <tr><td>Write credentials</td><td>GitHub App</td><td>Installation token, never leaves the Worker</td></tr>
          <tr><td>Automation</td><td>GitHub Actions</td><td>Index rebuild, nightly sweep, PR validation</td></tr>
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 13.5 }}>
        Everything above runs inside free tiers at this portfolio size. The first ceiling
        you would actually reach is Cloudflare Access, which is free up to 50 users —
        counted in staff accounts, not customers.
      </p>

      <h2>Why files instead of a database</h2>
      <table>
        <thead>
          <tr><th>What you get</th><th>How</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>A complete audit trail</td>
            <td>Who changed a renewal date, when, and what it was before is <code>git log</code>. No audit tables to build.</td>
          </tr>
          <tr>
            <td>Review on sensitive changes</td>
            <td>Contract terms can be routed through a pull request with an approver.</td>
          </tr>
          <tr>
            <td>No lock-in and no bill</td>
            <td>The data is readable YAML. The app could be rewritten and the data would not move.</td>
          </tr>
          <tr>
            <td>Nothing to back up</td>
            <td>The index is derived. Delete it and the next push regenerates it.</td>
          </tr>
        </tbody>
      </table>
      <p>
        The cost is that git cannot answer questions across accounts. At this size that
        stops mattering: the whole summary is a few hundred kilobytes, so it is sent to
        your browser and sorted there. Past roughly three hundred customers that stops
        being true, and a database goes behind the same interface the app already uses.
      </p>
    </div>
  );
}
