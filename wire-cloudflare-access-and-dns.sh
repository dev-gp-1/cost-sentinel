#!/bin/bash
set -e

echo "=== Full Cloudflare Access + DNS Wiring for casper.ghostprotocol.us ==="
echo ""

if [ -z "$1" ]; then
  echo "Usage: $0 <CLOUDFLARE_API_TOKEN>"
  exit 1
fi

TOKEN="$1"

# 1. Apply Access Application + Policy (your exact policy)
./apply-cloudflare-access.sh "$TOKEN"

echo ""
echo "=== DNS Setup ==="
echo "You still need to:"
echo "1. Deploy the Cloudflare Worker (casper-proxy)"
echo "2. Add the custom domain casper.ghostprotocol.us to the Worker"
echo "3. Point DNS (CNAME casper.ghostprotocol.us → the Worker address or ghs.googlehosted.com if going direct to Cloud Run)"
echo ""
echo "Run the Worker deployment with wrangler after you have the Cloud Run URL."
echo ""
echo "Script complete. Access policy has been applied."