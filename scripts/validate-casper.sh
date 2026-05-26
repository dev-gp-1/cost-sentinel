#!/bin/bash
#
# validate-casper.sh
# Casper.ghostprotocol.us post-deploy validation (Access redirect + basic proxy health).
# Run after DNS + Worker custom domain + Access policy + Worker secret are live.
#
# Usage:
#   ./scripts/validate-casper.sh
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... ./scripts/validate-casper.sh   # for service token bypass test
#
set -euo pipefail

TARGET="https://casper.ghostprotocol.us"
echo "============================================================"
echo "CASPER VALIDATION: ${TARGET}"
echo "============================================================"
echo "Expect: 302 redirect to Cloudflare Access login (cf-access...) for unauthed."
echo "After auth (allowed email: dean@ghostprotocol.us etc.): 200 + Vue app shell."
echo ""

echo "=== 1. HEADERS (curl -I) ==="
curl -sI "$TARGET" | cat
echo ""

echo "=== 2. Quick content sanity (first 200 bytes of body, expect Vue/ShadowForge) ==="
curl -sL "$TARGET" | head -c 200 | cat
echo ""
echo ""

if [[ -n "${CF_ACCESS_CLIENT_ID:-}" && -n "${CF_ACCESS_CLIENT_SECRET:-}" ]]; then
  echo "=== 3. SERVICE TOKEN BYPASS TEST (if provided) ==="
  curl -sI \
    -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
    -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
    "$TARGET" | cat
  echo ""
else
  echo "=== 3. SERVICE TOKEN BYPASS ==="
  echo "(Skipped: export CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET to test)"
  echo "Example: CF-Access-Client-Id: 00bc5effe82dd81aa686fcf3cc33cce7.access"
fi

echo ""
echo "=== 4. POST-DEPLOY BROWSER MANUAL CHECKLIST (Vue app) ==="
echo "1. Login at ${TARGET} with allowed identity (ghostprotocol.us / cota.com / huggaretreats.com domain or explicit emails)."
echo "2. Business Models: Confirm two models side-by-side, editable inputs, LTV/COGS/margin waterfall, charts update."
echo "3. Simulator: Sliders + scenario runs produce live results."
echo "4. GCP Connect tab: 'Connect' buttons; requires local connector running (./start-gcloud-connector.sh). Progress % and counters visible."
echo "5. Refresh/deep link: SPA still works (nginx fallback)."
echo "6. Disallowed email: Blocked at Access wall (no Vue load)."
echo "7. DevTools: cf-ray, server: cloudflare, x-forwarded-host etc. present; no redirect loops."
echo ""
echo "=== DONE ==="
echo "If Access redirect + post-auth Vue present: SUCCESS."
echo "See MASTER_RUNBOOK.md for full curls, IDs, and architecture notes."
echo "============================================================"

# Make executable on run: chmod +x scripts/validate-casper.sh
