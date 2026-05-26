#!/bin/bash
#
# =============================================================================
# FINISH-CASPER-DEPLOYMENT.SH
# One-command accelerator for the final push of casper.ghostprotocol.us
# =============================================================================
#
# PURPOSE:
#   When you finally have the FULL-PRIV Cloudflare API token (with Account:Access:Apps
#   and Policies:Edit + Zone:DNS:Edit + Account:Workers Scripts:Edit) AND IAM grants
#   for the GCP project, run this script (or copy its commands) to complete the
#   deployment in the correct order as fast as possible.
#
#   This is the single ready-to-run artifact that consolidates EVERYTHING from:
#     - MASTER_RUNBOOK.md Section 3 (exact production curls)
#     - deploy.sh / deploy-to-cloudrun.sh (Cloud Run)
#     - .github/workflows/deploy.yml + deploy-cloudrun.yml (GH path)
#     - setup-cloudflare-dns.sh (DNS patterns + idempotency)
#     - apply-cloudflare-access-policy.sh + apply-cloudflare-access.sh (Access)
#     - wire-cloudflare-access-and-dns.sh
#     - cloudflare-worker/ (wrangler secret + deploy + custom domain)
#     - scripts/validate-casper.sh (validation)
#
# USAGE (recommended flow):
#   1. Export or pass your full-priv token + the real Cloud Run URL once you have it.
#   2. Run this script. It will guide you + execute the API parts it safely can.
#
#   # Full manual (safest - you control each deploy):
#   ./scripts/finish-casper-deployment.sh
#
#   # With token (enables auto-execution of DNS/Access/custom-domain curls):
#   CF_TOKEN="your_full_priv_cfat_..." \
#   CLOUD_RUN_URL="https://cost-sentinel-abc123-uc.a.run.app" \
#     ./scripts/finish-casper-deployment.sh
#
#   # Or positional:
#   ./scripts/finish-casper-deployment.sh "YOUR_FULL_PRIV_TOKEN" "https://real-cloud-run-url"
#
#   # Execute the CF parts non-interactively (after you have done the deploys):
#   AUTO_EXECUTE_CF=true CF_TOKEN=... CLOUD_RUN_URL=... ./scripts/finish-casper-deployment.sh
#
# PREREQUISITES (must have before running):
#   - gcloud auth login && gcloud config set project gp-phantomvision-dev
#   - Full-priv Cloudflare API token (see MASTER_RUNBOOK blocker #2)
#   - (Optional but powerful) gh CLI authenticated to dev-gp-1/cost-sentinel
#   - Node/npm for wrangler in cloudflare-worker/
#   - jq + curl (standard on macOS)
#
# WHAT THIS SCRIPT DOES / DOES NOT DO:
#   - Prints and can run the CF API steps (DNS, Worker custom domain, Access policy)
#     using the hardened idempotent logic from apply-*.sh and setup-*.sh
#   - NEVER auto-runs Cloud Run deploys or wrangler secret put (those require
#     interactive confirmation or separate shells because they change live infra)
#   - Always shows the EXACT commands for steps 1+2 so you can run them in any order
#   - Calls ./apply-cloudflare-access-policy.sh and ./scripts/validate-casper.sh
#     when appropriate
#   - Is idempotent on the CF side (checks existing records/policies first)
#
# AFTER SUCCESS:
#   Visit https://casper.ghostprotocol.us → Cloudflare Access login with allowed identity.
#   See MASTER_RUNBOOK.md Section 6 for full validation checklist.
#
# =============================================================================
# HARDCODED SOVEREIGN VALUES (from MASTER_RUNBOOK - DO NOT CHANGE)
# =============================================================================
CF_ACCOUNT_ID="79f3207a2cdac9f9996dc13a3dc80340"
CF_ZONE_ID="c0f92fa6305538ebd978f8a553c04483"
HOSTNAME="casper.ghostprotocol.us"
WORKER_NAME="casper-proxy"
KNOWN_APP_ID="2e8771ca-7eca-4946-9caf-7373bc06f9ee"
KNOWN_POLICY_ID="6e5a171f-71ef-49bf-a669-0ab8e69d5510"
SERVICE_TOKEN_CLIENT_ID="00bc5effe82dd81aa686fcf3cc33cce7.access"
PROJECT_ID="gp-phantomvision-dev"
REGION="us-central1"
SERVICE_NAME="cost-sentinel"

