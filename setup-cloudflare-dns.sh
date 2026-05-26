#!/bin/bash
set -euo pipefail

echo "=== ShadowForge Cost Sentinel - Cloudflare DNS Setup ==="
echo ""
echo "MODES (export MODE=... before running):"
echo "  worker            (default)  → Worker + Cloudflare Access (full protection)"
echo "  cloudrun-custom              → Native Cloud Run custom domain (ghs.googlehosted.com)"
echo "  direct                       → Raw Cloud Run URL (testing only, no protection)"
echo ""

# === CONFIGURATION - EDIT THESE OR PASS VIA ENVIRONMENT ===
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-YOUR_CLOUDFLARE_API_TOKEN_HERE}"
ZONE_ID="${ZONE_ID:-YOUR_ZONE_ID_FOR_ghostprotocol.us}"
SUBDOMAIN="casper"   # This will create casper.ghostprotocol.us (the target hostname for the casper-proxy Worker)

# MODE options:
#   "worker"            → Recommended production (Cloudflare Worker + Access policy in front)
#   "direct"            → Direct to Cloud Run URL (no Access — testing only)
#   "cloudrun-custom"   → Cloud Run native custom domain (CNAME → ghs.googlehosted.com + domain mapping)
MODE="${MODE:-worker}"

# For Worker mode (recommended):
#   Point to the Worker's default .workers.dev hostname (or leave blank to skip DNS creation).
#   The real routing happens when you add the custom domain to the Worker + run apply-cloudflare-access-policy.sh
WORKER_TARGET="${WORKER_TARGET:-casper-proxy.YOUR_SUBDOMAIN.workers.dev}"

# For direct Cloud Run mode (bypasses Worker / Access - only for testing):
CLOUD_RUN_URL="${CLOUD_RUN_URL:-REPLACE_WITH_YOUR_CLOUD_RUN_URL}"  # e.g. cost-sentinel-abc123-uc.a.run.app

# For cloudrun-custom mode (native Cloud Run custom domains):
# After running the domain mapping command below, point to ghs.googlehosted.com
# (Google issues and renews the certificate automatically).
CLOUD_RUN_CUSTOM_TARGET="ghs.googlehosted.com"

# =============================================================================
# Cloudflare Access + Worker is the production path.
# Run ./apply-cloudflare-access-policy.sh <TOKEN> (after configuring it) to
# create the Access Application and apply the exact "Admin Access" policy
# (ghostprotocol.us + cota.com + huggaretreats.com domains + specific emails).
#
# The Worker then proxies authenticated traffic to Cloud Run.
# The Cloud Run service itself can stay --allow-unauthenticated.
# =============================================================================

if [ "$CLOUDFLARE_API_TOKEN" = "YOUR_CLOUDFLARE_API_TOKEN_HERE" ]; then
  echo "ERROR: Please set CLOUDFLARE_API_TOKEN (or edit this script)."
  exit 1
fi

if [ "$ZONE_ID" = "YOUR_ZONE_ID_FOR_ghostprotocol.us" ]; then
  echo "ERROR: Please set ZONE_ID (or edit this script / export ZONE_ID)."
  exit 1
fi

echo "Mode: ${MODE}"
echo "Target hostname: ${SUBDOMAIN}.ghostprotocol.us"
echo ""

if [ "$MODE" = "worker" ]; then
  if [ "$WORKER_TARGET" = "casper-proxy.YOUR_SUBDOMAIN.workers.dev" ]; then
    echo "WARNING: WORKER_TARGET not customized. DNS record will not be created."
    echo "You can still add the custom domain directly to the Worker in the dashboard."
    echo "Then run: ./apply-cloudflare-access-policy.sh YOUR_TOKEN"
    exit 0
  fi

  echo "Creating proxied CNAME for ${SUBDOMAIN}.ghostprotocol.us -> ${WORKER_TARGET} (Worker + Access) ..."

  # Idempotent: try to find existing record first
  EXISTING_ID=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=CNAME&name=${SUBDOMAIN}.ghostprotocol.us" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq -r '.result[0].id // empty' 2>/dev/null || true)

  DNS_PAYLOAD='{
    "type": "CNAME",
    "name": "'${SUBDOMAIN}'",
    "content": "'${WORKER_TARGET}'",
    "ttl": 300,
    "proxied": true,
    "comment": "Cost Sentinel frontend - routes through casper-proxy Worker (protected by Admin Access policy)"
  }'

  if [ -n "$EXISTING_ID" ]; then
    curl -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${EXISTING_ID}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  else
    curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  fi

  echo ""
  echo "✅ DNS record created/updated (proxied=true)."
  echo ""
  echo "CRITICAL NEXT STEPS FOR WORKER + ACCESS PROTECTION:"
  echo "1. Deploy the Worker (cd cloudflare-worker && npm run deploy)"
  echo "2. In Cloudflare dashboard: Workers & Pages → casper-proxy → Triggers"
  echo "   → Custom Domains → Add 'casper.ghostprotocol.us'"
  echo "3. Run the Access policy script:"
  echo "      ./apply-cloudflare-access-policy.sh YOUR_CLOUDFLARE_API_TOKEN"
  echo "4. (Recommended) Also set the real backend:"
  echo "      cd cloudflare-worker && npx wrangler secret put BACKEND_URL"
  echo ""
  echo "Traffic to https://casper.ghostprotocol.us will now be protected"
  echo "by the exact 'Admin Access' policy before reaching the Worker (which proxies to Cloud Run)."

