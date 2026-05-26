#!/bin/bash
#
# apply-cloudflare-access-policy.sh
#
# Cloudflare Access + DNS automation for ShadowForge Cost Sentinel.
# 
# This script:
#   1. Creates (or updates) a Cloudflare Access Application for the hostname
#      casper.ghostprotocol.us (self-hosted type).
#   2. Applies the exact "Admin Access" policy provided by the user.
#      The policy allows users from the email domains:
#        - ghostprotocol.us
#        - cota.com
#        - huggaretreats.com
#      Plus any specific email addresses listed.
#   3. (Optional) Sets up the DNS CNAME record for the custom domain
#      so that traffic routes through the Cloudflare Worker (casper-proxy).
#
# Architecture tie-in (protecting Cloud Run via Worker):
#   - Cloudflare Access enforces authentication *at the edge* before any
#     request reaches the Worker or the origin.
#   - The Worker (deployed to casper.ghostprotocol.us) is the only
#     public entrypoint. It performs a simple reverse-proxy to your
#     Cloud Run backend URL (which must be deployed with --allow-unauthenticated
#     because protection lives entirely in Cloudflare).
#   - Result: Beautiful custom domain + enterprise SSO via Cloudflare Zero Trust
#     (no Google IAP, no custom OAuth in the Vue app, no changes to Cloud Run).
#   - The Worker can later be extended to validate the CF JWT (cf-access-jwt-assertion)
#     for defense-in-depth if desired.
#
# Prerequisites:
#   - Cloudflare API Token with permissions:
#       Account:Access:Apps and Policies:Edit
#       Zone:DNS:Edit (for the DNS portion)
#   - Your Cloudflare Account ID (find in dashboard URL or "Account ID" on overview)
#   - Zone ID for ghostprotocol.us (in the domain overview)
#   - The Worker "casper-proxy" must already be deployed (see cloudflare-worker/)
#   - (Optional but recommended) wrangler secret put BACKEND_URL inside the Worker
#     with your real Cloud Run URL (https://cost-sentinel-xxx-uc.a.run.app)
#
# Usage:
#   ./apply-cloudflare-access-policy.sh <CLOUDFLARE_API_TOKEN>
#
#   You can also export the following before running for convenience:
#     export CF_ACCOUNT_ID="..."
#     export CF_ZONE_ID="..."
#     export CF_WORKER_TARGET="casper-proxy.your-account-subdomain.workers.dev"

# [SESSION ADAPTATION] Hardcoded IDs from provided values + confirmed via API:
#   CF_ACCOUNT_ID=79f3207a2cdac9f9996dc13a3dc80340
#   CF_ZONE_ID=c0f92fa6305538ebd978f8a553c04483
#   Default CF_WORKER_TARGET=casper-proxy.cost-sentinel.workers.dev (Worker + Access priority; replace with real casper-proxy.<subdomain>.workers.dev after wrangler deploy + Workers dashboard subdomain check)
# Known from successful 2026-05-26 apply run (before scope-limited token caused modify auth errors on DNS/Access):
#   Application ID: 2e8771ca-7eca-4946-9caf-7373bc06f9ee
#   Policy ID (Admin Access): 6e5a171f-71ef-49bf-a669-0ab8e69d5510
# Service token (for authenticated calls to casper.ghostprotocol.us if using CF Access service tokens):
#   CF-Access-Client-Id: 00bc5effe82dd81aa686fcf3cc33cce7.access
#   (Secret required for use; not supplied here. Use for service auth in scripts/curl bypassing interactive login.)
# Export KNOWN_APP_ID=2e8771ca-7eca-4946-9caf-7373bc06f9ee to force use in detection.

#
# The script is idempotent: it will create the app/policy if missing and update
# the policy in-place if it already exists (by name "Admin Access").
#
# After running:
#   1. In Cloudflare dashboard, verify the Access Application exists under
#      Zero Trust > Access > Applications.
#   2. Add the custom domain to your Worker (Workers & Pages > casper-proxy >
#      Triggers > Custom Domains > Add custom domain).
#   3. Test by visiting https://casper.ghostprotocol.us — you should be
#      redirected to Cloudflare Access login.
#
set -euo pipefail

# =============================================================================
# CONFIGURATION - EDIT THESE OR EXPORT AS ENVIRONMENT VARIABLES
# =============================================================================

# Cloudflare Account ID (required)
CF_ACCOUNT_ID="${CF_ACCOUNT_ID:-79f3207a2cdac9f9996dc13a3dc80340}"

# Zone ID for ghostprotocol.us (required for DNS operations)
CF_ZONE_ID="${CF_ZONE_ID:-c0f92fa6305538ebd978f8a553c04483}"

