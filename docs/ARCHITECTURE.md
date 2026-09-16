# Customer Success Platform — Architecture Plan

**Status:** Draft for review · **Date:** 2026-09-16

## 1. What this system is

One application serving two distinct jobs that are usually split across two tools and
therefore leak at the seam between them:

1. **Operational** — pre-sales and post-sales teams run the customer through its
   lifecycle here. Commitments made during the sale survive the handoff into delivery.
2. **Oversight** — leadership sees, without asking anyone, which accounts are in
   trouble and why.

The second job is not a reporting layer bolted onto the first. It is the *same data*,
queried differently. Any design where leadership sees a hand-maintained status is a
design where leadership sees fiction.

### The failure this system exists to prevent

Things fall through the cracks at three specific moments, not diffusely:

| Moment | What is lost |
|---|---|
| **The handoff** | Promises the sales team made that delivery never heard about |
| **The ownership change** | A CSM leaves or reassigns; open items lose their owner |
| **The quiet decay** | No single dramatic failure — just 90 days of no contact |

Every mechanism below targets one of those three. Generic "track everything" tooling
does not prevent any of them.

---

## 2. Design principles

These are the invariants. Everything else is implementation detail.

**P1 — Every commitment is a typed record with an owner and a due date.**
Not a bullet in a meeting note. If sales promises a custom integration by Q2, that is
a `commitment` object with `owner`, `due`, `origin: presales`, and required evidence
of completion. Free text is for context, never for obligations.

**P2 — Status is derived, never self-reported.**
No human sets an account to "green." Health is computed from objective signals
(§6). Self-reported RAG status is why leadership dashboards fail: everything is green
until the week it is catastrophically red.

**P3 — The handoff is a gate, not a milestone.**
An account cannot enter `onboarding` with an incomplete transition checklist. Items
can be *waived*, but a waiver is a first-class record — named waiver, reason, date —
and it stays visible on the leadership dashboard until closed. Blocking with a
logged escape hatch beats advisory checklists that everyone ignores.

**P4 — Every customer has exactly one accountable owner at every instant.**
Enforced by schema validation. Ownership transfer requires the receiving owner to
acknowledge; until then the account appears in the exception feed.

**P5 — "Done" requires evidence.**
Closing a checklist item or commitment requires a link, an attached artifact, or a
named attestation. A checkbox alone is not a completion.

**P6 — The system finds problems; humans do not report them.**
A scheduled sweep generates exceptions (§6). Nobody has to remember to escalate.

---

## 3. Storage architecture

**Decision: files are the source of truth; a database is a disposable index.**

```
   ┌──────────── WRITE PATH ────────────┐
   UI ──▶ Worker API ──▶ Queue ──▶ GitHub Contents API (commit)
                                          │
                                     webhook
                                          ▼
                              Indexer Worker ──▶ D1 (rebuild changed rows)

   ┌──────────── READ PATH ─────────────┐
   UI ──▶ Worker API ──▶ D1  (single-customer views, dashboards, rollups)
                    └──▶ GitHub raw (full document bodies, history, diffs)
```

### Why this shape

Your instinct — files in a repo per customer — is right, and it buys three things that
are expensive to build otherwise:

- **Audit for free.** "Who changed the renewal date, when, and what was it before?"
  is `git log -p`. In a government-adjacent context this is not a nice-to-have, and
  building equivalent audit tables in a database is real work.
- **Review workflow for free.** Sensitive changes (contract terms, health overrides)
  can route through a pull request with an approver.
- **No lock-in.** The data is legible YAML and Markdown. The app can be rewritten
  and the data survives untouched.

What git *cannot* do is answer "show me every account with a past-due commitment,
sorted by contract value." That requires scanning every file in the tree on every page
load. D1 solves this, and because it is **rebuilt from the files**, it is never the
thing you have to protect. If D1 is lost or corrupted, you replay the repo and
you are whole. That property is what makes the hybrid safe rather than merely clever.