elif [ "$MODE" = "cloudrun-custom" ]; then
  # Cloud Run native custom domain (recommended when you want Google-managed certs directly)
  echo "========================================================================"
  echo "CLOUD RUN NATIVE CUSTOM DOMAIN MODE"
  echo "========================================================================"
  echo ""
  echo "This mode assumes you have already (or will now) run the domain mapping command"
  echo "against the deployed Cloud Run service. Google will serve HTTPS on your domain."
  echo ""
  echo "STEP 1 — (Run this once, locally with gcloud):"
  echo ""
  echo "  gcloud run domain-mappings create \\"
  echo "    --service=cost-sentinel \\"
  echo "    --domain=${SUBDOMAIN}.ghostprotocol.us \\"
  echo "    --region=us-central1 \\"
  echo "    --project=gp-phantomvision-dev"
  echo ""
  echo "   Follow the verification instructions (create the TXT record it prints in Cloudflare)."
  echo "   Wait for the mapping to show as verified (can take a few minutes)."
  echo ""
  echo "STEP 2 — Creating / updating DNS record in Cloudflare:"
  echo "   Type:  CNAME"
  echo "   Name:  ${SUBDOMAIN}"
  echo "   Target: ${CLOUD_RUN_CUSTOM_TARGET}"
  echo "   TTL:   300"
  echo "   Proxy: DNS only (orange cloud OFF) — required for Google cert issuance"
  echo ""

  # Create the DNS record (idempotent where possible)
  EXISTING_ID=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=CNAME&name=${SUBDOMAIN}.ghostprotocol.us" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq -r '.result[0].id // empty' 2>/dev/null || true)

  DNS_PAYLOAD='{
    "type": "CNAME",
    "name": "'${SUBDOMAIN}'",
    "content": "'${CLOUD_RUN_CUSTOM_TARGET}'",
    "ttl": 300,
    "proxied": false,
    "comment": "Cost Sentinel - Cloud Run native custom domain (Google-managed certificate)"
  }'

  if [ -n "$EXISTING_ID" ]; then
    curl -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${EXISTING_ID}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  else
    curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  fi

  echo ""
  echo "✅ CNAME created/updated → ghs.googlehosted.com (proxied=false)"
  echo ""
  echo "Once the domain mapping is verified in Cloud Run console and the certificate"
  echo "is active, https://${SUBDOMAIN}.ghostprotocol.us will serve the app directly"
  echo "from Cloud Run with a Google-managed certificate."
  echo ""
  echo "NOTE: You will still need to layer Cloudflare Access (via a Worker in front"
  echo "or Access on a proxied hostname) if you want the full Admin policy enforcement."
  echo "See MODE=worker for the complete protected path."

else
  # Legacy direct-to-Cloud-Run path (no Access protection)
  if [ "$CLOUD_RUN_URL" = "REPLACE_WITH_YOUR_CLOUD_RUN_URL" ]; then
    echo "ERROR: Set CLOUD_RUN_URL environment variable or edit the script for direct mode."
    echo "Example: CLOUD_RUN_URL=cost-sentinel-xxx-uc.a.run.app MODE=direct ./setup-cloudflare-dns.sh"
    exit 1
  fi

  echo "Creating CNAME for ${SUBDOMAIN}.ghostprotocol.us -> ${CLOUD_RUN_URL} (direct, NO Access protection) ..."

  # Idempotent update
  EXISTING_ID=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=CNAME&name=${SUBDOMAIN}.ghostprotocol.us" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq -r '.result[0].id // empty' 2>/dev/null || true)

  DNS_PAYLOAD='{
    "type": "CNAME",
    "name": "'${SUBDOMAIN}'",
    "content": "'${CLOUD_RUN_URL}'",
    "ttl": 300,
    "proxied": false,
    "comment": "Cost Sentinel - direct to Cloud Run (no protection)"
  }'

  if [ -n "$EXISTING_ID" ]; then
    curl -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${EXISTING_ID}" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  else
    curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "${DNS_PAYLOAD}" | jq .
  fi

  echo ""
  echo "✅ DNS record created/updated (proxied=false)."
  echo ""
  echo "Next steps (direct mode - no Cloudflare Access):"
  echo "1. (Optional) Add custom domain in Cloud Run for Google-managed certs:"
  echo "   gcloud run domain-mappings create --service=cost-sentinel --domain=${SUBDOMAIN}.ghostprotocol.us --region=us-central1 --project=gp-phantomvision-dev"
  echo "2. Or keep using the raw *.a.run.app URL via the CNAME you just created."
  echo ""
  echo "WARNING: This path leaves the service publicly accessible."
  echo "Use MODE=worker + ./apply-cloudflare-access-policy.sh for production."
fi

echo ""
echo "For wildcard *.ghostprotocol.us support later, use Cloudflare Workers Routes or a Load Balancer."
echo "See also: ./apply-cloudflare-access-policy.sh (handles the exact Admin Access policy)."