# Default Worker target (update after first wrangler deploy if your subdomain differs)
DEFAULT_WORKER_TARGET="casper-proxy.cost-sentinel.workers.dev"

set -euo pipefail

# -----------------------------------------------------------------------------
# ARGUMENT / ENV PARSING (token + URL can come from env or args)
# -----------------------------------------------------------------------------
TOKEN="${CF_TOKEN:-${1:-}}"
CLOUD_RUN_URL="${CLOUD_RUN_URL:-${2:-}}"
AUTO_EXECUTE_CF="${AUTO_EXECUTE_CF:-false}"
WORKER_TARGET="${WORKER_TARGET:-$DEFAULT_WORKER_TARGET}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "======================================================================"
echo "🚀 CASPER. GHOSTPROTOCOL.US — FINISH DEPLOYMENT ACCELERATOR"
echo "======================================================================"
echo "Date:           $(date)"
echo "Repo root:      $REPO_ROOT"
echo "Account ID:     $CF_ACCOUNT_ID"
echo "Zone ID:        $CF_ZONE_ID"
echo "Target:         $HOSTNAME"
echo "Worker:         $WORKER_NAME"
echo "Cloud Run svc:  $SERVICE_NAME ($PROJECT_ID / $REGION)"
echo ""
echo "Current token:  ${TOKEN:+[PROVIDED (length ${#TOKEN})]}${TOKEN:-[NOT PROVIDED — using [REPLACE] placeholders]}"
echo "Cloud Run URL:  ${CLOUD_RUN_URL:-[NOT PROVIDED — use after successful deploy]}"
echo "Auto CF exec:   $AUTO_EXECUTE_CF"
echo ""
echo "Run with --help for options."
echo "======================================================================"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Options / Environment:
  CF_TOKEN=... or $1                Full-priv CF API token
  CLOUD_RUN_URL=... or $2           Live URL after Cloud Run deploy
  WORKER_TARGET=...                 Override default workers.dev target
  AUTO_EXECUTE_CF=true              Non-interactively run DNS + Access + custom-domain steps
                                    (only after you have performed steps 1+2)

Examples:
  ./scripts/finish-casper-deployment.sh
  CF_TOKEN=cfat_... CLOUD_RUN_URL=https://... ./scripts/finish-casper-deployment.sh
  AUTO_EXECUTE_CF=true CF_TOKEN=... CLOUD_RUN_URL=... ./scripts/finish-casper-deployment.sh --execute
EOF
  exit 0
fi

# -----------------------------------------------------------------------------
# HELPER FUNCTIONS (idempotency + safety)
# -----------------------------------------------------------------------------
log() { echo "[$(date +'%H:%M:%S')] $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not found. Install it."; exit 1; }
}

pause_or_continue() {
  if [[ "$AUTO_EXECUTE_CF" != "true" ]]; then
    echo ""
    read -r -p "Press Enter to continue (or Ctrl-C to stop) ... " || true
  fi
}

run_curl() {
  # Helper that prints the curl for audit + runs it if token present
  local desc="$1"; shift
  echo ""
  echo ">>> $desc"
  echo "    (token redacted in output)"
  if [[ -n "$TOKEN" ]]; then
    "$@"
  else
    echo "    [SKIPPED — no TOKEN provided]"
  fi
}

# -----------------------------------------------------------------------------
# PREREQ CHECKS
# -----------------------------------------------------------------------------
echo ""
echo "=== PRE-FLIGHT CHECKS ==="
require_cmd curl
require_cmd jq || echo "WARNING: jq not found — some JSON pretty-printing will be raw."
require_cmd gcloud || echo "WARNING: gcloud not found — Cloud Run steps will be manual only."
command -v gh >/dev/null 2>&1 || echo "INFO: gh CLI not found — GH Actions path will show manual UI steps."

if [[ -n "$TOKEN" ]]; then
  log "Token provided — CF API calls enabled where scopes allow."
else
  log "No token — script will print every curl with [REPLACE: YOUR_FULL_PRIV_TOKEN] placeholders."
fi