### One repo, one directory per customer — not a branch per customer

Worth stating explicitly because branch-per-customer is a tempting idea that goes
badly. Branches model *divergent versions of the same thing*; customers are
*independent partitions of different things*. Branch-per-customer means: no
cross-customer query without N checkouts, no unified history, CI runs N times,
every branch silently drifts from the template, and merging template updates across
50 branches is a permanent chore. Directories on `main` give you every benefit you
wanted from branches — isolation, per-customer history (`git log -- customers/acme/`),
clean diffs — with none of that.

### Concurrency

Under 50 customers this is a solved problem, and GitHub hands us the solution: every
file read returns a blob SHA. Writes send the SHA they were based on; if it no longer
matches, GitHub rejects the write and the UI reloads and re-applies. That is
optimistic concurrency control with no merge conflicts, because two users never
blind-write the same file. A Cloudflare Queue serializes commits so concurrent writes
to *different* files don't race the git ref either.

---

## 4. Repository layout

```
customers/
  acme-corp/
    customer.yaml          # identity, contract, tier, lifecycle stage, owners
    stakeholders.yaml      # customer-side people, roles, sentiment, last contact
    handoff.yaml           # the transition gate (§5)
    commitments/
      2026-03-integration-sso.yaml
    risks/
      2026-08-exec-sponsor-departed.yaml
    touchpoints/
      2026-09-02-qbr.md    # YAML frontmatter + Markdown body
    renewal.yaml           # renewal plan; required when renewal < 180 days out
  globex/
    ...

templates/
  customer/                # scaffold copied when creating a new customer
schemas/                   # JSON Schema for every file type
docs/
```

### Example: `customer.yaml`

```yaml
slug: acme-corp
name: Acme Corporation
tier: strategic                 # strategic | growth | standard
lifecycle_stage: onboarding     # prospect|presales|handoff|onboarding|steady_state|renewal|at_risk|churned
stage_entered: 2026-08-14

contract:
  value_annual: 1250000
  start: 2026-08-01
  end: 2027-07-31
  vehicle: GSA MAS

owners:
  accountable: jdoe@bah.com     # exactly one, always (P4)
  presales_lead: msmith@bah.com
  delivery_lead: rchen@bah.com
  transferred_at: 2026-08-14
  acknowledged_by_accountable: true   # false ⇒ exception until acknowledged

cadence_days: 14                # tier-driven touchpoint expectation
```

### Example: `commitments/2026-03-integration-sso.yaml`

```yaml
id: acme-corp-sso-integration
title: SAML SSO integration with customer IdP
origin: presales                # where the promise was made — the crack we're closing
origin_ref: touchpoints/2026-03-11-technical-deep-dive.md
made_by: msmith@bah.com
made_to: "Dana Vance, CTO"
owner: rchen@bah.com            # current owner; survives the handoff
due: 2026-11-30
severity: contractual           # contractual | committed | best_effort
status: in_progress             # not_started | in_progress | blocked | complete | waived
evidence: null                  # required non-null to reach status: complete (P5)
```

The `origin` / `origin_ref` pair is the mechanism for the handoff crack: at transition
time the system can list *every promise made during the sale* and demand each one be
explicitly accepted, reassigned, or waived by the incoming delivery owner.

### Schema validation is what makes this safe

Every file type has a JSON Schema in `schemas/`. Validation runs in two places:

- **In the Worker, before commit** — bad writes never reach the repo.
- **In CI on every push** — catches hand-edited files and schema migrations.

This is the discipline that separates "files as a database" from "a folder of YAML
that slowly rots." Without it, do not build this design.

---

## 5. The handoff gate

The centerpiece. `handoff.yaml` is a structured checklist instantiated from a template
when an account reaches closed-won, and it blocks the `presales → onboarding`
transition.

