#!/usr/bin/env bash
set -euo pipefail

# Deploy AURA FastAPI + Google ADK backend to Cloud Run (scale-to-zero, low max instances)
# Requires explicit PROJECT_ID, REGION (default asia-south1), APPROVAL_TOKEN_SECRET, and DEMO_STAFF_PASSCODE.

: "${PROJECT_ID:?Set PROJECT_ID explicitly (never guess)}"
REGION="${REGION:-asia-south1}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:?Set ALLOWED_ORIGINS to deployed Firebase Hosting URL}"
APPROVAL_TOKEN_SECRET="${APPROVAL_TOKEN_SECRET:?Set strong >=24-char APPROVAL_TOKEN_SECRET}"
DEMO_STAFF_PASSCODE="${DEMO_STAFF_PASSCODE:?Set DEMO_STAFF_PASSCODE}"

gcloud run deploy aura-api \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --source=./api \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=2 \
  --cpu=1 \
  --memory=512Mi \
  --concurrency=40 \
  --timeout=60s \
  --cpu-throttling \
  --set-env-vars="AURA_ENV=production,AURA_STORE_MODE=firestore,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_VERTEXAI=true,GEMINI_MODEL=${GEMINI_MODEL},DEMO_CAFE_ID=demo-cafe,ALLOW_DEMO_AUTH=true,ALLOWED_ORIGINS=${ALLOWED_ORIGINS},DAILY_AI_BUDGET_REQUESTS=200,PER_USER_DAILY_AI_LIMIT=30,PER_GUEST_IP_DAILY_LIMIT=10,PER_USER_AI_RPM=10,APPROVAL_TOKEN_SECRET=${APPROVAL_TOKEN_SECRET},DEMO_STAFF_PASSCODE=${DEMO_STAFF_PASSCODE}" \
  --labels="app=aura-living-cafe,env=hackathon" \
  --quiet