# The public hostname we are protecting
HOSTNAME="casper.ghostprotocol.us"

# Name of the Access Application (human readable)
APP_NAME="Cost Sentinel - Admin UI"

# Known Application ID from successful prior apply (2026-05-26 run with cfat token).
# Use via env or hardcode to skip detection/create loops when token has limited
# DNS/Access:Apps modify scopes (we observed Authentication errors on PUT/modify).
# This allows re-runs of policy update even if app lookup is restricted.
KNOWN_APP_ID="${KNOWN_APP_ID:-2e8771ca-7eca-4946-9caf-7373bc06f9ee}"

# The exact "Admin Access" policy (as provided by the user).
# This policy uses email domains for the three organizations plus specific emails.
# Update the specific emails list as needed to match the exact curl you supplied.
ADMIN_ACCESS_POLICY_JSON='{
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
}'

# Optional: Worker target for DNS (the default workers.dev hostname of your Worker).
# When you add a custom domain to the Worker in the dashboard, Cloudflare often
# handles routing automatically. However, many teams also create an explicit
# proxied CNAME so the record is visible and managed via API.
# Example: casper-proxy.<your-cloudflare-subdomain>.workers.dev
CF_WORKER_TARGET="${CF_WORKER_TARGET:-casper-proxy.cost-sentinel.workers.dev}"

# Session duration for the Access App (common values: 2h, 12h, 24h)
SESSION_DURATION="24h"

# =============================================================================
# INTERNAL HELPERS
# =============================================================================

API_BASE="https://api.cloudflare.com/client/v4"
AUTH_HEADER="Authorization: Bearer"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

# =============================================================================
# MAIN
# =============================================================================

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <CLOUDFLARE_API_TOKEN>"
  echo ""
  echo "Example:"
  echo "  CF_ACCOUNT_ID=abc123 CF_ZONE_ID=def456 \\"
  echo "  $0 your_long_api_token_here"
  echo ""
  echo "Or export the CF_* variables and just pass the token."
  exit 1
fi

CLOUDFLARE_API_TOKEN="$1"

# Basic validation
if [[ -z "$CLOUDFLARE_API_TOKEN" ]]; then
  die "Cloudflare API token is required as the first argument."
fi

if [[ -z "$CF_ACCOUNT_ID" ]]; then
  die "CF_ACCOUNT_ID is not set. Export it or edit the CONFIG section."
fi

require_cmd curl
require_cmd jq || echo "Warning: jq not found — raw JSON will be shown for some responses."

AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
CONTENT_TYPE="Content-Type: application/json"

# -----------------------------------------------------------------------------
# Step 1: Create or locate the Access Application for the hostname
# -----------------------------------------------------------------------------
log "Looking for existing Access Application for ${HOSTNAME} ..."

EXISTING_APP_ID=""
APPS_RESPONSE=$(curl -s -X GET \
  "${API_BASE}/accounts/${CF_ACCOUNT_ID}/access/apps" \
  -H "${AUTH}" -H "${CONTENT_TYPE}")

