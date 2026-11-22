# AURA — Cost & Billing Preflight Report

**Status:** DEPLOYED & LIVE-VERIFIED (`ENABLE_LIVE_GEMINI=false` — rule-based mode, \$0.00 AI spend)  
**Deployed Project:** `aura-living-cafe-492817` (Project `#214091459755`, linked to `01D3D1-37E942-4640E0` — `GDP Event Credit: coffee popup Delhi`)  
**Budget Alert Configured:** Budget ID `1a63e8f1-99a7-4da5-bcec-a4930cdbf5a6` at **\$2.00 (40%)**, **\$4.00 (80%)**, and **\$5.00 (100%)** (alerts only, not hard spend caps)  
**Target Budget:** \$5.00 USD initial spend ceiling  
**Verified Google Account:** `namansharma2664@gmail.com` (verified via `gcloud auth list` and `firebase login:list`)  

---

## 1. Google Cloud Account & Event-Credit Billing Preflight (Verified)

| Check | Observed Value | Status |
|---|---|---|
| Active `gcloud` Account | `namansharma2664@gmail.com` | Verified |
| Active `firebase` Account | `namansharma2664@gmail.com` | Verified |
| Current Default `gcloud` Project | `carbonexo` (project `#95267034623`) | **DO NOT USE** (prior project) |
| Existing Project Named `gcp event credit coffee popup delhi` | **None found** across 22 active GCP projects and 5 Firebase projects | **Action Required at Approval Gate** |
| Open Event-Credit Billing Account | `01D3D1-37E942-4640E0` — Display Name: **`GDP Event Credit: coffee popup Delhi`** (`OPEN: True`) | **Verified OPEN** |
| Projects Linked to `01D3D1-37E942-4640E0` | `0` projects currently linked (`gcloud billing projects list` returned 0 items) | **Requires User Approval to Create/Link** |
| Exact Remaining Credit Balance | Not queryable via `gcloud billing` CLI (requires Cloud Billing Console view) | **Unverified — treat \$5.00 USD gross cap as hard design target** |

> **Important Preflight Note:** `GDP Event Credit: coffee popup Delhi` (`01D3D1-37E942-4640E0`) is an **open Billing Account**, not an existing GCP Project. No project currently exists under it. Per safety rules, **no project has been created and no billing account has been linked**. Before Milestone H deployment, we will request explicit user approval to either:
> 1. Create a new dedicated GCP project (e.g., `aura-living-cafe-delhi` with display name `gcp event credit coffee popup delhi`) and link it to billing account `01D3D1-37E942-4640E0`, OR
> 2. Link an existing project the user specifies.

---

## 2. Planned Cloud Architecture & Cost Profile (Google-Only)