```yaml
customer: acme-corp
opened: 2026-08-01
target_completion: 2026-08-21
completed: null

items:
  - id: commitments-transferred
    title: Every pre-sales commitment accepted or waived by delivery owner
    required: true
    status: complete
    evidence: "All 4 commitments reassigned; see commitments/"
    completed_by: rchen@bah.com
    completed_at: 2026-08-12

  - id: exec-sponsor-introduced
    title: Delivery lead introduced to customer exec sponsor
    required: true
    status: waived
    waiver:
      by: dlead@bah.com
      reason: "Sponsor on leave until 9/15; intro scheduled 9/18"
      at: 2026-08-19
      review_by: 2026-09-18      # reappears in exception feed on this date
```

Two properties do the real work:

- **Blocking.** The stage transition API refuses to advance an account with incomplete
  required items. This is the single highest-leverage rule in the system.
- **Waivers expire.** A waiver has a `review_by` date. On that date it returns to the
  exception feed. Waivers are a deferral, never a deletion — this is what stops the
  gate from being quietly neutered in month three.

A parallel, lighter gate applies to **ownership transfer** (P4), which is the second
crack: reassignment generates an acknowledgment task for the receiving owner and a
list of inherited open items.

---

## 6. The leadership layer

### Derived health score

Computed by the sweeper, never entered by a human. Signals, each objective and
computable from the files:

| Signal | Trigger |
|---|---|
| Contact decay | days since last touchpoint > `cadence_days` for tier |
| Past-due commitments | weighted by `severity`; `contractual` dominates |
| Handoff debt | incomplete required items, or an expired waiver |
| Stage stagnation | days in `lifecycle_stage` exceeds expected band |
| Risk aging | open risks, weighted by severity × days open |
| Ownership gap | unacknowledged transfer, or accountable owner inactive |
| Renewal exposure | renewal < 180 days with no `renewal.yaml` plan |

Score is a transparent weighted sum — and critically, **the UI always shows which
signals fired**, not just a number. A red account that can't explain itself trains
people to ignore the color.

### Exception feed, not a browsable list

Leadership's landing page is **not** 50 account tiles. It is a ranked list of *things
that are wrong*, newest and most severe first, each one click from the underlying
record. Browsing is available; it is not the default. The default answers "what needs
me today."

### Scheduled sweep

A Cloudflare Cron Trigger runs the sweeper (nightly, plus on-demand). It reads D1,
evaluates every rule, writes the exception table, and pushes digests — a weekly
leadership roll-up, and targeted nudges to individual owners for their own past-due
items. **The system escalates; humans do not have to remember to.** (P6)

---

## 7. Cloudflare stack mapping

| Concern | Service |
|---|---|
| UI | **Pages** (React + Vite, SPA) |
| API | **Workers** (Hono router, TypeScript) |
| Query index | **D1** — SQLite; trivially sized for <50 customers |
| Attachments | **R2** — decks, contracts, diagrams; repo stores pointers, not blobs |
| Write serialization | **Queues** — one consumer, ordered commits |
| Scheduled sweep | **Cron Triggers** |
| Auth | **Cloudflare Access** (Zero Trust) in front of Pages *and* Workers |
| Secrets | Worker secrets (GitHub App private key) |

Two notes on this stack:

- **Keep binary files out of git.** Contracts and decks go to R2; the YAML holds a key
  and a checksum. Git repos degrade badly with large binaries, and unlike the text
  data, you gain nothing from diffing a PDF.
- **Auth is Cloudflare Access, not hand-rolled.** Access sits in front of everything and
  passes a signed JWT (`Cf-Access-Jwt-Assertion`) that the Worker verifies against
  Cloudflare's public keys. It is the single highest-value thing the Cloudflare choice
  gives you: SSO, device posture, and audit logging without writing an auth system.
  Verify the JWT in the Worker — do not trust the header's presence alone.

### GitHub identity

The Worker commits via a **GitHub App** installation token, not a personal token.
Commits are attributed to the app, with the acting human recorded in the commit
trailer and in D1. Never expose the repo token to the browser.

