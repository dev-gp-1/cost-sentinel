# Optional Tiny GCP Billing Backend Stub (for Cost Sentinel)

This folder contains a minimal server you can run locally to demonstrate live SKU listing using the official Google Cloud Billing API with Application Default Credentials (ADC).

## Why?
The main Cost Sentinel app is 100% client-side (beautiful PapaParse CSV importer + rich mock). This stub shows the path to real-time price catalog lookup from GCP without ever sending your billing data anywhere.

## Quick Start for gp-phantomvision-dev (Phantom Vision Dev)

**Target Project:**
- Project ID: `gp-phantomvision-dev`
- Project Number: `431115644565`

### 1. Install dependencies (from project root)
```bash
npm install @google-cloud/billing @google-cloud/storage
```

### 2. Authenticate with ADC (critical)
```bash
gcloud auth application-default login
```

### 3. (Recommended) Set the correct project
```bash
gcloud config set project gp-phantomvision-dev
```

### 4. Run the connector
```bash
cd server
node server.mjs
```

You should see:
```
Cost Sentinel GCP connector listening on http://localhost:8787
Targeting project: gp-phantomvision-dev (431115644565)
```

### 5. Available Endpoints

- `GET /api/skus` — Live SKU pricing from Cloud Billing Catalog (Storage, AI, Compute, etc.)
- `GET /api/storage-costs` — Real storage costs + bucket breakdown for `gp-phantomvision-dev`
- `GET /api/project-info` — Confirms the target project

### 6. Use in Cost Sentinel
In the running app (GCP Connect tab), the **"REFRESH — TRY LOCAL GCLOUD ADC"** button will now pull real data when this server is running.

---

**Note on actual billing costs:**
The Catalog API gives *list prices*. For your real incurred costs (what you actually paid for storage, Vertex, etc.), the most reliable method is enabling **Cloud Billing export to BigQuery** on the billing account. The connector above can be extended later to query that BigQuery dataset directly.

All calls use your local ADC credentials — nothing is sent anywhere else.