| Service | Configuration | Free Tier / Pricing Basis | Est. Monthly Demo Usage | Est. Gross Cost (USD) |
|---|---|---|---|---|
| **Firebase Hosting** (Static Next.js Export) | Static HTML/JS/CSS CDN, zero always-on server | Spark/Blaze Free Tier: 10 GB storage, 360 MB/day transfer | ~30 MB assets, <500 MB transfer | **\$0.00** |
| **Cloud Run** (`aura-api`, `asia-south1`) | 1 vCPU, 512 MiB RAM, `min-instances=0`, `max-instances=2`, request-based billing, concurrency=40 | Free Tier: 2M requests, 180k vCPU-sec, 360k GiB-sec/mo | ~5,000 requests, ~2,500 vCPU-sec | **\$0.00 – \$0.25** |
| **Cloud Firestore** (Native Mode, `asia-south1`) | Single `demo-cafe` tenant, client read-only listeners, server transactions | Free Tier: 50k reads, 20k writes, 20k deletes/day; 1 GiB storage | <5k reads/day, <1k writes/day, <5 MB | **\$0.00** |
| **Firebase Authentication** | Email/Password + Anonymous/Demo Identity | Free Tier: 50,000 MAU | <50 demo users | **\$0.00** |
| **Vertex AI — Gemini Flash** (`asia-south1` or global verified endpoint) | Single canonical model: **`gemini-3.8-flash`** (smoke-tested before production cutover), compact prompts + deterministic pre-filtering | Pay-per-token (Gemini Flash tier: ~\$0.15–\$0.30 / 1M input tokens, ~\$0.60–\$2.50 / 1M output tokens; exact SKU verified at smoke test) | ~300 demo agent calls (~1,500 in / 400 out tokens each) | **\$0.15 – \$0.80** |
| **Artifact Registry** (`asia-south1`) | 1 compact Python container image (~250 MB) + cleanup policy keeping latest 2 tags | Free Tier: 0.5 GB storage/month | ~0.25 GB | **\$0.00** |
| **Cloud Build** (container build on deploy) | On-demand build only on verified release | Free Tier: 120 build-minutes/day | ~6 build-minutes total | **\$0.00** |
| **Cloud Logging** | Structured JSON warnings/errors + minimal info logs, no payload dumps | Free Tier: 50 GiB/month | <50 MB/month | **\$0.00** |
| **TOTAL PROJECTED GROSS SPEND** | | | **Hackathon demo + judge testing** | **\$0.15 – \$1.05 / month** |

**Budget Fit Assessment:** **FITS WELL WITHIN \$5.00 USD TARGET** (projected gross cost \$0.15–\$1.05/month even assuming \$0 event credit coverage; likely \$0.00 net if `GDP Event Credit: coffee popup Delhi` covers Cloud Run, Firestore, and Vertex AI SKUs).

---

## 3. Built-In Cost & Abuse Safeguards

1. **Zero Always-On Compute:**
   - Frontend uses Next.js static export (`output: 'export'`) hosted on **Firebase Hosting** — zero SSR container cost.
   - Backend runs on **Cloud Run** with `--min-instances=0`, `--max-instances=2`, `--cpu-throttling` (request-based billing), `--timeout=30s`.
2. **Application-Level AI Rate Limiting & Daily Allowance:**
   - Configurable `DAILY_AI_BUDGET_REQUESTS` (default: `200` total Gemini calls/day across demo) and `PER_USER_AI_RPM` (default: `10` requests/min/user) enforced server-side in `api/app/services/rate_limit.py`.
   - Zero Gemini calls inside Three.js animation loops, Firestore listeners, or menu/inventory page loads.
   - Deterministic Python engine handles all menu filtering, serving math, ETA estimation, and order/inventory transactions. Gemini is invoked strictly when semantic natural-language concierge reasoning or operational insight synthesis is requested.
3. **Billing Alerts vs. Spend Caps:**
   - Standard GCP Cloud Billing budgets trigger **email/PubSub alerts only** — they do **not** hard-cut off spending automatically.
   - At deployment approval, we will configure Cloud Billing budget alerts at **50% (\$2.50)**, **90% (\$4.50)**, and **100% (\$5.00)** and cap Vertex AI / Cloud Run concurrency & quotas where supported.
4. **Known Cost Uncertainties:**
   - Exact SKU coverage and remaining credit balance on `01D3D1-37E942-4640E0` (`GDP Event Credit: coffee popup Delhi`) cannot be inspected via CLI and must be verified in the Cloud Billing Console.
   - `gemini-3.8-flash` availability in `asia-south1` vs `global` will be verified via a single authenticated smoke test before production deploy; if unavailable, the single canonical `GEMINI_MODEL` and this table will be updated together in lockstep.
   - Public URL traffic spikes during judging could increase requests; `--max-instances=2` and server-side AI daily cap protect against runaway bills.

---

## 4. Avoided Expensive Components

- No Cloud SQL, GKE, Vertex AI Vector Search, persistent GPUs, BigQuery scheduled queries, Cloud Scheduler cron jobs (seat reservations use server-side lazy expiration on read/write), or redundant staging/prod environments.