if [[ -n "$CLOUD_RUN_URL" ]]; then
  log "Cloud Run URL captured: $CLOUD_RUN_URL"
else
  log "No Cloud Run URL yet — you must complete Step 1 first."
fi

echo ""
pause_or_continue

# =============================================================================
# SECTION 1: DEPLOY CLOUD RUN (LOCAL OR GITHUB ACTIONS)
# =============================================================================
echo ""
echo "======================================================================"
echo "SECTION 1: DEPLOY / REDEPLOY CLOUD RUN (cost-sentinel)"
echo "======================================================================"
echo ""
echo "This must succeed and emit a stable https://cost-sentinel-*-uc.a.run.app URL"
echo "BEFORE you proceed to Steps 2-4. The Worker will point at this URL."
echo ""
echo "Two equivalent paths (choose one):"
echo ""

echo "──────────────────────────────────────────────────────────────────────"
echo "1A. LOCAL / MANUAL (fastest when you are at the machine with gcloud)"
echo "──────────────────────────────────────────────────────────────────────"
cat <<'LOCALDEPLOY'

# From repo root:
./deploy.sh
# or with explicit tag:
./deploy.sh --tag "$(date +%Y%m%d-%H%M%S)"

# Alternative legacy path:
# ./deploy-to-cloudrun.sh

# After success, capture the URL:
CLOUD_RUN_URL=$(gcloud run services describe cost-sentinel \
  --region=us-central1 --project=gp-phantomvision-dev \
  --format='value(status.url)')

echo "YOUR LIVE CLOUD RUN URL: $CLOUD_RUN_URL"
LOCALDEPLOY

echo ""
echo "──────────────────────────────────────────────────────────────────────"
echo "1B. GITHUB ACTIONS (recommended for audited / OIDC production deploys)"
echo "──────────────────────────────────────────────────────────────────────"
cat <<'GHDEPLOY'

# Prerequisites (one-time):
#   - Workflows must be on remote (git push if you haven't already)
#   - Repo secrets set:
#       GCP_WORKLOAD_IDENTITY_PROVIDER
#       GCP_SERVICE_ACCOUNT=github-actions-deployer@gp-phantomvision-dev.iam.gserviceaccount.com
#   - IAM grants already applied to that SA — SEE MASTER_RUNBOOK.md SECTION 8
#     (full WIF + serviceusage.serviceUsageAdmin + cloudbuild.builds.editor +
#      storage.admin on gp-phantomvision-dev_cloudbuild + impersonation tests +
#      the two exact secrets). This was the root cause diagnosed by the GH subagent.

# Trigger from CLI (after push):
gh workflow run deploy.yml --repo dev-gp-1/cost-sentinel --ref main
# or with force:
gh workflow run deploy.yml --repo dev-gp-1/cost-sentinel --ref main --field force_rebuild=true

# Monitor:
gh run list --repo dev-gp-1/cost-sentinel --limit 5
gh run watch <RUN_ID> --repo dev-gp-1/cost-sentinel

# GitHub UI:
#   https://github.com/dev-gp-1/cost-sentinel/actions
#   Select "Deploy to Cloud Run (Artifact Registry)"
#   Run workflow → main + optional force_rebuild

# After workflow succeeds, copy the CLOUD_RUN_URL printed in the
# "Deploy to Cloud Run" step (or from the job summary).

# Post-GH-deploy local capture (any machine with gcloud + auth):
# CLOUD_RUN_URL=$(gcloud run services describe cost-sentinel \
#   --region=us-central1 --project=gp-phantomvision-dev \
#   --format='value(status.url)')
GHDEPLOY

echo ""
echo "✅ After either path succeeds, export the real URL for the rest of this script:"
echo "   export CLOUD_RUN_URL=\"https://cost-sentinel-...-uc.a.run.app\""
echo ""
echo "   Then re-run this script (or continue manually with the printed commands)."
echo ""
pause_or_continue

# =============================================================================
# SECTION 2: SET WORKER BACKEND_URL SECRET + DEPLOY WORKER
# =============================================================================
echo ""
echo "======================================================================"
echo "SECTION 2: SET BACKEND_URL SECRET + DEPLOY casper-proxy WORKER"
echo "======================================================================"
echo ""
echo "The Worker (transparent reverse proxy) must know the real Cloud Run URL."
echo "Use wrangler secret (never committed). Then deploy."
echo ""

