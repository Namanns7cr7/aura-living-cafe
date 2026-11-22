#!/usr/bin/env bash
set -euo pipefail

# Build static Next.js frontend and deploy to Firebase Hosting + Firestore rules
: "${PROJECT_ID:?Set PROJECT_ID explicitly}"
: "${NEXT_PUBLIC_API_BASE_URL:?Set NEXT_PUBLIC_API_BASE_URL to Cloud Run API URL}"

pushd web >/dev/null
npm ci
NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL}" \
NEXT_PUBLIC_CAFE_ID="demo-cafe" \
npm run build
popd >/dev/null

npx -y firebase-tools@latest deploy --only hosting,firestore:rules,firestore:indexes --project "${PROJECT_ID}"
