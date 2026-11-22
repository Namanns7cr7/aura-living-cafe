# AURA — Production Deployment Report (`DEPLOYMENT_REPORT.md`)

**Deployment Date:** 2026-11-22  
**Status:** DEPLOYED & LIVE-VERIFIED  

---

## 1. Verified Google Cloud Project & Billing Linkage
- **Google Account:** `namansharma2664@gmail.com`
- **Project ID:** `aura-living-cafe-492817`
- **Project Number:** `214091459755`
- **Project Display Name:** `gcp coffee popup delhi` *(GCP enforces a 30-character max on project display names)*
- **Linked Billing Account:** `01D3D1-37E942-4640E0` (`GDP Event Credit: coffee popup Delhi`, `billingEnabled: true`)
- **Primary Region:** `asia-south1` (Mumbai)
- **Prior Projects Untouched:** `carbonexo` and all other existing projects were never modified or targeted (`--project=aura-living-cafe-492817` passed explicitly on every command).

---

## 2. Live Deployed URLs
- **Frontend (Firebase Hosting):** `https://aura-living-cafe-492817.web.app` (alias: `https://aura-living-cafe-492817.firebaseapp.com`)
- **Backend API (Cloud Run, `asia-south1`):** `https://aura-api-214091459755.asia-south1.run.app`
- **Health Endpoint:** `https://aura-api-214091459755.asia-south1.run.app/health`

---

## 3. Provisioned Google Cloud Services & Hardening
| Resource | Configuration |
|---|---|
| **Cloud Run (`aura-api`)** | `asia-south1`, `min-instances=0`, `max-instances=1` (keeps in-process SSE bus synchronized), `timeout=3600`, `1 vCPU`, `512Mi RAM`, `--cpu-throttling`, `AURA_ENV=production`, `AURA_STORE_MODE=firestore`, `ALLOW_DEMO_AUTH=true`, `DEMO_CAFE_ID=demo-cafe`, `ENABLE_LIVE_GEMINI=false` (zero AI charges) |
| **Service Account** | `aura-api-sa@aura-living-cafe-492817.iam.gserviceaccount.com` — granted ONLY `roles/datastore.user` and `roles/secretmanager.secretAccessor` |
| **Secret Manager** | `aura-approval-secret` (mounted as `APPROVAL_TOKEN_SECRET`) and `aura-staff-passcode` (mounted as `DEMO_STAFF_PASSCODE`) — never stored in git |
| **Cloud Firestore** | Native Mode in `asia-south1` (`freeTier: true`), café-scoped Security Rules (`firebase/firestore.rules`) & indexes deployed, `demo-cafe` seeded (`26` ingredients, `22` menu items, `12` tables, `12` orders, `4` sessions) |
| **Firebase Hosting** | Static Next.js 15.5.9 export (`57` files), SPA rewrite for `/app/orders/**` |
| **CORS** | Restricted to `https://aura-living-cafe-492817.web.app` and `https://aura-living-cafe-492817.firebaseapp.com` |
| **Billing Budget Alert** | Budget ID `1a63e8f1-99a7-4da5-bcec-a4930cdbf5a6` on `01D3D1-37E942-4640E0` scoped to project `214091459755` at **\$2 (40%)**, **\$4 (80%)**, and **\$5 (100%)** |
| **Artifact Registry** | `cloud-run-source-deploy` in `asia-south1` with active cleanup policy keeping the last 2 versions (`--no-dry-run`) |

---

## 4. Post-Hackathon Teardown Commands
To eliminate all running resources after judging:
```bash
gcloud run services delete aura-api --project=aura-living-cafe-492817 --region=asia-south1 --quiet
npx -y firebase-tools@latest hosting:disable --project aura-living-cafe-492817 --force
```
Or run `./infra/teardown.sh` with `PROJECT_ID=aura-living-cafe-492817`.