---

## 8. Access control

Roles, enforced in the Worker against the Access JWT identity:

| Role | Capability |
|---|---|
| CSM / delivery | Read all; write only accounts they own |
| Pre-sales | Read all; write `presales`-stage accounts and commitments they originate |
| Leadership | Read all; waive gate items; reassign ownership |
| Admin | Schema and template changes (via PR) |

**The honest limitation of the file model:** git has no row-level security. Anyone with
repo access reads every customer. Enforcement lives in the app layer, so repo access
must be tighter than app access. If you later need true per-customer data isolation
(e.g. customers whose data must not be visible to all CSMs), that is the point at
which the storage decision gets revisited — see §10.

---

## 9. Build order

Sequenced so each phase is independently useful and the riskiest assumption is tested
first.

**Phase 0 — Prove the loop (≈1 week).**
Schemas, one hand-written customer directory, Worker that reads the repo and builds
D1, webhook reindex. No UI. Success: editing YAML in GitHub updates a D1 query within
seconds. *This validates the entire storage premise before anything is built on it.*

**Phase 1 — Read-only UI.**
Pages app behind Access. Customer list, customer detail, git-history timeline. Data
still hand-edited. Gets the model in front of real CSMs while it is cheap to change.

**Phase 2 — Writes.**
Commit-through-Worker with SHA-based optimistic concurrency, queue, schema validation
pre-commit. Create-new-customer scaffolding from `templates/`. This is the phase with
the real engineering risk; everything before it is plumbing.

**Phase 3 — The gate.**
`handoff.yaml`, blocking stage transitions, waivers with expiry, commitment
accept/reassign flow at transition. **This is the phase that delivers the actual
promise of the product** — do not let it slip behind dashboard polish.

**Phase 4 — Oversight.**
Sweeper on cron, health scoring, exception feed, leadership landing page, digests.

**Phase 5 — Hardening.**
Renewal planning, notification routing, bulk operations, integrations if a CRM
arrives later.

A reasonable cut line for a first real pilot is **end of Phase 3** — a system that
gates handoffs correctly is valuable even with a plain account list.

---

## 10. Risks and honest limits

| Risk | Mitigation / trigger to revisit |
|---|---|
| **Adoption.** A gate people resent gets routed around. | Waivers must be genuinely easy — the gate's job is to make skipping *visible*, not impossible. If waiver rate exceeds ~30%, the checklist is wrong, not the people. |
| **Scale ceiling.** Full reindex is O(all files). | Fine to a few hundred customers. Incremental per-file reindex from webhook payloads handles the rest. Past ~1000, reconsider §3. |
| **Row-level security.** Repo readers see everything. | App-layer enforcement only. If true isolation becomes a requirement, flip to database-of-record with git export. |
| **GitHub as a dependency.** Outage = writes stop. | Reads keep working from D1. Acceptable for an internal tool; a self-hosted git remote is the fallback if not. |
| **Schema migrations.** 50 directories to change at once. | Versioned schemas plus a migration script run as a PR — reviewable, revertible, and exactly the kind of change the file model handles *better* than a database. |
| **The classic failure mode** is building the dashboard first, because it demos well. | Phases 2 and 3 are the product. The dashboard is worthless on data nobody was forced to keep accurate. |

---

## 11. Open questions

1. **Tier definitions and cadence targets** — what *is* the expected touch frequency
   for a strategic account? Health scoring can't be calibrated without this.
2. **Health score weights** — needs tuning against real accounts; expect to be wrong
   the first time and plan to revise after the pilot.
3. **Handoff checklist content** — the template should be drafted by people who have
   personally watched a handoff fail, not derived from a generic CS playbook.
4. **Notification routing** — email is assumed; Slack/Teams if available.
5. **Retention and records policy** — git history is effectively permanent. Confirm
   that is acceptable for contract-adjacent data before go-live.
