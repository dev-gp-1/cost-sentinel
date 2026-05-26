# MASTER RUNBOOK: Casper.ghostprotocol.us Deployment (ShadowForge Cost Sentinel)

**Date:** 2026-05-26  
**Status:** Finalization & Validation phase (pre-full-prod; ~65% complete toward live protected casper.ghostprotocol.us)  
**Sovereign Architecture:** casper.ghostprotocol.us (CNAME) + Cloudflare Access (Zero Trust) + casper-proxy Worker (reverse proxy) + Cloud Run (gp-phantomvision-dev, --allow-unauthenticated)  
**Application ID:** 2e8771ca-7eca-4946-9caf-7373bc06f9ee  
**Policy ID (Admin Access):** 6e5a171f-71ef-49bf-a669-0ab8e69d5510  
**Account ID:** 79f3207a2cdac9f9996dc13a3dc80340  
**Zone ID (ghostprotocol.us):** c0f92fa6305538ebd978f8a553c04483  
**Service Token Client ID (example):** 00bc5effe82dd81aa686fcf3cc33cce7.access (secret required for non-interactive use)

This runbook consolidates status, exact production commands, validation, and fixes for the casper deployment. It is the single source of truth for ops.

## 1. Architecture Confirmation (Double-Check vs COTA_PROPOSAL / PRODUCTION_READINESS / Prior Docs)

The casper hostname + Cloudflare Access + Worker proxy + Cloud Run pattern **IS the correct sovereign architecture** as described across all workspace docs (README.md, deploy*.sh, setup-cloudflare-dns.sh, apply-*.sh, wire-*.sh, cloudflare-worker/README.md, deploy.yml header comments).

