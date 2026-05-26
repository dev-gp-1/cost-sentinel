#!/bin/bash
#
# =============================================================================
# COST SENTINEL - Legacy / Simple Cloud Run Deploy (now uses Artifact Registry)
# =============================================================================
# This is the legacy entry point (kept for compatibility).
# Prefer: npm run deploy   or   ./deploy.sh
#
# Still fully functional. Uses Cloud Build + modern Artifact Registry.
# =============================================================================

set -euo pipefail

echo "=== ShadowForge Cost Sentinel - Cloud Run Deployment (Legacy) ==="
echo "NOTE: Prefer the new './deploy.sh' or 'npm run deploy' for full features."
echo ""

# Configuration
PROJECT_ID="gp-phantomvision-dev"
SERVICE_NAME="cost-sentinel"
REGION="us-central1"
AR_REPOSITORY="cost-sentinel"
AR_LOCATION="us-central1"

IMAGE_BASE="${AR_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPOSITORY}/${SERVICE_NAME}"
IMAGE="${IMAGE_BASE}:latest"

echo "Project:        $PROJECT_ID"
echo "Service:        $SERVICE_NAME"
echo "Region:         $REGION"
echo "Artifact Repo:  ${AR_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPOSITORY}"
echo ""

cd "$(dirname "$0")"

# Ensure Artifact Registry repo exists
echo "→ Ensuring Artifact Registry repository exists..."
if ! gcloud artifacts repositories describe "$AR_REPOSITORY" \
     --location="$AR_LOCATION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPOSITORY" \
    --repository-format=docker \
    --location="$AR_LOCATION" \
    --description="Docker images for ShadowForge Cost Sentinel" \
    --project="$PROJECT_ID"
fi

# Build & push via Cloud Build (no local Docker daemon required)
echo "→ Submitting build to Cloud Build and pushing to Artifact Registry..."
gcloud builds submit \
  --tag "$IMAGE" \
  --tag "${IMAGE_BASE}:$(date +%Y%m%d-%H%M%S)" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  .

# Deploy to Cloud Run (public for now — protect via Cloudflare Access)
echo "→ Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --platform managed \
  --allow-unauthenticated \
  --memory 256Mi \
  --cpu 1 \
  --concurrency 80 \
  --labels "app=cost-sentinel,managed-by=deploy-to-cloudrun.sh" \
  --quiet

# Get the URL
CLOUD_RUN_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(status.url)')

echo ""
echo "✅ Deployed successfully!"
echo "Cloud Run URL: $CLOUD_RUN_URL"
echo "Image:         $IMAGE"
echo ""

# Custom domain preparation (Cloud Run + Cloudflare)
echo "========================================================================"
echo "CUSTOM DOMAIN PREP (Cloud Run native)"
echo "========================================================================"
echo ""
echo "1. Map the domain (triggers Google cert issuance):"
echo "   gcloud run domain-mappings create \\"
echo "     --service=$SERVICE_NAME \\"
echo "     --domain=casper.ghostprotocol.us \\"
echo "     --region=$REGION \\"
echo "     --project=$PROJECT_ID"
echo ""
echo "2. In Cloudflare DNS (ghostprotocol.us zone):"
echo "   CNAME  casper  →  ghs.googlehosted.com   (Proxy: DNS only)"
echo ""
echo "3. Alternative (often simpler initially):"
echo "   Use ./setup-cloudflare-dns.sh or point directly at the Cloud Run URL"
echo "   and front it with a Cloudflare Worker + your Access policy."
echo ""
echo "See ./deploy.sh for the most complete manual deployment experience."
echo "========================================================================"