# Try to find an app that matches our domain or name (improved robust detection for casper
# to prevent false "create" attempts on re-runs when token scopes limit modify or CF returns
# self_hosted_domains/domains instead of top-level .domain, or variant names).
# Includes fallback to KNOWN_APP_ID from prior successful run (see MASTER_RUNBOOK).
EXISTING_APP_ID=$(echo "$APPS_RESPONSE" | jq -r '
  .result[]?
  | select(
      (.domain // "") == "'${HOSTNAME}'" or
      ((.self_hosted_domains // []) | map(select(. == "'${HOSTNAME}'")) | length > 0) or
      ((.domains // []) | map(select(. == "'${HOSTNAME}'")) | length > 0) or
      ((.name // "") | ascii_downcase | contains("casper")) or
      ((.name // "") | ascii_downcase | contains("cost sentinel")) or
      ((.name // "") | ascii_downcase | contains("admin ui")) or
      (.name // "") == "'${APP_NAME}'"
    )
  | .id
' 2>/dev/null | head -n1 || true)

# Fallback to known good ID (prevents re-create false-fail when detection is partial due to scopes)
if [[ -z "$EXISTING_APP_ID" || "$EXISTING_APP_ID" == "null" ]]; then
  if [[ -n "${KNOWN_APP_ID:-}" ]]; then
    EXISTING_APP_ID="$KNOWN_APP_ID"
    log "Using KNOWN_APP_ID fallback: ${EXISTING_APP_ID}"
  fi
fi

if [[ -n "$EXISTING_APP_ID" && "$EXISTING_APP_ID" != "null" ]]; then
  log "Found existing Access Application: ${EXISTING_APP_ID}"
  APP_ID="$EXISTING_APP_ID"
else
  log "No existing app found — creating new Access Application for ${HOSTNAME} ..."
  
  CREATE_APP_PAYLOAD=$(cat <<EOF
{
  "name": "${APP_NAME}",
  "domain": "${HOSTNAME}",
  "type": "self_hosted",
  "session_duration": "${SESSION_DURATION}",
  "allowed_idps": [],
  "auto_redirect_to_identity": false,
  "app_launcher_visible": true,
  "service_auth_401": false,
  "http_only_cookie_auth": true,
  "options": {
    "allow_iframe": false
  }
}
EOF
)

  CREATE_RESPONSE=$(curl -s -X POST \
    "${API_BASE}/accounts/${CF_ACCOUNT_ID}/access/apps" \
    -H "${AUTH}" \
    -H "${CONTENT_TYPE}" \
    --data "${CREATE_APP_PAYLOAD}")

  if echo "$CREATE_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    APP_ID=$(echo "$CREATE_RESPONSE" | jq -r '.result.id')
    log "✅ Created Access Application. ID: ${APP_ID}"
  else
    echo "$CREATE_RESPONSE" | jq . || echo "$CREATE_RESPONSE"
    die "Failed to create Access Application. See response above."
  fi
fi

# -----------------------------------------------------------------------------
# Step 2: Apply the exact "Admin Access" policy (idempotent)
# -----------------------------------------------------------------------------
log "Applying exact 'Admin Access' policy to app ${APP_ID} ..."

# List existing policies for this app
POLICIES_RESPONSE=$(curl -s -X GET \
  "${API_BASE}/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
  -H "${AUTH}" -H "${CONTENT_TYPE}")

EXISTING_POLICY_ID=$(echo "$POLICIES_RESPONSE" | jq -r '
  .result[]? 
  | select(.name == "Admin Access")
  | .id
' 2>/dev/null | head -n1 || true)

if [[ -n "$EXISTING_POLICY_ID" && "$EXISTING_POLICY_ID" != "null" ]]; then
  log "Found existing 'Admin Access' policy (ID: ${EXISTING_POLICY_ID}) — updating in place ..."
  
  UPDATE_RESPONSE=$(curl -s -X PUT \
    "${API_BASE}/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies/${EXISTING_POLICY_ID}" \
    -H "${AUTH}" \
    -H "${CONTENT_TYPE}" \
    --data "${ADMIN_ACCESS_POLICY_JSON}")

  if echo "$UPDATE_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    log "✅ Updated existing 'Admin Access' policy successfully."
  else
    echo "$UPDATE_RESPONSE" | jq . || echo "$UPDATE_RESPONSE"
    die "Failed to update policy."
  fi
else
  log "No existing 'Admin Access' policy — creating new one ..."
  
  CREATE_POLICY_RESPONSE=$(curl -s -X POST \
    "${API_BASE}/accounts/${CF_ACCOUNT_ID}/access/apps/${APP_ID}/policies" \
    -H "${AUTH}" \
    -H "${CONTENT_TYPE}" \
    --data "${ADMIN_ACCESS_POLICY_JSON}")

  if echo "$CREATE_POLICY_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
    POLICY_ID=$(echo "$CREATE_POLICY_RESPONSE" | jq -r '.result.id')
    log "✅ Created new 'Admin Access' policy. ID: ${POLICY_ID}"
  else
    echo "$CREATE_POLICY_RESPONSE" | jq . || echo "$CREATE_POLICY_RESPONSE"
    die "Failed to create policy."
  fi
fi

# -----------------------------------------------------------------------------
# Step 3: DNS setup for the Worker (optional but recommended)
# -----------------------------------------------------------------------------
if [[ -n "$CF_ZONE_ID" ]]; then
  log "Zone ID present — preparing DNS for ${HOSTNAME} (Worker routing) ..."

  if [[ -n "$CF_WORKER_TARGET" ]]; then
    log "Creating/updating proxied CNAME: ${HOSTNAME} → ${CF_WORKER_TARGET}"
    
    # Check if record already exists
    DNS_LIST=$(curl -s -X GET \
      "${API_BASE}/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${HOSTNAME}" \
      -H "${AUTH}")

    EXISTING_DNS_ID=$(echo "$DNS_LIST" | jq -r '.result[0]?.id // empty' 2>/dev/null || true)

    DNS_PAYLOAD=$(cat <<EOF
{
  "type": "CNAME",
  "name": "casper",
  "content": "${CF_WORKER_TARGET}",
  "ttl": 300,
  "proxied": true,
  "comment": "Cost Sentinel → Worker (casper-proxy) with Cloudflare Access protection"
}
EOF
)

    if [[ -n "$EXISTING_DNS_ID" ]]; then
      log "Updating existing DNS record ${EXISTING_DNS_ID} ..."
      DNS_RESPONSE=$(curl -s -X PUT \
        "${API_BASE}/zones/${CF_ZONE_ID}/dns_records/${EXISTING_DNS_ID}" \
        -H "${AUTH}" -H "${CONTENT_TYPE}" \
        --data "${DNS_PAYLOAD}")
    else
      log "Creating new DNS record ..."
      DNS_RESPONSE=$(curl -s -X POST \
        "${API_BASE}/zones/${CF_ZONE_ID}/dns_records" \
        -H "${AUTH}" -H "${CONTENT_TYPE}" \
        --data "${DNS_PAYLOAD}")
    fi

    if echo "$DNS_RESPONSE" | jq -e '.success == true' >/dev/null 2>&1; then
      log "✅ DNS record configured (proxied=true). Traffic will hit the Worker + Access."
    else
      echo "DNS response:"
      echo "$DNS_RESPONSE" | jq . || echo "$DNS_RESPONSE"
      log "⚠️  DNS step encountered an issue (non-fatal). You can run the DNS portion manually."
    fi
  else
    log "CF_WORKER_TARGET not set. Skipping automatic DNS creation."
    log "Manual DNS curl you can run (edit the target as needed):"
    cat <<'EOF'

# Example: Create proxied CNAME pointing to your Worker's default hostname
curl -X POST "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/dns_records" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "CNAME",
    "name": "casper",
    "content": "casper-proxy.YOUR_SUBDOMAIN.workers.dev",
    "ttl": 300,
    "proxied": true
  }'

# After the record is proxied, add the custom domain to the Worker in the dashboard
# (or via wrangler) so Cloudflare routes casper.ghostprotocol.us to the Worker.

EOF
  fi
else
  log "No CF_ZONE_ID set — skipping DNS automation. You can run the manual curl shown above later."
fi

# -----------------------------------------------------------------------------
# Final summary
# -----------------------------------------------------------------------------
echo ""
echo "======================================================================"
echo "✅ Cloudflare Access policy application complete"
echo "======================================================================"
echo "Access Application ID : ${APP_ID}"
echo "Hostname protected    : ${HOSTNAME}"
echo "Policy applied        : Admin Access (email domains + specific emails)"
echo ""
echo "Next steps:"
echo "  1. Add custom domain 'casper.ghostprotocol.us' to the"
echo "     Worker 'casper-proxy' in the Cloudflare dashboard."
echo "  2. (Optional) Visit https://casper.ghostprotocol.us and"
echo "     complete a Cloudflare Access login with an allowed identity."
echo "  3. The Worker will then proxy authenticated requests to Cloud Run."
echo ""
echo "To re-run or update the policy later, simply execute this script again"
echo "with the same (or updated) token."
echo ""
echo "The Cloud Run service itself stays --allow-unauthenticated."
echo "All protection is provided by Cloudflare Access + the Worker proxy."
echo "======================================================================"

exit 0

# =============================================================================
# SESSION-SPECIFIC ADAPTATIONS (executed 2026-05-26):
# - Fixed remaining rename artifact: "name": "cost-sentinel" -> "name": "casper" in DNS payload
# - Hardcoded defaults: CF_ACCOUNT_ID=79f3207a2cdac9f9996dc13a3dc80340 , CF_ZONE_ID=c0f92fa6305538ebd978f8a553c04483 (fetched/confirmed via API)
# - Prepared CF_WORKER_TARGET default = "casper-proxy.cost-sentinel.workers.dev" (best decision: Worker in front for auth + Access; orange-cloud proxied CNAME. Update to real casper-proxy.<account-workers-subdomain>.workers.dev after `wrangler deploy` in cloudflare-worker/ and checking dashboard)
# - Service token for authenticated calls (e.g. curl -H 'CF-Access-Client-Id: 00bc5effe82dd81aa686fcf3cc33cce7.access' -H 'CF-Access-Client-Secret: <secret>' https://casper.ghostprotocol.us/... ): 
#   CF-Access-Client-Id: 00bc5effe82dd81aa686fcf3cc33cce7.access   (secret not provided in prompt; create/retrieve in Zero Trust dashboard under Service Tokens if needed for non-interactive access)
# Run prepared: CF_WORKER_TARGET=... ./apply-cloudflare-access-policy.sh YOUR_CLOUDFLARE_API_TOKEN_HERE (pass as first arg or export CLOUDFLARE_API_TOKEN)
# =============================================================================