- **Why sovereign/secure:** Auth 100% at Cloudflare edge (Zero Trust policy). No IAM/IAP/custom OAuth in the Vue SPA or Cloud Run container. Worker is transparent passthrough + redirect rewrite. Cloud Run stays public (only Worker + Access see it). Local `server/` connector remains available on localhost:8787 for power users (GCP Connect tab).
- **Flow:** Browser → casper.ghostprotocol.us (Access challenge) → (auth'd) → casper-proxy Worker (proxies headers/body/redirects) → Cloud Run (nginx Vue SPA).
- **Matches prior:** All scripts and README explicitly call this the "recommended production setup", "best path for secure/auditable", "Worker in front for auth + Access; orange-cloud proxied CNAME". Alternative (direct ghs.googlehosted.com) noted as less preferred because it bypasses or complicates Access.
- **No contradictions found:** (COTA_PROPOSAL and PRODUCTION_READINESS files not present in workspace; references in README/next-steps align with this hybrid edge-protected model for COTA/transit agency use. No other architecture proposed in code/configs.)

Future: *.ghostprotocol.us via Worker routes + expanded Access apps or Load Balancer.

## 2. Current Status & Blockers (with Copy-Paste Fixes)

**Percent Complete:** ~65% (CF scripts improved + docs + curls prepared + GH prep; blocked on push + token scopes + clean Cloud Run deploy + Worker deploy + DNS/Access wiring with full-priv token).

**Live URLs (as of 2026-05-26; update post-deploy):**
- Cloud Run (intended primary target for Worker BACKEND_URL): Will be emitted by successful `gh workflow run` or `./deploy.sh` as `https://cost-sentinel-<sha>-uc.a.run.app` (us-central1, gp-phantomvision-dev). Currently broken revision exists (see below).
- Worker (current default / post-deploy): `casper-proxy.cost-sentinel.workers.dev` (or real `<subdomain>.workers.dev` after `wrangler deploy`). Add custom domain via dashboard or curl below.
- Public target: `https://casper.ghostprotocol.us` (will 302 to Access until wired + deployed).
- Broken current Cloud Run: Service "cost-sentinel" exists with failed revision using nonexistent tag `casper-direct-test-nonexistent-...` (image not found). No live URL.

**Blockers + Exact Fixes:**

1. **Git state: Key files (workflows, CF scripts) untracked locally, not on remote.** GH API reports 0 workflows. Deploy trigger impossible until pushed.
   - Copy-paste fix:
     ```
     cd /Users/deanbarrett/gp-firmware/cost-sentinel
     git status
     git add .github/workflows/deploy.yml .github/workflows/deploy-cloudrun.yml \
       apply-cloudflare-access-policy.sh apply-cloudflare-access.sh \
       deploy.sh deploy-to-cloudrun.sh setup-cloudflare-dns.sh wire-cloudflare-access-and-dns.sh \
       README.md MASTER_RUNBOOK.md
     git commit -m "feat(casper): OIDC-backed deploy.yml + full CF Access/Worker/DNS automation + improved apply detection + runbook for casper.ghostprotocol.us"
     git push origin main
     ```
   - After push, proceed to GH trigger (section 4).

2. **CF API token scope limits (observed Authentication errors on modify for DNS/Access).** Current token (cfat_...) insufficient for full edit on zones/access/apps/workers/domains. Use dashboard for some steps or mint higher-priv token.
   - Recommended: In Cloudflare dashboard → My Profile → API Tokens → Create Token with:
     - Account:Access:Apps and Policies:Edit
     - Zone:DNS:Edit (for ghostprotocol.us)
     - Account:Workers Scripts:Edit (for custom domains)
     - (or use full "Edit" template scoped to account + zone).
   - Then re-run applies with the higher-priv token.
   - Service token for runtime bypass: Create in Zero Trust → Service Tokens (Client ID above; secret retrieved from dashboard).

3. **Cloud Run not cleanly deployed.** Failed test revision blocks.
   - Fix: Use GH Actions (after push) or local:
     ```
     ./deploy.sh
     # or
     gcloud run deploy cost-sentinel --image ... (clean tag) --allow-unauthenticated ...
     ```
   - Then capture the real URL for Worker secret + DNS.

4. **Worker not yet deployed with real BACKEND_URL + custom domain.**
   - See section 5.

5. **DNS/Access not fully wired (or partially from prior partial run).**
   - Use exact curls in section 3 with full-priv token. Re-apply policy script (now has robust detection + KNOWN_APP_ID fallback).

**Script Improvements Made (apply-cloudflare-access-policy.sh):**
- Robust app detection (now checks self_hosted_domains, domains array, multiple name contains for "casper"/"cost sentinel"/"admin ui", plus exact matches). Prevents false-fail create on re-runs.
- Added KNOWN_APP_ID=2e8771ca-7eca-4946-9caf-7373bc06f9ee fallback + config.
- Hardcoded known IDs + policy notes in header.
- (Old apply-cloudflare-access.sh left as-is; it has stale policy JSON — prefer the -policy.sh variant.)

## 3. Exact Production Curl Commands (deploy-07/09 DNS / Worker Domain / Access) — Use Full-Priv Token

**Prerequisites:** Export or replace:
- TOKEN= (higher-priv CF API token with full edit scopes; or the original cfat if it has write on some)
- CF_ACCOUNT_ID=79f3207a2cdac9f9996dc13a3dc80340
- CF_ZONE_ID=c0f92fa6305538ebd978f8a553c04483
- CF_WORKER_TARGET="casper-proxy.cost-sentinel.workers.dev"   # Update to real after wrangler deploy + dashboard check
- Real Cloud Run URL (from successful deploy, e.g. https://cost-sentinel-abc123-uc.a.run.app )

**A. Set Worker BACKEND secret (after Cloud Run deploy, before/after wrangler deploy):**
```bash
cd /Users/deanbarrett/gp-firmware/cost-sentinel/cloudflare-worker
npx wrangler secret put BACKEND_URL
# Paste: https://cost-sentinel-<LIVE>-uc.a.run.app
npx wrangler deploy
```
(Or edit [vars] in wrangler.toml temporarily.)

**B. DNS: Proxied CNAME for casper.ghostprotocol.us → Worker (orange cloud ON for Access + proxy)**
```bash
# Create (or use existing ID from list for PUT)
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "casper",
    "content": "'"${CF_WORKER_TARGET}"'",
    "ttl": 300,
    "proxied": true,
    "comment": "Cost Sentinel → Worker (casper-proxy) with Cloudflare Access protection [casper.ghostprotocol.us]"
  }' | jq .

# Idempotent update example (first GET the ID):
# DNS_ID=$(curl -s ... | jq -r '.result[0].id')
# Then PUT to /dns_records/${DNS_ID} with same payload.
```

**C. DNS: For *.ghostprotocol.us (wildcard support - note: limited; Access apps are per-hostname; prefer Worker Routes or LB for full wildcard)**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "*",
    "content": "'"${CF_WORKER_TARGET}"'",
    "ttl": 300,
    "proxied": true,
    "comment": "Wildcard for ghostprotocol.us subdomains via casper-proxy Worker"
  }' | jq .
```
- Follow up with Worker Route in wrangler.toml or dashboard: `*.ghostprotocol.us/*`
- Or create separate Access apps per sub (e.g. casper-staging.ghostprotocol.us).

**D. Add Custom Domain to Worker (casper-proxy) via API (if token supports Workers Scripts:Edit; otherwise use dashboard)**
```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/domains" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "hostname": "casper.ghostprotocol.us",
    "service": "casper-proxy",
    "zone_id": "'"${CF_ZONE_ID}"'"
  }' | jq .
```
- Response will include cert status. Cloudflare auto-creates supporting DNS if needed (but explicit CNAME above ensures control).
- List existing: `GET /accounts/${CF_ACCOUNT_ID}/workers/domains`
- Alternative (preferred if scope issues): Dashboard → Workers & Pages → casper-proxy → Triggers → Custom Domains → Add "casper.ghostprotocol.us"

**E. Re-apply / update Access App + Policy (uses improved script with IDs + detection):**
```bash
# With full-priv TOKEN or export KNOWN_APP_ID
KNOWN_APP_ID=2e8771ca-7eca-4946-9caf-7373bc06f9ee \
CF_WORKER_TARGET="${CF_WORKER_TARGET}" \
./apply-cloudflare-access-policy.sh "${TOKEN}"
```
- This will find by ID fallback or improved selector, then PUT the exact expanded policy (or create if missing).
- Policy JSON (exact expanded):
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
- Direct policy update curl (if script fails on scopes):
  Use PUT to `/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies/${POLICY_ID}` with above JSON (POLICY_ID=6e5a171f-71ef-49bf-a669-0ab8e69d5510).

**F. (Optional) Cloud Run native domain mapping (alternative path, less preferred):**
```bash
gcloud run domain-mappings create \
  --service=cost-sentinel \
  --domain=casper.ghostprotocol.us \
  --region=us-central1 \
  --project=gp-phantomvision-dev
```
Then DNS to ghs.googlehosted.com (proxied=false) + layer Access separately.

After all: Visit https://casper.ghostprotocol.us → should hit Access login with allowed identities.

## 4. GitHub Actions Trigger (OIDC-Backed deploy.yml for Casper)

**Current State:** Cannot trigger (workflows not present on remote; 404 on dispatch). See blocker fix above (git add/commit/push first).

**Exact gh CLI commands (run after push + ensure repo secrets set):**
```bash
# 1. (After push)
gh workflow run deploy.yml --repo dev-gp-1/cost-sentinel --ref main

# With input:
gh workflow run deploy.yml --repo dev-gp-1/cost-sentinel --ref main \
  --field force_rebuild=true

# Monitor:
gh run list --repo dev-gp-1/cost-sentinel --limit 3
gh run watch <RUN_ID> --repo dev-gp-1/cost-sentinel
```
- Requires repo secrets (from deploy.yml header):
  - GCP_WORKLOAD_IDENTITY_PROVIDER (e.g. projects/431115644565/locations/global/workloadIdentityPools/github/providers/github or the full one)
  - GCP_SERVICE_ACCOUNT= github-actions-deployer@gp-phantomvision-dev.iam.gserviceaccount.com (or github-actions@...)

**GitHub UI Steps (manual dispatch):**
1. Go to https://github.com/dev-gp-1/cost-sentinel/actions
2. In left sidebar, select "Deploy to Cloud Run (Artifact Registry)" (the deploy.yml one with OIDC + custom domain notes).
3. Click "Run workflow" (top right).
4. Select branch: main.
5. (Optional) Check "force_rebuild".
6. Click green "Run workflow".
7. Watch logs: Look for "Deploy to Cloud Run" step output for the live CLOUD_RUN_URL.
8. Use that URL for Worker secret + any DNS overrides.
9. Post-run: Run the CF apply + DNS curls (section 3) + Worker custom domain.

**OIDC Notes:** Workflow uses workload identity (no long-lived keys). If secrets missing, falls back may fail — set them in Settings → Secrets and variables → Actions.

Alternative older workflow (deploy-cloudrun.yml) also present but deploy.yml is the full-featured one.

## 5. Worker + Cloud Run Wiring + Post-Deploy

- Deploy Worker (after secret):
  ```
  cd cloudflare-worker
  npm install
  npx wrangler secret put BACKEND_URL   # The live Cloud Run URL (two targets: primary deploy one + any stable custom)
  npx wrangler deploy
  ```
- Then custom domain curl or dashboard (section 3.D).
- Re-run apply policy script (section 3.E) — now safe due to fixes.

Update BACKEND_URL secret after every Cloud Run redeploy (new URL usually generated).

## 6. Validation Prep

**Small test script (curl-based, can be saved as scripts/validate-casper.sh or run inline):**
```bash
#!/bin/bash
# Casper.ghostprotocol.us Access + Proxy Validation
set -euo pipefail
URL="https://casper.ghostprotocol.us"
echo "=== Testing $URL (expect Cloudflare Access redirect) ==="
curl -sI "$URL" | head -20
echo ""
echo "Headers above should include: HTTP/2 302, location containing cloudflareaccess.com or similar, cf-ray, server: cloudflare."
echo "After successful login with allowed email (e.g. dean@ghostprotocol.us), expect 200 + Vue HTML (title 'ShadowForge Cost Sentinel' or similar)."
echo ""
echo "=== Quick authenticated test (if you have CF-Access-Client-* service token) ==="
echo "# curl -H 'CF-Access-Client-Id: 00bc5effe82dd81aa686fcf3cc33cce7.access' -H 'CF-Access-Client-Secret: <SECRET>' -I $URL"
```

**Post-deploy Browser Tests for Vue App:**
- Visit https://casper.ghostprotocol.us (login via allowed email/domain).
- **Business Models tab:** Verify two side-by-side models render (Hardware Markup vs SaaS/Managed), LTV/COGS/margin waterfall calcs, inputs editable, export buttons.
- **Simulator tab:** Run scenarios, sliders update live, charts (Chart.js) responsive.
- **GCP Connect tab:** Buttons for "Connect Live", progress % , passed/pulled/saved/failed counters. (Requires local `./start-gcloud-connector.sh` running on your machine; browser talks to localhost:8787.)
- Check SPA routing: deep links, refresh (nginx fallback).
- No CORS or redirect loop errors.
- Test with disallowed email: should be blocked at Access wall.
- Mobile/responsive, dark/light if themed.
- (Optional) Check headers in devtools: cf-access-jwt-assertion present, x-forwarded-* from Worker.

**Automated/CI extension idea:** Add Playwright or simple curl + grep to future GH workflow.

## 7. References & Next

- Primary script: ./apply-cloudflare-access-policy.sh (now hardened)
- Worker: cloudflare-worker/ (wrangler.toml, src/index.ts full proxy logic)
- GH: .github/workflows/deploy.yml (full OIDC + AR + custom domain notes)
- Full prior context: README.md (appended), setup-*.sh, deploy*.sh
- Token scope remediation + higher priv: Cloudflare dashboard API Tokens (see blocker 2)
- After live: Monitor Access logs in Zero Trust → Logs. Add Logpush for Worker if needed.

**Rollback:** Update DNS to DNS-only or delete Access app/policy; redeploy prior revision in Cloud Run.

Update this runbook after each milestone (push, first successful GH deploy, first successful Access-protected curl/browser load).

---
**End of Casper.ghostprotocol.us Master Runbook.** Run aggressively to 100%.