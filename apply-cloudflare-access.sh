#!/bin/bash
set -e

# === Cloudflare Access Setup for casper.ghostprotocol.us ===
# This script applies the exact "Admin Access" policy you provided.

if [ -z "$1" ]; then
  echo "Usage: $0 <CLOUDFLARE_API_TOKEN>"
  echo "Example: $0 your_api_token_here"
  exit 1
fi

API_TOKEN="$1"
ACCOUNT_ID="79f3207a2cdac9f9996dc13a3dc80340"
HOSTNAME="casper.ghostprotocol.us"

echo "=== Applying Cloudflare Access for $HOSTNAME ==="

# 1. Create (or update) the Access Application
echo "Creating Access Application..."
APP_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/apps" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Cost Sentinel",
    "domain": "'${HOSTNAME}'",
    "type": "self_hosted",
    "session_duration": "24h",
    "allowed_idps": [],
    "auto_redirect_to_identity": false,
    "enable_binding_cookie": false,
    "http_only_cookie_attribute": false,
    "same_site_cookie_attribute": "lax",
    "service_auth_401_redirect": false
  }')

APP_ID=$(echo "$APP_RESPONSE" | jq -r '.result.id // empty')

if [ -z "$APP_ID" ]; then
  # Try to find existing app
  APP_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/apps" \
    -H "Authorization: Bearer ${API_TOKEN}" | \
    jq -r '.result[] | select(.domain == "'${HOSTNAME}'") | .id' | head -1)
fi

if [ -z "$APP_ID" ]; then
  echo "Failed to create or find Access Application. Response:"
  echo "$APP_RESPONSE"
  exit 1
fi

echo "Access Application ID: $APP_ID"

# 2. Create the exact "Admin Access" policy you provided
echo "Creating Admin Access policy..."
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access/policies" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
  "name": "Admin Access",
  "decision": "allow",
  "include": [
    { "email_domain": { "domain": "ghostprotocol.us" } },
    { "email_domain": { "domain": "cota.com" } },
    { "email_domain": { "domain": "huggaretreats.com" } },
    { "email": { "email": "dean.barrett.86@gmail.com" } },
    { "email": { "email": "burkegw@gmail.com" } },
    { "email": { "email": "greg@ggernetzke.com" } },
    { "email": { "email": "chase@huggaretreats.com" } }
  ],
  "exclude": [],
  "require": [],
  "connection_rules": {
    "rdp": {
      "allowed_clipboard_local_to_remote_formats": ["text"],
      "allowed_clipboard_remote_to_local_formats": ["text"]
    }
  }
}' | jq .

echo ""
echo "✅ Policy created/updated."
echo ""
echo "Next: Make sure the Worker is deployed and the hostname is added to the Worker custom domains."
echo "Then test access with one of the allowed emails."