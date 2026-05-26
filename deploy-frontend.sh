#!/bin/bash
set -e

echo "=== ShadowForge Cost Sentinel — Frontend Deploy ==="
echo ""

cd "$(dirname "$0")"

echo "Building production bundle..."
npm run build

echo ""
echo "Deploying to Firebase Hosting (gp-phantomvision-dev)..."
echo "Make sure you are logged into the correct Firebase project."
echo ""

npx firebase deploy --only hosting --project gp-phantomvision-dev

echo ""
echo "Done. Your frontend should now be live."
echo "The app will still use your local connector (localhost:8787) when you run ./start-gcloud-connector.sh on your machine."
