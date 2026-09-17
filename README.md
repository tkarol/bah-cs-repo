# Customer Success Platform

One system for running an account from first contact through renewal, and for
showing leadership the truth about every account without asking anyone.

Two goals drive every design decision:

- **Nothing falls through the cracks** — promises made during the sale are typed
  records that survive the handoff, and the system escalates on its own.
- **Leadership sees reality** — account health is derived from objective signals,
  never self-reported.

Design and rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (read §2
first — the six invariants explain why the rest looks the way it does).
Deploying: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The running app explains
itself on its own **How it works** page.

## There is no database

The repository *is* the backend. Each account is a directory of YAML and
Markdown under `customers/`. A GitHub Action rebuilds `index.json` on every
change and the app fetches that one file — at this size the whole summary is a
few hundred KB, so it ships to the browser and gets filtered there.

Audit history (`git log -p`), review-on-change (pull requests) and portability
come free, and it runs at zero cost. Index reads go through one
`IndexProvider` interface, so a real database can replace the file later without
touching a route or any UI code. §10 names the triggers for doing that.

## The three pages

| Page | For |
|---|---|
| **Pipeline** | Every account in three lanes — pre-sales, the handoff, post-sales. Where you work. |
| **Attention** | A ranked list of what is wrong across the portfolio. What leadership opens. |
| **People** | Who can do what. Admins only, once a first admin exists. |

The same record is an **opportunity** before the handoff and a **customer**
after it. One record, one history — only the label changes.

## Layout

```
customers/<slug>/        the source of truth — one directory per account
  customer.yaml            identity, contract, tier, stage, owners
  handoff.yaml             the blocking transition gate
  commitments/*.yaml       promises, each with an owner, a due date and an origin
  risks/*.yaml
  touchpoints/*.md         YAML frontmatter + notes
  renewal.yaml             required once renewal is inside 180 days
templates/customer/      scaffold for new accounts
schemas/                 JSON Schema, generated from the Zod definitions
config/roles.yaml        who may do what
history/                 append-only daily health snapshots
index.json               GENERATED — never hand-edit
exceptions.json          GENERATED — never hand-edit

packages/core            domain model, health engine, gate, index builder
packages/worker          Cloudflare Worker: API + serves the built app
packages/web             React SPA
```

Three sample accounts ship with the repo, one per pipeline lane: one being
pursued, one mid-handoff with real gate debt, one live and healthy. Delete them
once you have real ones — `git rm -r customers/<slug>`, then `npm run index`.

## Running it

```bash
npm install

npm run index          # rebuild index.json + exceptions.json
npm run validate       # schema + cross-file invariants
npm test               # 123 tests
npm run typecheck
npm run digest         # the leadership roll-up, as markdown
```

To drive the UI against the sample data with no Worker and no cloud account:

```bash
npm run index
cd packages/web && VITE_FIXTURES=1 npx vite
```

`AS_OF=2026-09-17 npm run index` pins the evaluation date — useful for
reproducing a past state, and the reason every health rule takes the date as an
argument rather than reading the clock.

### The full stack locally

```bash
npm run dev:worker     # wrangler, port 8787
npm run dev:web        # vite, proxies /api to the worker
```

## Deploying

One Worker serves both the API and the built app: `run_worker_first` routes
`/api/*` to the script and everything else comes from static assets. One origin,
one deploy, no CORS, and Cloudflare Access protects both halves together.

```bash
npm run deploy         # builds the app, then deploys the Worker with it
```

Cloudflare's Git integration also builds on push to `main` (`npm run build`,
then `npx wrangler deploy`, from the repo root).

Configuration lives in `wrangler.toml`. There is exactly **one secret**,
`GITHUB_PRIVATE_KEY`, pasted as GitHub downloads it — the Worker converts
PKCS#1 itself. No domain is needed: Access can be enabled on the Worker's
`workers.dev` URL in one click.

**On first sign-in, go to People and make yourself an admin.** Until one admin
exists, anyone who can sign in may edit that page; once one does, it closes.

## Before a pilot

Three things need a human answer, and health scoring cannot be calibrated
without the first two:

1. **Cadence targets per tier.** The defaults (14/30/60 days) are placeholders.
2. **Health score weights.** Expect the first set to be wrong; revise after the
   pilot against real accounts.
3. **The handoff checklist** in `templates/customer/handoff.template.yaml`
   should be written by someone who has personally watched a handoff fail, not
   adapted from a generic playbook.
