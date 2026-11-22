#!/usr/bin/env bash
set -euo pipefail

# Post-hackathon cleanup script to eliminate ongoing cloud costs.
# Run ONLY when ready to tear down the deployed hackathon demo.
: "${PROJECT_ID:?Set PROJECT_ID explicitly}"
REGION="${REGION:-asia-south1}"

echo "Deleting Cloud Run service aura-api in ${PROJECT_ID}/${REGION}..."
gcloud run services delete aura-api --project="${PROJECT_ID}" --region="${REGION}" --quiet || true

echo "Disabling Firebase Hosting site (keeps project history, stops traffic)..."
npx -y firebase-tools@latest hosting:disable --project "${PROJECT_ID}" --force || true

echo "Teardown complete. Verify in Cloud Billing Console that no active resources remain."