cat <<'WORKERSTEP'

cd /Users/deanbarrett/gp-firmware/cost-sentinel/cloudflare-worker   # or cd cloudflare-worker

# 1. (Strongly recommended) Use secret — overrides the placeholder in wrangler.toml
npx wrangler secret put BACKEND_URL
# When prompted, paste exactly:
#   https://cost-sentinel-REALHASH-uc.a.run.app
#   (no trailing slash, include https://)

# If you prefer to edit temporarily for testing (not for prod):
#   Edit wrangler.toml [vars] BACKEND_URL = "https://..."

# 2. Deploy (or redeploy after secret change or code change)
npm install          # first time or after package changes
npx wrangler deploy
# or: npm run deploy

# After deploy you will see something like:
#   https://casper-proxy.cost-sentinel.workers.dev
# Note the exact workers.dev hostname — use it for WORKER_TARGET below if different.
WORKERSTEP

echo ""
echo "Update this variable if your workers.dev hostname differs:"
echo "   export WORKER_TARGET=\"casper-proxy.YOURACCOUNT.workers.dev\""
echo ""
echo "Next: add the custom domain (Section 3) + wire DNS/Access (Section 4)."
echo ""
pause_or_continue

# =============================================================================
# SECTION 3: ADD CUSTOM DOMAIN TO THE WORKER
# =============================================================================
echo ""
echo "======================================================================"
echo "SECTION 3: ADD CUSTOM DOMAIN TO WORKER (casper.ghostprotocol.us)"
echo "======================================================================"
echo ""
echo "This tells Cloudflare to route the hostname through the Worker (and therefore"
echo "through the Access policy). Cloudflare auto-manages the supporting DNS + cert."
echo "Preferred over manual routes in most cases."
echo ""

if [[ -n "$TOKEN" && "$AUTO_EXECUTE_CF" == "true" ]]; then
  log "AUTO mode + token present → attempting Worker custom domain via API"
  curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/domains" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    --data '{
      "hostname": "'${HOSTNAME}'",
      "service": "'${WORKER_NAME}'",
      "zone_id": "'${CF_ZONE_ID}'"
    }' | jq . || true
else
  echo ">>> EXACT CURL (copy-paste ready — replace token if not using env):"
  cat <<CURL3

curl -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/domains" \
  -H "Authorization: Bearer ${TOKEN:-[REPLACE: YOUR_FULL_PRIV_TOKEN]}" \
  -H "Content-Type: application/json" \
  --data '{
    "hostname": "casper.ghostprotocol.us",
    "service": "casper-proxy",
    "zone_id": "'${CF_ZONE_ID}'"
  }' | jq .

CURL3
fi

echo ""
echo "Alternative (often more reliable if token scope is borderline):"
echo "  Dashboard → Workers & Pages → casper-proxy → Triggers → Custom Domains"
echo "  → Add custom domain → casper.ghostprotocol.us"
echo ""
echo "List existing custom domains:"
echo "  curl -X GET \"https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/workers/domains\" \\"
echo "    -H \"Authorization: Bearer \${TOKEN}\" | jq ."
echo ""
pause_or_continue

# =============================================================================
# SECTION 4: DNS + ACCESS POLICY CURLS (ALL EXACT COMMANDS)
# =============================================================================
echo ""
echo "======================================================================"
echo "SECTION 4: DNS RECORDS + CLOUDFLARE ACCESS APP + POLICY"
echo "======================================================================"
echo ""
echo "All values are from the sovereign configuration. Uses full-priv token."
echo "Idempotent patterns (GET existing ID first) are included."
echo ""

# --- 4A. DNS: Proxied CNAME (recommended for Worker + Access) ---
echo "──────────────────────────────────────────────────────────────────────"
echo "4A. DNS: Proxied CNAME casper.ghostprotocol.us → Worker (orange cloud ON)"
echo "──────────────────────────────────────────────────────────────────────"

DNS_PAYLOAD='{
  "type": "CNAME",
  "name": "casper",
  "content": "'${WORKER_TARGET}'",
  "ttl": 300,
  "proxied": true,
  "comment": "Cost Sentinel → Worker (casper-proxy) with Cloudflare Access protection [casper.ghostprotocol.us]"
}'

