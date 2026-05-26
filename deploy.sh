#!/bin/bash
#
# =============================================================================
# COST SENTINEL - Manual gcloud Deployment Script (Cloud Run + Artifact Registry)
# =============================================================================
# Usage:
#   ./deploy.sh                    # Deploy using :latest + git sha tag
#   ./deploy.sh --tag v1.2.3       # Custom tag
#   ./deploy.sh --help
#
# This script:
#   - Builds the Docker image locally (or via Cloud Build)
#   - Pushes to Google Artifact Registry (us-central1-docker.pkg.dev/gp-phantomvision-dev/cost-sentinel)
#   - Deploys to Cloud Run with --allow-unauthenticated
#   - Prints exact commands for custom domain setup on Cloud Run + Cloudflare
#
# Prerequisites:
#   gcloud auth login
#   gcloud config set project gp-phantomvision-dev
#   gcloud auth configure-docker us-central1-docker.pkg.dev   (done automatically)
#
# Recommended: Use the GitHub Actions workflow for production deploys.
# This script is for manual / emergency / local testing.
#
# Cloud Run service will be PUBLIC. Use Cloudflare Access (via Worker or hostname)
# for authentication as planned.
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# CONFIGURATION (edit if your setup differs)
# -----------------------------------------------------------------------------
PROJECT_ID="gp-phantomvision-dev"
REGION="us-central1"
SERVICE_NAME="cost-sentinel"
AR_REPOSITORY="cost-sentinel"
AR_LOCATION="us-central1"

# Cloud Run resource defaults (SPA is very light)
MEMORY="256Mi"
CPU="1"
CONCURRENCY="80"

# Custom domain you plan to use
CUSTOM_DOMAIN="casper.ghostprotocol.us"

# -----------------------------------------------------------------------------
# ARGUMENT PARSING
# -----------------------------------------------------------------------------
TAG=""
USE_CLOUD_BUILD=false
SHOW_HELP=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --tag)
      TAG="$2"
      shift 2
      ;;
    --cloud-build)
      USE_CLOUD_BUILD=true
      shift
      ;;
    --help|-h)
      SHOW_HELP=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      SHOW_HELP=true
      shift
      ;;
  esac
done

if [ "$SHOW_HELP" = true ]; then
  echo "Usage: $0 [--tag <tag>] [--cloud-build]"
  echo ""
  echo "  --tag <tag>       Use a specific image tag (default: git sha or 'latest')"
  echo "  --cloud-build     Build & push via Cloud Build (no local Docker required)"
  echo ""
  exit 0
fi

# -----------------------------------------------------------------------------
# PRE-FLIGHT CHECKS
# -----------------------------------------------------------------------------
echo "=== ShadowForge Cost Sentinel — Cloud Run Deployment (Manual) ==="
echo ""

if ! command -v gcloud &> /dev/null; then
  echo "ERROR: gcloud CLI not found. Install Google Cloud SDK first."
  exit 1
fi

# Ensure correct project
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
  echo "Setting gcloud project to $PROJECT_ID..."
  gcloud config set project "$PROJECT_ID"
fi

# Verify authentication
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "ERROR: No active gcloud account. Run: gcloud auth login"
  exit 1
fi

echo "Project:   $PROJECT_ID"
echo "Region:    $REGION"
echo "Service:   $SERVICE_NAME"
echo "Registry:  ${AR_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPOSITORY}"
echo ""

cd "$(dirname "$0")"

# -----------------------------------------------------------------------------
# ARTIFACT REGISTRY SETUP
# -----------------------------------------------------------------------------
echo "→ Ensuring Artifact Registry repository exists..."
if ! gcloud artifacts repositories describe "$AR_REPOSITORY" \
     --location="$AR_LOCATION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$AR_REPOSITORY" \
    --repository-format=docker \
    --location="$AR_LOCATION" \
    --description="Docker images for ShadowForge Cost Sentinel" \
    --project="$PROJECT_ID"
  echo "   Created repository: $AR_REPOSITORY"
else
  echo "   Repository already exists."
fi

echo "→ Configuring Docker auth for Artifact Registry..."
gcloud auth configure-docker "${AR_LOCATION}-docker.pkg.dev" --quiet

# -----------------------------------------------------------------------------
# DETERMINE IMAGE TAG(S)
# -----------------------------------------------------------------------------
if [ -z "$TAG" ]; then
  if git rev-parse --git-dir > /dev/null 2>&1; then
    SHORT_SHA=$(git rev-parse --short HEAD)
    TAG="${SHORT_SHA}"
  else
    TAG="manual-$(date +%Y%m%d-%H%M%S)"
  fi
fi

IMAGE_BASE="${AR_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPOSITORY}/${SERVICE_NAME}"
IMAGE="${IMAGE_BASE}:${TAG}"
LATEST_IMAGE="${IMAGE_BASE}:latest"

echo ""
echo "→ Target image: $IMAGE"
echo "→ Also tagged:  $LATEST_IMAGE"
echo ""

