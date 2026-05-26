# ShadowForge Cost Sentinel

**Sovereign Edge AI Cost Review & Business Modeling Tool** for Ghost Protocol deployments (targeted at COTA / transit agencies).

## Quick Start (Local + Live GCloud Connector)

### 1. Run the main app
```bash
cd cost-sentinel
npm install
npm run dev
```

Open http://localhost:5173

### 2. Start the live gcloud connector (for real billing + storage data)
From the `cost-sentinel` directory:

```bash
./start-gcloud-connector.sh
```

Or manually:
```bash
cd server
node server.mjs
```

**Prerequisites (one time):**
```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project gp-phantomvision-dev
```

The connector runs locally on port 8787 and uses your ADC. It never sends your billing data anywhere except directly to Google APIs.

In the app → **GCP Connect** tab:
- Click **"REFRESH — TRY LOCAL GCLOUD ADC"** for live SKU prices
- Click **"FETCH LIVE STORAGE"** for real bucket-level storage costs in `gp-phantomvision-dev`

Progress, pass/fail tracking, and local caching are built in.

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