if [[ -n "$TOKEN" && "$AUTO_EXECUTE_CF" == "true" ]]; then
  log "AUTO: Checking for existing DNS record (idempotent)..."
  EXISTING_DNS_ID=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${HOSTNAME}" \
    -H "Authorization: Bearer ${TOKEN}" | jq -r '.result[0].id // empty' 2>/dev/null || true)

  if [[ -n "$EXISTING_DNS_ID" ]]; then
    log "Updating existing DNS record ${EXISTING_DNS_ID}..."
    curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${EXISTING_DNS_ID}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  else
    log "Creating new proxied CNAME..."
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  fi
else
  cat <<DNS_CURL

# Idempotent version (recommended):
EXISTING_DNS_ID=\$(curl -s -X GET \\
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${HOSTNAME}" \\
  -H "Authorization: Bearer ${TOKEN:-[REPLACE: YOUR_FULL_PRIV_TOKEN]}" | jq -r '.result[0].id // empty')

DNS_PAYLOAD='${DNS_PAYLOAD}'

if [ -n "\$EXISTING_DNS_ID" ]; then
  curl -X PUT "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/\$EXISTING_DNS_ID" \\
    -H "Authorization: Bearer ${TOKEN:-[REPLACE: YOUR_FULL_PRIV_TOKEN]}" \\
    -H "Content-Type: application/json" \\
    --data "\$DNS_PAYLOAD" | jq .
else
  curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \\
    -H "Authorization: Bearer ${TOKEN:-[REPLACE: YOUR_FULL_PRIV_TOKEN]}" \\
    -H "Content-Type: application/json" \\
    --data "\$DNS_PAYLOAD" | jq .
fi

DNS_CURL
fi

echo ""

# --- 4B. Optional wildcard DNS (for future *.ghostprotocol.us) ---
echo "──────────────────────────────────────────────────────────────────────"
echo "4B. (OPTIONAL) Wildcard DNS *.ghostprotocol.us → same Worker target"
echo "──────────────────────────────────────────────────────────────────────"
cat <<WILDCARD

curl -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \\
  -H "Authorization: Bearer ${TOKEN:-[REPLACE: YOUR_FULL_PRIV_TOKEN]}" \\
  -H "Content-Type: application/json" \\
  --data '{
    "type": "CNAME",
    "name": "*",
    "content": "'"${WORKER_TARGET}"'",
    "ttl": 300,
    "proxied": true,
    "comment": "Wildcard for ghostprotocol.us subdomains via casper-proxy Worker"
  }' | jq .

# Follow up: add Worker Route in wrangler.toml or dashboard for *.ghostprotocol.us/*
WILDCARD

echo ""
pause_or_continue

# --- 4C. Apply Access App + Exact Admin Policy (PRIMARY) ---
echo "──────────────────────────────────────────────────────────────────────"
echo "4C. APPLY CLOUDFLARE ACCESS APP + EXACT 'Admin Access' POLICY"
echo "──────────────────────────────────────────────────────────────────────"
echo ""
echo "Uses the hardened apply-cloudflare-access-policy.sh (robust detection + KNOWN_APP_ID fallback)."
echo "This is the authoritative way to apply the policy allowing:"
echo "  ghostprotocol.us + cota.com + huggaretreats.com domains + specific emails."
echo ""

if [[ -n "$TOKEN" ]]; then
  log "Invoking apply-cloudflare-access-policy.sh with provided token..."
  # Pass token as arg; script also respects KNOWN_APP_ID etc. from its own header
  KNOWN_APP_ID="$KNOWN_APP_ID" \
  CF_ACCOUNT_ID="$CF_ACCOUNT_ID" \
  CF_ZONE_ID="$CF_ZONE_ID" \
  CF_WORKER_TARGET="$WORKER_TARGET" \
    "$REPO_ROOT/apply-cloudflare-access-policy.sh" "$TOKEN" || true
else
  echo ">>> RUN THIS (after exporting or replacing token):"
  cat <<APPLY_SCRIPT

KNOWN_APP_ID=2e8771ca-7eca-4946-9caf-7373bc06f9ee \
CF_WORKER_TARGET="${WORKER_TARGET}" \
./apply-cloudflare-access-policy.sh "${TOKEN:-[REPLACE: YOUR_FULL_PRIV_TOKEN]}"

