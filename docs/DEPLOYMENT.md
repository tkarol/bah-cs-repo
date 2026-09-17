# Deploying to Cloudflare

**Status:** runbook · **Target:** one Worker serving both the API and the app

Everything here fits inside free tiers at this portfolio size. The one thing you
must have is a **domain on Cloudflare** — see the warning in step 4.

---

## What gets deployed

A single Worker. It serves the built React app from static assets and handles
`/api/*` with the same script:

```toml
[assets]
directory = "../web/dist"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

That is why there is no separate Pages project. One origin means no CORS, no
route juggling between two services, one deploy, and Cloudflare Access protecting
the app and the API together rather than only one of them.

Nothing else is provisioned. No database, no KV, no R2, no queue — the
repository is the backend.

---

## 1. Prerequisites

| | |
|---|---|
| Cloudflare account | free plan is enough |
| A domain on Cloudflare | required for Access — step 4 explains why |
| GitHub repository | this one, with Actions enabled |
| Node 22 | |
| Wrangler **4+** | `npm install` provides it. Wrangler 3 rejects this config: the array form of `run_worker_first` that routes `/api/*` to the script landed in v4. |

```bash
npx wrangler login
```

---

## 2. Create the GitHub App

The Worker commits as a GitHub App, never a personal token. The token is minted
per request inside the Worker and never reaches the browser.

1. **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.**
2. Name it (e.g. `cs-platform-writer`). Homepage URL can be the repo.
3. Uncheck **Webhook → Active** — the Worker does not receive webhooks.
4. **Repository permissions:**
   - `Contents`: **Read and write** (it commits customer files)
   - `Metadata`: **Read-only** (mandatory)
   - Everything else: No access.
5. **Where can this app be installed:** only this account.
6. Create it, then note the **App ID**.
7. **Generate a private key.** A `.pem` downloads.
8. **Install App** → this repository only. The URL of the resulting settings page
   ends in the **Installation ID**: `.../installations/<INSTALLATION_ID>`.

### Convert the private key — this step is not optional

GitHub issues **PKCS#1** (`-----BEGIN RSA PRIVATE KEY-----`). The Web Crypto API
in Workers only imports **PKCS#8** (`-----BEGIN PRIVATE KEY-----`). Skip this and
every write fails with an opaque import error.

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in your-app.private-key.pem \
  -out github-app.pk8.pem

head -1 github-app.pk8.pem   # must read: -----BEGIN PRIVATE KEY-----
```

---

## 3. First deploy

Set the repository in `packages/worker/wrangler.toml`:

```toml
[vars]
GITHUB_REPO = "your-org/your-repo"
GITHUB_BRANCH = "main"
```

Then build the app and deploy the Worker:

```bash
npm install
npm run index      # generate index.json so the app has data to show
npm run deploy     # builds the web app, then deploys the Worker with it
```

Check it bundles before you push anything real:

```bash
npx wrangler deploy --dry-run -c packages/worker/wrangler.toml
```

It should list the `ASSETS` binding and read the files from `packages/web/dist`.
If it reports `Expected "assets.run_worker_first" to be of type boolean`, you are
on Wrangler 3 — upgrade to 4.

Load the `*.workers.dev` URL it prints. Static pages render; `/api/*` returns
**500 “Access is not configured on this Worker.”** That is correct — the Worker
**fails closed** when Access is unset rather than serving customer data to
anyone who finds the URL. Step 4 fixes it.

Now set the secrets:

```bash
npx wrangler secret put GITHUB_APP_ID           -c packages/worker/wrangler.toml
npx wrangler secret put GITHUB_INSTALLATION_ID  -c packages/worker/wrangler.toml
npx wrangler secret put GITHUB_PRIVATE_KEY      -c packages/worker/wrangler.toml < github-app.pk8.pem
```

The last one reads the file directly — pasting a multi-line PEM at a prompt
mangles the newlines.

---

## 4. Put Cloudflare Access in front

> **You need a domain on Cloudflare for this.** Access protects hostnames in a
> zone you control. A bare `*.workers.dev` subdomain is Cloudflare's hostname,
> not yours, so you cannot put an Access policy on it. Deploying without Access
> means the app is on the public internet with no authentication — the Worker
> refuses to serve `/api/*` in that state, by design.

**a. Attach a custom domain.** In `wrangler.toml`:

```toml
routes = [
  { pattern = "cs.yourcompany.com", custom_domain = true }
]
```

Redeploy (`npm run deploy`).

**b. Create the Access application.** Cloudflare dashboard → **Zero Trust** →
**Access → Applications → Add an application → Self-hosted**:

- Application domain: `cs.yourcompany.com`
- Session duration: 24 hours is reasonable
- Add an identity provider (Entra ID / Okta / Google Workspace — whatever your
  organisation already uses)
- Policy: Allow → *Emails ending in* `@yourcompany.com`, or a specific group

**c. Copy the Application Audience (AUD) tag** from the application's overview,
and your team domain (`yourteam.cloudflareaccess.com`) from Zero Trust →
Settings → Custom Pages.

**d. Put both in `wrangler.toml` and redeploy:**

```toml
[vars]
ACCESS_AUD = "a1b2c3…the long hex string"
ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
```

```bash
npm run deploy
```

Visit `cs.yourcompany.com`. You should be bounced to your identity provider,
and land back on the portfolio page.

> Access is free up to **50 users**. That is counted in staff accounts, not
> customers — it is the first free tier this system would realistically
> outgrow, so track it deliberately.

---

## 5. Add people

Roles live in `config/roles.yaml`, so granting someone leadership rights is a
reviewable commit rather than a console click nobody can audit:

```yaml
default_role: csm
users:
  - email: someone@yourcompany.com
    role: leadership
```

Anyone Access lets in who is not listed gets `default_role`. Access controls
*who can sign in*; this file controls *what they can do once inside*.

---

## 6. Turn on the automation

The three workflows need nothing but Actions being enabled, and they already
request `contents: write`:

| Workflow | Trigger | Does |
|---|---|---|
| `index.yml` | push to `customers/**` | Rebuilds `index.json`, commits it |
| `sweep.yml` | 07:00 UTC daily, 12:00 UTC Monday | Recomputes health, appends the snapshot, sends the digest |
| `validate.yml` | every PR and push to main | Schema validation, typecheck, tests, stale-index check |

If your default branch protects direct pushes, give the indexer a path through
it — the nightly sweep must be able to commit `index.json` and `history/`, or
time-based exceptions will never appear.

**Optional — send the weekly digest somewhere.** Add a repository secret
`DIGEST_WEBHOOK` (a Teams or Slack incoming webhook URL). Without it the digest
still runs and writes to the Actions run summary; it just is not pushed
anywhere. Email is not wired up: it needs SMTP credentials this repo does not
have, and a webhook is the free path that works today.

---

## 7. Deploy from CI

Create a Cloudflare API token (**My Profile → API Tokens → Create → Edit
Cloudflare Workers**), add it as the repository secret `CLOUDFLARE_API_TOKEN`,
and `.github/workflows/deploy.yml` takes over from there.

That workflow deliberately ignores pushes that only touch `customers/**`,
`index.json`, `exceptions.json` and `history/` — otherwise every nightly sweep
would redeploy the Worker for a data change that does not affect the code.

---

## Verifying it actually works

```bash
# 1. Signed out, in a private window — should redirect to your IdP, not render.
open https://cs.yourcompany.com

# 2. Signed in: who am I, and what role did roles.yaml give me?
#    (Run in the browser console on the deployed app, so the Access cookie is sent.)
await (await fetch('/api/me')).json()

# 3. The gate is real. Try to advance an account with an unmet gate:
await (await fetch('/api/customers/atlas-logistics/transition', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ to: 'onboarding' }),
})).json()
# → 422 with a blockers array naming each unmet item.
```

Then make one real edit through the UI and confirm the commit appears in the
repository, and that `index.json` is rebuilt by the Action within a minute or so.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `500 Access is not configured` | `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` still empty. Working as designed — it fails closed. |
| `401 Access token was issued for a different application` | The AUD tag does not match the Access app. Recopy it. |
| Writes fail with a key import error | The private key is still PKCS#1. Convert it (step 2). |
| `502 Upstream repository error` | App ID, Installation ID, or the App's `Contents: write` permission. |
| `409 … changed since you loaded it` | Someone else edited the same file. Intended — reload and reapply. |
| Dashboard is stale after an edit | The index Action has not finished. Single-customer pages read the files directly and are always current. |
| The index never rebuilds | Branch protection is blocking the Action's commit (step 6). |

---

## Costs

| Service | Free tier | This workload |
|---|---|---|
| Workers | 100k requests/day | An internal tool for a handful of people |
| Workers static assets | included | ~300 KB of built app |
| Cloudflare Access | 50 users | **the ceiling to watch** |
| GitHub Actions | ~2,000 min/month private | These jobs run in seconds |
| GitHub repository | free | Text files |

Expected spend: **$0**, plus whatever the domain costs. Verify current free-tier
terms before committing — they change, and nothing here is hard to move if they do.