# -----------------------------------------------------------------------------
# BUILD & PUSH
# -----------------------------------------------------------------------------
if [ "$USE_CLOUD_BUILD" = true ]; then
  echo "→ Submitting build to Cloud Build (recommended for consistency)..."
  # Cloud Build can push directly to AR
  gcloud builds submit \
    --tag "$IMAGE" \
    --tag "$LATEST_IMAGE" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    .
else
  echo "→ Building Docker image locally..."
  docker build \
    --tag "$IMAGE" \
    --tag "$LATEST_IMAGE" \
    --label "org.opencontainers.image.source=https://github.com/dev-gp-1/cost-sentinel" \
    --label "org.opencontainers.image.revision=${TAG}" \
    .

  echo "→ Pushing to Artifact Registry..."
  docker push "$IMAGE"
  docker push "$LATEST_IMAGE"
fi

echo ""
echo "✅ Image pushed successfully."
echo ""

# -----------------------------------------------------------------------------
# DEPLOY TO CLOUD RUN
# -----------------------------------------------------------------------------
echo "→ Deploying to Cloud Run (allow-unauthenticated)..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --platform managed \
  --allow-unauthenticated \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --concurrency "$CONCURRENCY" \
  --labels "app=cost-sentinel,managed-by=deploy.sh,environment=production" \
  --quiet

# Get resulting URL
CLOUD_RUN_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format='value(status.url)')

echo ""
echo "========================================================================"
echo "✅ DEPLOYMENT SUCCESSFUL"
echo "========================================================================"
echo ""
echo "   Service URL:   $CLOUD_RUN_URL"
echo "   Image:         $IMAGE"
echo "   Region:        $REGION"
echo "   Project:       $PROJECT_ID"
echo ""
echo "   The service is currently PUBLIC (--allow-unauthenticated)."
echo "   Protect it using Cloudflare Access + Worker (or Cloudflare Access on a custom hostname)."
echo ""

# -----------------------------------------------------------------------------
# CUSTOM DOMAIN PREPARATION (Cloud Run native)
# -----------------------------------------------------------------------------
echo "========================================================================"
echo "PREPARE CUSTOM DOMAIN ON CLOUD RUN (casper.ghostprotocol.us)"
echo "========================================================================"
echo ""
echo "STEP 1 — Create the domain mapping (this triggers Google's certificate issuance):"
echo ""
echo "  gcloud run domain-mappings create \\"
echo "    --service=$SERVICE_NAME \\"
echo "    --domain=$CUSTOM_DOMAIN \\"
echo "    --region=$REGION \\"
echo "    --project=$PROJECT_ID"
echo ""
echo "   → The command will output the exact TXT record you must create in Cloudflare"
echo "     for domain verification (usually under a _domainconnect or google.* name)."
echo ""
echo "STEP 2 — After verification succeeds, point DNS in Cloudflare:"
echo ""
echo "  Type:     CNAME"
echo "  Name:     casper"
echo "  Target:   ghs.googlehosted.com"
echo "  TTL:      300"
echo "  Proxy:    DNS only (disable the orange cloud) until the Google-managed certificate"
echo "            is active and serving HTTPS on your domain."
echo ""
echo "  (You can turn proxying on later for extra DDoS protection once everything works.)"
echo ""

# -----------------------------------------------------------------------------
# ALTERNATIVE: Direct Cloud Run URL + Cloudflare Worker / Access (often simpler first)
# -----------------------------------------------------------------------------
echo "ALTERNATIVE (often faster to get auth in place):"
echo ""
echo "  Point Cloudflare directly at the Cloud Run URL and put a Cloudflare Worker"
echo "  (or Cloudflare Pages + Access) in front. This is the pattern used by"
echo "  setup-cloudflare-dns.sh and the planned casper-proxy Worker."
echo ""
echo "  Example direct CNAME (no Cloud Run domain mapping needed):"
echo "    casper.ghostprotocol.us  →  ${CLOUD_RUN_URL#https://}"
echo ""
echo "  Then enforce your exact Cloudflare Access policy at the hostname level."
echo ""

# -----------------------------------------------------------------------------
# FINAL REMINDERS
# -----------------------------------------------------------------------------
echo "========================================================================"
echo "USEFUL COMMANDS"
echo "========================================================================"
echo ""
echo "View logs:"
echo "  gcloud run services logs read $SERVICE_NAME --region $REGION --project $PROJECT_ID --limit 100"
echo ""
echo "Update traffic / rollback:"
echo "  gcloud run services update-traffic $SERVICE_NAME --to-revisions LATEST=100 --region $REGION --project $PROJECT_ID"
echo ""
echo "Describe service:"
echo "  gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID"
echo ""
echo "Delete the service (careful):"
echo "  gcloud run services delete $SERVICE_NAME --region $REGION --project $PROJECT_ID"
echo ""
echo "========================================================================"
echo "Done. Next: set up custom domain or Cloudflare Worker proxy + Access policy."
echo "========================================================================"
echo ""