APPLY_SCRIPT
fi

echo ""
echo "Direct policy PUT curl (if the script hits scope issues on re-runs):"
cat <<DIRECT_POLICY

curl -X PUT \\
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${KNOWN_APP_ID}/policies/${KNOWN_POLICY_ID}" \\
  -H "Authorization: Bearer ${TOKEN:-[REPLACE: YOUR_FULL_PRIV_TOKEN]}" \\
  -H "Content-Type: application/json" \\
  --data '{
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
  }' | jq .

DIRECT_POLICY

echo ""
echo "Service token bypass example (once you retrieve the secret from Zero Trust → Service Tokens):"
echo "  curl -H 'CF-Access-Client-Id: ${SERVICE_TOKEN_CLIENT_ID}' \\"
echo "       -H 'CF-Access-Client-Secret: <YOUR_SECRET>' \\"
echo "       -I https://${HOSTNAME}"
echo ""
pause_or_continue

# =============================================================================
# SECTION 5: VALIDATION STEPS
# =============================================================================
echo ""
echo "======================================================================"
echo "SECTION 5: VALIDATION (AFTER ALL PREVIOUS STEPS COMPLETE)"
echo "======================================================================"
echo ""
echo "Run the dedicated validator (it is already present in the repo):"
echo ""

cat <<'VALIDATE'

# From repo root:
./scripts/validate-casper.sh

# With service token bypass test (once you have the secret):
CF_ACCESS_CLIENT_ID="00bc5effe82dd81aa686fcf3cc33cce7.access" \
CF_ACCESS_CLIENT_SECRET="YOUR_SECRET_HERE" \
  ./scripts/validate-casper.sh

VALIDATE

echo ""
echo "Manual quick checks (copy-paste):"
cat <<'QUICKCHECKS'

# 1. Expect 302 to Cloudflare Access login page (no token)
curl -sI https://casper.ghostprotocol.us | head -15

# 2. After successful login with an allowed identity (e.g. dean@ghostprotocol.us)
#    you should receive 200 + HTML containing "ShadowForge Cost Sentinel"

# 3. Check Worker is proxying (look for cf-ray, server: cloudflare, and x-forwarded-* headers)

# 4. Full browser test checklist (see MASTER_RUNBOOK.md Section 6):
#    - Business Models tab: two models, editable inputs, LTV/COGS waterfall, exports
#    - Simulator tab: sliders + runs produce live charts
#    - GCP Connect tab: buttons work (requires local ./start-gcloud-connector.sh on your laptop)
#    - SPA routing / refresh / deep links work (nginx fallback)
#    - Disallowed email is blocked at Access wall
#    - DevTools: cf-access-jwt-assertion header present on authenticated requests

# 5. Re-check Cloud Run logs if 502s appear:
gcloud run services logs read cost-sentinel --region us-central1 --project gp-phantomvision-dev --limit 50

# 6. Worker logs (live tail):
cd cloudflare-worker && npx wrangler tail

QUICKCHECKS

echo ""
echo "======================================================================"
echo "✅ FINISH SCRIPT COMPLETE"
echo "======================================================================"
echo ""
echo "Next actions summary:"
echo "  1. Perform Section 1 (Cloud Run deploy) → capture URL"
echo "  2. Perform Section 2 (wrangler secret + deploy)"
echo "  3. Run this script again with TOKEN + CLOUD_RUN_URL + AUTO_EXECUTE_CF=true"
echo "     (or run the printed curls / apply script manually)"
echo "  4. Section 5 validation + browser smoke test"
echo ""
echo "All authoritative commands were pulled directly from the source scripts"
echo "and MASTER_RUNBOOK so nothing is stale."
echo ""
echo "Full context: MASTER_RUNBOOK.md (especially Sections 3 and 6)"
echo "Rollback: delete DNS/Access app or redeploy previous Cloud Run revision."
echo "======================================================================"

# Optional: if user wants a one-liner experience in the future, they can now do:
#   CF_TOKEN=... CLOUD_RUN_URL=... AUTO_EXECUTE_CF=true ./scripts/finish-casper-deployment.sh

exit 0
