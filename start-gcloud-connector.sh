#!/bin/bash
set -e

echo "=== ShadowForge Cost Sentinel - GCloud Connector Launcher ==="
echo ""

# Robust directory detection (works even if called from gp-firmware root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# If we're inside the server dir already, go up one level
if [[ "$(basename "$SCRIPT_DIR")" == "server" ]]; then
  SCRIPT_DIR="$(dirname "$SCRIPT_DIR")"
fi

# If cost-sentinel dir exists here, use it (handles being called from gp-firmware/)
if [ -d "$SCRIPT_DIR/cost-sentinel" ]; then
  SCRIPT_DIR="$SCRIPT_DIR/cost-sentinel"
fi

cd "$SCRIPT_DIR"

echo "Working directory: $(pwd)"
echo "Target GCP project: gp-phantomvision-dev"
echo ""

# Check for ADC
if [ ! -f "$HOME/.config/gcloud/application_default_credentials.json" ]; then
    echo "⚠️  Application Default Credentials not found."
    echo "Please run first:"
    echo "  gcloud auth application-default login"
    echo "  gcloud auth application-default set-quota-project gp-phantomvision-dev"
    exit 1
fi

echo "✅ ADC credentials found."

# Set project
gcloud config set project gp-phantomvision-dev >/dev/null 2>&1 || true

echo ""
echo "Starting connector on http://localhost:8787 ..."
echo "This will use your ADC to talk to gp-phantomvision-dev billing & storage APIs."
echo ""
echo "In the Cost Sentinel app → GCP Connect tab, use:"
echo "  • 'REFRESH — TRY LOCAL GCLOUD ADC'   (live SKUs)"
echo "  • 'FETCH LIVE STORAGE'               (real bucket costs)"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Prefer the npm script if available, otherwise fall back to direct node
if command -v npm >/dev/null 2>&1 && [ -f "package.json" ]; then
  exec npm run connector
else
  cd server
  exec node server.mjs
fi