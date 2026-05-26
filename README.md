# ShadowForge Cost Sentinel

**Sovereign Edge AI Cost Review & Business Modeling Tool** for Ghost Protocol deployments (targeted at COTA / transit agencies).

## Architecture (Production on Cloudflare + Cloud Run)

**Recommended production setup (what we're building toward):**

- **Frontend**: Deployed to Cloud Run (containerized with nginx) in project `gp-phantomvision-dev`.
- **Custom Domain**: `casper.ghostprotocol.us` (and eventually `*.ghostprotocol.us` routes) managed on Cloudflare.
- **Auth**: Cloudflare Access (the exact "Admin Access" policy you provided – allowing ghostprotocol.us, cota.com, huggaretreats.com domains + specific emails).
- **Proxy Layer**: Cloudflare Worker (`casper-proxy`) in front of Cloud Run for clean routing and future extensibility.
- **Live Data Connector**: The powerful local `server/` tool (uses your ADC) remains available for power users who run it locally and connect the hosted UI to `localhost:8787`.

This gives you:
- Beautiful hosted experience at a real domain.
- Enterprise-grade auth via Cloudflare Access (no custom auth code needed yet).
- Full power of the local gcloud billing/storage connector when needed.
- All the advanced cost modeling, business models (Hardware Markup vs SaaS), LTV, COGS, margin waterfall, etc.

### Cloudflare Access + Worker Protection (How It Ties to Cloud Run)

**Exact flow (production):**

1. User visits `https://casper.ghostprotocol.us`
2. Cloudflare Access (the "Admin Access" policy) intercepts the request.
   - Policy allows:
     - Any user whose email domain is one of: `ghostprotocol.us`, `cota.com`, `huggaretreats.com`
     - Plus explicitly listed individual emails (exact list from the policy curl you provided).
   - Everyone else sees a Cloudflare Access login wall (SSO, magic link, or IdP).
3. Only after successful authentication does the request reach the **Cloudflare Worker** (`casper-proxy`).
4. The Worker (see `cloudflare-worker/src/index.ts`) performs a transparent reverse proxy to your Cloud Run service URL.
   - The Cloud Run deployment itself uses `--allow-unauthenticated` (or equivalent). No IAM, IAP, or auth code lives on the origin.
   - The Worker passes through headers, method, body, cookies, etc.
5. Cloud Run serves the Vue SPA (or API responses). The local connector (`server/`) is still usable from the browser via localhost:8787 when the user runs it on their machine.

**Why this architecture?**
- Zero changes required in the Vue frontend or the Cloud Run container.
- Auth is 100% at the edge (Cloudflare Zero Trust). Extremely strong, auditable, and supports future features (device posture, WARP, etc.).
- The Worker is the single place where you can later add logging, rate limiting, JWT validation of the `cf-access-jwt-assertion` header, or canary routing.
- DNS is a simple proxied CNAME (or custom domain attached to the Worker). The orange cloud + Access Application on the hostname does the heavy lifting.

**Automation scripts (run these after the Worker is deployed):**
- `./setup-cloudflare-dns.sh` (set `MODE=worker` + `WORKER_TARGET`)
- `./apply-cloudflare-access-policy.sh <YOUR_CLOUDFLARE_API_TOKEN>` — this is the authoritative script that:
  - Creates/updates the Access Application for `casper.ghostprotocol.us`
  - Idempotently applies (or updates) the exact "Admin Access" policy using the Cloudflare API
  - Can also create the proxied DNS record pointing at the Worker

After running the policy script, simply add the custom domain to the Worker in the dashboard (or via routes). Auth is live.

## Quick Start (Local Development)

```bash
cd cost-sentinel
npm install
npm run dev
```

Open http://localhost:5173

For live gcloud data from `gp-phantomvision-dev`:
```bash
./start-gcloud-connector.sh
```

Then in the app → GCP Connect tab use the live buttons. The progress tracking (percentage + passed/pulled/saved/failed) will show in real time. Data is cached in localStorage for 5 minutes.

## Production Deployment (Cloud Run + Cloudflare + Access)

Full automation is being wired right now using:
- GitHub Actions (push to main → build & deploy to Cloud Run via gcloud)
- Cloudflare Worker as the auth-aware proxy
- Cloudflare Access policy (the exact one you provided)
- Custom domain `casper.ghostprotocol.us` (with support for broader *.ghostprotocol.us later)

Once the Worker and deployment workflows are live, the flow is:

1. Push to GitHub → GitHub Actions builds & deploys the container to Cloud Run (`gp-phantomvision-dev`).
2. Run `./apply-cloudflare-access-policy.sh <TOKEN>` (and `./setup-cloudflare-dns.sh` with `MODE=worker`).
   - This creates the Access Application + applies the **exact** "Admin Access" policy (domains + specific emails).
   - It also wires the proxied DNS record to the Worker.
3. Attach the custom domain `casper.ghostprotocol.us` to the deployed Worker.
4. Authenticated users (per the policy) reach the Worker → Cloud Run. Everyone else is blocked at the edge.

The Cloud Run service stays `--allow-unauthenticated`. All protection, SSO, and audit logging live in Cloudflare Access + the lightweight Worker proxy. No code changes in `src/` or the container are required.

## Architecture (Best Decision)

**Hybrid model (recommended):**

- **Frontend (Vue app)**: Can be deployed as a static webapp (Firebase Hosting, Cloud Storage + CDN, etc.) inside `gp-phantomvision-dev`.
- **Connector (`server/`)**: Stays as a local CLI tool you run on your machine.

**Why this is better than a fully hosted webapp right now:**

1. **Security** — Billing data is extremely sensitive. Using your local ADC means the data never touches a third-party server.
2. **Simplicity** — No complex OAuth / IAP / delegated permissions needed for the connector.
3. **Speed of iteration** — You can run the full tool immediately without deploying anything.

### Deploying the Frontend Only (Recommended Path)

If you want a nice hosted version of the UI:

```bash
# From cost-sentinel/
npm run build

# Option A: Firebase Hosting (easiest if you're already using Firebase for the POC)
firebase init hosting
firebase deploy

# Option B: Google Cloud Storage + Cloud CDN (pure GCP)
gsutil mb -p gp-phantomvision-dev gs://cost-sentinel.phantomvision.dev
gsutil -m rsync -r dist gs://cost-sentinel.phantomvision.dev
# Then set up a load balancer + SSL + CDN
```

Users would still run the local connector on their machine and the hosted UI would connect to `localhost:8787` when available.

We can add a "Launch Local Connector" helper button later if desired.

## What the Tool Currently Models

- Full project costs (hardware, cabling, human installers, logistics, installation budgets)
- COGS overhead (travel, IT infra for management, ML model lifecycle, support)
- Two business models side-by-side:
  - Hardware + Markup
  - SaaS / Managed Service (with LTV, churn, payback)
- Margin waterfall
- Live GCP connector pulling real SKU prices + storage costs from your project
- Sovereign savings analysis (on-device vs cloud AI)

## Project Structure

- `src/` — Vue 3 app (main UI)
- `server/` — Lightweight local Node connector (Hono) that talks to Billing + Storage APIs via ADC
- `start-gcloud-connector.sh` — Convenience launcher

## Next Steps / Integration Ideas

- Deploy the frontend statically into `gp-phantomvision-dev`
- Wire live storage/SKU numbers directly into the cost model (auto-populate certain line items)
- Add "Export scenario to COTA proposal" that includes live cloud costs
- Later: optional hosted connector behind IAP if the team wants a fully browser-only experience

This hybrid approach gives you the best of both worlds right now: a beautiful hosted dashboard + secure local access to real billing data.

---

## Production Hosting: Cloudflare Worker Reverse Proxy (Recommended for Secure Access)

For the highest security posture (especially when exposing the cost model to a broader team), deploy the Cloud Run container behind a **Cloudflare Worker** that provides:

- Custom domain (`casper.ghostprotocol.us`)
- **Cloudflare Access / Zero Trust** (SSO, email allowlisting, audit logs)
- Global edge caching + WAF

See the full production setup in:

```
cloudflare-worker/
├── src/index.ts       # Full TypeScript reverse proxy (header passthrough, redirect rewriting, SPA support)
├── wrangler.toml
├── package.json
└── README.md          # Complete deployment + Access integration guide
```

### Quick Commands

```bash
cd cloudflare-worker
npm install
npx wrangler secret put BACKEND_URL     # Paste your Cloud Run URL
npx wrangler deploy
```

Then protect the route with a Zero Trust Access Application.

The Worker is **completely transparent** to the Vue SPA (nginx SPA fallback on Cloud Run continues to work perfectly).

This is currently the best path for a secure, auditable, production deployment of Cost Sentinel.

---

## Casper.ghostprotocol.us Production Status (Finalization - 2026-05-26)

**Current IDs (from successful apply run before token scope limits hit modify ops):**
- Application ID: `2e8771ca-7eca-4946-9caf-7373bc06f9ee`
- Policy ID (Admin Access): `6e5a171f-71ef-49bf-a669-0ab8e69d5510`

**Expanded Admin Access Policy JSON (exact, in apply-cloudflare-access-policy.sh):**
```json
{
  "name": "Admin Access",
  "decision": "allow",
  "include": [
    { "email_domain": { "domain": "ghostprotocol.us" } },
    { "email_domain": { "domain": "cota.com" } },
    { "email_domain": { "domain": "huggaretreats.com" } },
    { "email": { "email": "d.barrett@ghostprotocol.us" } },
    { "email": { "email": "dean.barrett.86@gmail.com" } },
    { "email": { "email": "burkegw@gmail.com" } },
    { "email": { "email": "dean@ghostprotocol.us" } }
  ],
  "exclude": [],
  "require": []
}
```

**Cloud Run targets (update after successful deploy):**
- Primary (from GH Actions / deploy.sh): The live `https://cost-sentinel-<REV>-uc.a.run.app` (output in deploy logs). Currently a broken revision exists from test tag (image not found); clean deploy required.
- Worker secret target: Set via `wrangler secret put BACKEND_URL` to the above.

**Key scripts (run after Worker deploy + real Cloud Run URL):**
- `CF_WORKER_TARGET="casper-proxy.<your-sub>.workers.dev" ./apply-cloudflare-access-policy.sh <TOKEN>`
- `./setup-cloudflare-dns.sh` (MODE=worker) or manual curls below.
- Worker: `cd cloudflare-worker && npx wrangler secret put BACKEND_URL && npx wrangler deploy`

**Validation (see MASTER_RUNBOOK.md for full):**
- `curl -I https://casper.ghostprotocol.us` → Expect 302 to Cloudflare Access login (or 200 after auth).
- Browser: After login, test Vue tabs: Business Models (two side-by-side), Simulator, GCP Connect (live connector buttons).

**Blockers:**
- Workflows + CF scripts not yet pushed to remote (untracked in git) → GH Actions cannot trigger until `git add/commit/push`.
- Current CF API token has limited scopes (Auth errors on DNS/Access modify) → Use full-priv token or dashboard for DNS + Worker custom domain.
- Cloud Run service "cost-sentinel" exists but failed (bad image tag); needs clean deploy via GH or ./deploy.sh.

See MASTER_RUNBOOK.md (new) for exact production curl commands, token scope notes, and post-deploy checklist.
See apply-cloudflare-access-policy.sh (improved app detection + KNOWN_APP_ID fallback).
